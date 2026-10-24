import type { Table } from 'dexie';
import { z } from 'zod';
import {
  backupActionSchema, backupEventSchema, backupImportReceiptSchema, backupProblemSchema, backupSchema, backupSessionSchema,
  MAX_BACKUP_BYTES, MAX_BACKUP_RECORDS, type Backup, type BackupErrorCode, type BackupImportReceipt,
} from '../shared/backup';
import { commandSchema, type ActionRecord, type LearningEvent, type Problem, type Session, type WriteCommand } from '../shared/protocol';
import { classifyStorageError, type Store } from './store';

const logger = console;
export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode) { super(code); }
}
const invalid = (): never => { throw new BackupError('BACKUP_INVALID'); };
const jsonBytes = (text: string) => new TextEncoder().encode(text).byteLength;
const canonical = (value: unknown): string => JSON.stringify(sortKeys(value));
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sortKeys(item)]));
  return value;
}
function uniqueRows<T extends { id: string }>(rows: T[]): Map<string, T> {
  const index = new Map(rows.map((row) => [row.id, row]));
  if (index.size !== rows.length) invalid();
  return index;
}
function readWriteCommand(fingerprint: string, extensionId: string): WriteCommand {
  let raw: unknown;
  try { raw = JSON.parse(fingerprint); } catch { return invalid(); }
  const result = commandSchema.safeParse(raw);
  if (!result.success || result.data.type === 'read' || result.data.type === 'queryAction') return invalid();
  const command = result.data;
  if (command.extensionId !== extensionId || ('expectedRevision' in command && !Number.isSafeInteger(command.expectedRevision))) return invalid();
  return command;
}
function nextSession(command: WriteCommand, event: LearningEvent, previous: Session | undefined): Session {
  if (command.actionId !== event.id || command.sessionId !== event.sessionId || command.problemSnapshotId !== event.problemSnapshotId) return invalid();
  if (command.type === 'start') {
    if (previous || event.revision !== 0 || event.kind !== 'started' || event.text !== undefined) return invalid();
    return { id: command.sessionId, problemSnapshotId: command.problemSnapshotId, problemKey: command.problemKey,
      status: 'active', revision: 0, draft: '', createdAt: event.at, updatedAt: event.at };
  }
  if (!previous || command.expectedRevision !== previous.revision || previous.status !== (command.type === 'resume' ? 'paused' : 'active')) return invalid();
  const next = { ...previous, revision: previous.revision + 1, updatedAt: event.at };
  if (command.type === 'saveDraft') {
    if (event.kind !== 'draft' || event.text !== command.text) return invalid();
    next.draft = command.text;
  } else if (command.type === 'recordAttempt') {
    if (event.kind !== 'attempt' || !previous.draft.trim() || event.text !== previous.draft) return invalid();
  } else {
    if (event.text !== undefined || event.kind !== (command.type === 'pause' ? 'paused' : 'resumed')) return invalid();
    next.status = command.type === 'pause' ? 'paused' : 'active';
  }
  return next;
}

export function validateBackup(input: unknown): Backup {
  /*
   * ========================================================================
   * 步骤1：校验文件边界与严格字段
   * ========================================================================
   * 数据源：不可信 JSON 对象。
   * 操作：1) 独立检查字节、版本及数量。2) 复用学习 schema 并收紧备份限制。
   */
  logger.info('开始校验备份文件');
  try {
    // 1.1 后台自行序列化计量，不接受页面上报的文件大小。
    let text: string | undefined;
    try { text = JSON.stringify(input); } catch { return invalid(); }
    if (text === undefined) return invalid();
    if (jsonBytes(text) > MAX_BACKUP_BYTES) throw new BackupError('BACKUP_TOO_LARGE');
    const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    if ((raw.format !== undefined && raw.format !== 'algorhythm-backup') || (raw.formatVersion !== undefined && raw.formatVersion !== 1) ||
        (raw.scope !== undefined && raw.scope !== 'prototype-storage-v1')) throw new BackupError('BACKUP_UNSUPPORTED_VERSION');
    const data = raw.data && typeof raw.data === 'object' ? raw.data as Record<string, unknown> : {};
    for (const table of Object.keys(MAX_BACKUP_RECORDS) as (keyof typeof MAX_BACKUP_RECORDS)[]) {
      const rows = data[table];
      if (Array.isArray(rows) && rows.length > MAX_BACKUP_RECORDS[table]) throw new BackupError('BACKUP_TOO_LARGE');
    }
    // 1.2 严格 schema 拒绝未知字段，不扫描或修改合法学习文本。
    const parsed = backupSchema.safeParse(input);
    if (!parsed.success) return invalid();
    const backup = parsed.data;
    validateRelations(backup);
    return backup;
  } finally { logger.info('校验备份文件结束'); }
}

function validateRelations(backup: Backup): void {
  /*
   * ========================================================================
   * 步骤2：按 revision 验证事实和回执链
   * ========================================================================
   * 数据源：已通过形状校验的四张学习表。
   * 操作：1) Map 核对唯一性与归属。2) 纯计算每步快照，不调用 Store.handle。
   */
  logger.info('开始校验备份关系');
  try {
    // 2.1 每个快照只属于一个会话，事件与成功 action 一一对应。
    const { problems, sessions, events, actions } = backup.data;
    const problemIndex = uniqueRows(problems); const sessionIndex = uniqueRows(sessions);
    uniqueRows(events); const actionIndex = uniqueRows(actions);
    if (problems.length !== sessions.length || events.length !== actions.length) return invalid();
    const owners = new Set<string>(); const histories = new Map<string, LearningEvent[]>();
    for (const session of sessions) {
      const problem = problemIndex.get(session.problemSnapshotId);
      if (!problem || problem.key !== session.problemKey || owners.has(problem.id)) return invalid();
      owners.add(problem.id); histories.set(session.id, []);
    }
    for (const event of events) {
      const session = sessionIndex.get(event.sessionId);
      if (!session || event.problemSnapshotId !== session.problemSnapshotId || event.id !== event.actionId || !actionIndex.has(event.id)) return invalid();
      histories.get(session.id)!.push(event);
    }
    // 2.2 先比较数量，巨大 revision 也不会产生对应大小的循环或数组。
    for (const session of sessions) {
      const history = histories.get(session.id)!;
      if (history.length !== session.revision + 1) return invalid();
      history.sort((a, b) => a.revision - b.revision);
      let current: Session | undefined;
      for (const [revision, event] of history.entries()) {
        if (event.revision !== revision) return invalid();
        const action = actionIndex.get(event.id)!;
        if (action.result.actionId !== action.id) return invalid();
        const command = readWriteCommand(action.fingerprint, backup.source.extensionId);
        current = nextSession(command, event, current);
        if (canonical(current) !== canonical(action.result.session)) return invalid();
      }
      // 2.3 时钟可回拨；顺序仅由 revision 决定，最后回执必须等于当前快照。
      if (canonical(current) !== canonical(session)) return invalid();
    }
  } finally { logger.info('校验备份关系结束'); }
}

export function parseBackup(text: string): Backup {
  /*
   * ========================================================================
   * 步骤3：解析本地备份文本
   * ========================================================================
   * 数据源：UTF-8 JSON 文本。
   * 操作：1) 解析前检查实际字节数。2) 分类 JSON 错误并复用完整纯校验。
   */
  logger.info('开始解析备份文本');
  try {
    // 3.1 不记录文件文本或底层解析错误。
    if (jsonBytes(text) > MAX_BACKUP_BYTES) throw new BackupError('BACKUP_TOO_LARGE');
    let input: unknown;
    try { input = JSON.parse(text); } catch { return invalid(); }
    return validateBackup(input);
  } finally { logger.info('解析备份文本结束'); }
}

export async function digestBackup(backup: Backup): Promise<string> {
  /*
   * ========================================================================
   * 步骤4：计算完整文件的规范摘要
   * ========================================================================
   * 数据源：备份原始 source、envelope 和四张学习表。
   * 操作：1) 对象键排序，四表按 ID 排序。2) 在任何数据库事务外计算 SHA-256。
   */
  logger.info('开始计算备份摘要');
  try {
    // 4.1 复制排序，不改源对象或跨实例路由元数据。
    const data = { ...backup.data };
    for (const table of Object.keys(data) as (keyof Backup['data'])[]) data[table] = [...data[table]].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) as never;
    const bytes = new TextEncoder().encode(canonical({ ...backup, data }));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
  } finally { logger.info('计算备份摘要结束'); }
}

const selectSession = (row: Session): Session => ({
  id: row.id, problemSnapshotId: row.problemSnapshotId, problemKey: row.problemKey, status: row.status, revision: row.revision,
  draft: row.draft, createdAt: row.createdAt, updatedAt: row.updatedAt,
});
const selectProblem = (row: Problem): Problem => ({ id: row.id, key: row.key, title: row.title, statement: row.statement, source: row.source });
const selectEvent = (row: LearningEvent): LearningEvent => ({
  id: row.id, actionId: row.actionId, sessionId: row.sessionId, problemSnapshotId: row.problemSnapshotId,
  revision: row.revision, at: row.at, kind: row.kind, source: row.source, ...(row.text === undefined ? {} : { text: row.text }),
});
const selectAction = (row: ActionRecord): ActionRecord => ({ id: row.id, fingerprint: row.fingerprint,
  result: { ok: row.result.ok, kind: row.result.kind, actionId: row.result.actionId, session: selectSession(row.result.session) } });
const storageFailure = (error: unknown): never => { throw error instanceof BackupError ? error : new BackupError(classifyStorageError(error)); };
function normalizeAction(row: ActionRecord, originalExtensionId: string, targetExtensionId: string): ActionRecord {
  const command = readWriteCommand(row.fingerprint, originalExtensionId);
  // 6.1 必须使用共享 schema 的固定字段顺序，不能把字母排序 JSON 存成指纹。
  return { ...row, fingerprint: JSON.stringify(commandSchema.parse({ ...command, extensionId: targetExtensionId })) };
}

export async function exportBackup(store: Store, source: Backup['source']): Promise<Backup> {
  /*
   * ========================================================================
   * 步骤5：导出同一时点的学习快照
   * ========================================================================
   * 数据源：IndexedDB 四张学习表，不读取诊断、配置或导入回执。
   * 操作：1) 只读事务取得一致快照。2) 事务外白名单构造、校验并排序。
   */
  logger.info('开始导出备份');
  try {
    // 5.1 不在只读事务内等待哈希、文件操作或网络。
    const rows = await store.db.transaction('r', [store.db.problems, store.db.sessions, store.db.events, store.db.actions], async () => ({
      problems: await store.db.problems.toArray(), sessions: await store.db.sessions.toArray(),
      events: await store.db.events.toArray(), actions: await store.db.actions.toArray(),
    }));
    let data: Backup['data'];
    // 5.2 明确列出所有可导出字段；已知字段损坏时拒绝，不修复或截断。
    try { data = { problems: rows.problems.map(selectProblem), sessions: rows.sessions.map(selectSession), events: rows.events.map(selectEvent), actions: rows.actions.map(selectAction) }; }
    catch { return invalid(); }
    const backup = validateBackup({ format: 'algorhythm-backup', formatVersion: 1, scope: 'prototype-storage-v1',
      backupId: crypto.randomUUID(), exportedAt: Date.now(), source: { appVersion: source.appVersion, extensionId: source.extensionId }, data });
    for (const table of Object.keys(backup.data) as (keyof Backup['data'])[]) backup.data[table].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return backup;
  } catch (error) { return storageFailure(error); }
  finally { logger.info('导出备份结束'); }
}

async function missingRows<T extends { id: string }>(table: Table<T, string>, rows: T[], schema: z.ZodType<T>, normalize: (row: T) => T = (row) => row): Promise<T[]> {
  /*
   * ========================================================================
   * 步骤7：复核目标同 ID 记录
   * ========================================================================
   * 数据源：导入事务内读取的目标行与事务外准备的备份行。
   * 操作：1) 严格校验目标记录。2) 比较规范内容并只返回缺失行。
   */
  logger.info('开始复核目标记录', { count: rows.length });
  try {
    // 7.1 批量按主键读取，避免全表两两比较或在内存猜测现有状态。
    const existing = await table.bulkGet(rows.map((row) => row.id)); const missing: T[] = [];
    for (const [index, row] of rows.entries()) {
      const current = existing[index];
      if (current === undefined) { missing.push(row); continue; }
      const parsed = schema.safeParse(current);
      if (!parsed.success) return invalid();
      if (canonical(normalize(parsed.data)) !== canonical(row)) throw new BackupError('BACKUP_CONFLICT');
    }
    return missing;
  } finally { logger.info('复核目标记录结束'); }
}

async function assertTargetRelations(store: Store, data: Backup['data']): Promise<void> {
  /*
   * ========================================================================
   * 步骤9：复核受影响会话的并集关系
   * ========================================================================
   * 数据源：同一导入事务内的快照所有者、会话事件和动作回执。
   * 操作：1) 阻止不同会话占用同一快照。2) 阻止为已有历史补入另一组动作身份。
   */
  logger.info('开始复核导入关系');
  try {
    // 9.1 仅检查本次涉及的归属与历史，不对整个数据库套用单份文件上限。
    if (!data.sessions.length) return;
    const owners = new Map(data.sessions.map((row) => [row.problemSnapshotId, row.id]));
    const sessionIds = new Set(data.sessions.map((row) => row.id));
    const eventOwners = new Map(data.events.map((row) => [row.id, row.sessionId]));
    const actionOwners = new Map(data.actions.map((row) => [row.id, row.result.session.id]));
    const [sessions, events, actions] = await Promise.all([
      store.db.sessions.filter((row) => owners.has(row.problemSnapshotId)).toArray(),
      store.db.events.where('sessionId').anyOf([...sessionIds]).toArray(),
      store.db.actions.filter((row) => sessionIds.has(row.result?.session?.id)).toArray(),
    ]);
    // 9.2 同 ID 内容已经逐表核对；这里只补跨 ID 的关系约束，部分缺失历史仍可补齐。
    for (const row of sessions) {
      const parsed = backupSessionSchema.safeParse(row);
      if (!parsed.success) return invalid();
      if (owners.get(parsed.data.problemSnapshotId) !== parsed.data.id) throw new BackupError('BACKUP_CONFLICT');
    }
    for (const row of events) {
      const parsed = backupEventSchema.safeParse(row);
      if (!parsed.success) return invalid();
      if (eventOwners.get(parsed.data.id) !== parsed.data.sessionId) throw new BackupError('BACKUP_CONFLICT');
    }
    for (const row of actions) {
      const parsed = backupActionSchema.safeParse(row);
      if (!parsed.success) return invalid();
      if (actionOwners.get(parsed.data.id) !== parsed.data.result.session.id) throw new BackupError('BACKUP_CONFLICT');
    }
  } finally { logger.info('复核导入关系结束'); }
}

export async function importBackup(store: Store, input: unknown, expectedDigest: string, targetExtensionId: string): Promise<BackupImportReceipt> {
  /*
   * ========================================================================
   * 步骤6：准备非覆盖导入并原子提交
   * ========================================================================
   * 数据源：不可信文件、预览摘要、目标扩展 ID 与五张事务表。
   * 操作：1) 事务外校验、哈希并转换本地路由。2) 先查回执，再比较和补入缺失行。
   */
  logger.info('开始导入备份');
  try {
    // 6.2 摘要涵盖原始完整 envelope，改目标指纹之前核对确认内容。
    const backup = validateBackup(input);
    if (!backupSchema.shape.source.shape.extensionId.safeParse(targetExtensionId).success) return invalid();
    const digest = await digestBackup(backup);
    if (digest !== expectedDigest) throw new BackupError('BACKUP_DIGEST_MISMATCH');
    const prepared = { ...backup.data, actions: backup.data.actions.map((row) => normalizeAction(row, backup.source.extensionId, targetExtensionId)) };
    // 6.3 五表同一事务；任何读取复核和插入失败均不产生成功回执。
    return await store.db.transaction('rw', [store.db.problems, store.db.sessions, store.db.events, store.db.actions, store.db.backupImports], async () => {
      const previous = await store.db.backupImports.get(backup.backupId);
      if (previous !== undefined) {
        const parsed = backupImportReceiptSchema.safeParse(previous);
        if (!parsed.success) return invalid();
        if (parsed.data.digest !== digest) throw new BackupError('BACKUP_ID_COLLISION');
        return parsed.data;
      }
      // 6.4 先完成所有目标比较，再插入；动作指纹自身也须解析并规范化。
      const problems = await missingRows(store.db.problems, prepared.problems, backupProblemSchema);
      const sessions = await missingRows(store.db.sessions, prepared.sessions, backupSessionSchema);
      const events = await missingRows(store.db.events, prepared.events, backupEventSchema);
      const actions = await missingRows(store.db.actions, prepared.actions, backupActionSchema, (row) => normalizeAction(row, targetExtensionId, targetExtensionId));
      await assertTargetRelations(store, prepared);
      const added = { problems: problems.length, sessions: sessions.length, events: events.length, actions: actions.length };
      const skipped = { problems: prepared.problems.length - added.problems, sessions: prepared.sessions.length - added.sessions,
        events: prepared.events.length - added.events, actions: prepared.actions.length - added.actions };
      const receipt: BackupImportReceipt = { backupId: backup.backupId, digest, sourceExtensionId: backup.source.extensionId,
        exportedAt: backup.exportedAt, importedAt: Date.now(), added, skipped };
      // 6.5 只 add 缺失事实；成功回执最后插入，事务结束后才向调用者返回。
      if (problems.length) await store.db.problems.bulkAdd(problems);
      if (sessions.length) await store.db.sessions.bulkAdd(sessions);
      if (events.length) await store.db.events.bulkAdd(events);
      if (actions.length) await store.db.actions.bulkAdd(actions);
      await store.db.backupImports.add(receipt);
      return receipt;
    });
  } catch (error) { return storageFailure(error); }
  finally { logger.info('导入备份结束'); }
}

export async function queryBackup(store: Store, backupId: string, expectedDigest: string): Promise<BackupImportReceipt | null> {
  /*
   * ========================================================================
   * 步骤8：查询持久导入结果
   * ========================================================================
   * 数据源：backupImports，不依赖后台常驻内存。
   * 操作：1) 严格校验查询和回执。2) 同 ID 不同摘要明确拒绝。
   */
  logger.info('开始查询导入结果');
  try {
    // 8.1 查询不是导入，不恢复草稿或补写学习事实。
    if (!z.uuid().safeParse(backupId).success || !/^[0-9a-f]{64}$/.test(expectedDigest)) return invalid();
    const previous = await store.db.backupImports.get(backupId);
    if (previous === undefined) return null;
    const parsed = backupImportReceiptSchema.safeParse(previous);
    if (!parsed.success) return invalid();
    if (parsed.data.digest !== expectedDigest) throw new BackupError('BACKUP_ID_COLLISION');
    return parsed.data;
  } catch (error) { return storageFailure(error); }
  finally { logger.info('查询导入结果结束'); }
}
