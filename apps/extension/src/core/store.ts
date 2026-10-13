import Dexie, { type Table } from 'dexie';
import { z } from 'zod';
import {
  commandSchema, PROTOCOL_VERSION, SYNTHETIC_PROBLEMS,
  type ActionRecord, type Command, type Committed, type Diagnostic, type ErrorCode,
  type LearningEvent, type Problem, type Response, type Session, type WriteCommand,
} from '../shared/protocol';

export type Sender = { id?: string; url?: string; frameId?: number; origin?: string };
const logger = console;
class Database extends Dexie {
  sessions!: Table<Session, string>;
  problems!: Table<Problem, string>;
  events!: Table<LearningEvent, string>;
  actions!: Table<ActionRecord, string>;
  diagnostics!: Table<Diagnostic, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ sessions: 'id,updatedAt', problems: 'id', events: 'id,sessionId,kind', actions: 'id', diagnostics: 'id,at' });
  }
}
class Rejection extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}
export function classifyStorageError(error: unknown): ErrorCode {
  if (error instanceof Rejection) return error.code;
  const name = error instanceof Error ? error.name : '';
  if (name === 'QuotaExceededError') return 'STORAGE_FULL';
  if (name === 'SecurityError' || name === 'NotAllowedError') return 'STORAGE_DENIED';
  return 'STORAGE_FAILED';
}
export class Store {
  readonly db: Database;
  constructor(name: string, private readonly extensionId: string) { this.db = new Database(name); }

  async handle(input: unknown, sender: Sender): Promise<Response> {
    /*
     * ========================================================================
     * 步骤1：核验消息身份与协议
     * ========================================================================
     * 数据源：浏览器 sender 与不可信消息。
     * 操作：1) 核验来源与版本。2) schema 校验字段，不信任自报角色。
     */
    logger.info('开始校验扩展命令');
    // 1.1 只取合法动作 ID，诊断不存原始输入。
    const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const actionId = z.uuid().safeParse(raw.actionId).success ? raw.actionId as string : null;
    try {
      let url: URL;
      try { url = new URL(sender.url ?? ''); } catch { throw new Rejection('FORBIDDEN'); }
      // 原生侧栏无 tab 时不提供 frameId；仍严格核验扩展 ID、页面和 origin。
      if (sender.id !== this.extensionId || (sender.frameId !== undefined && sender.frameId !== 0) ||
          url.protocol !== 'chrome-extension:' || url.hostname !== this.extensionId ||
          !['/workspace.html', '/sidepanel.html'].includes(url.pathname) ||
          (sender.origin !== undefined && sender.origin !== `chrome-extension://${this.extensionId}`)) throw new Rejection('FORBIDDEN');
      // 1.2 先区分版本与数据空间，再解析完整命令。
      if (raw.protocolVersion !== PROTOCOL_VERSION) throw new Rejection('PROTOCOL_MISMATCH');
      if (raw.extensionId !== this.extensionId) throw new Rejection('INSTANCE_MISMATCH');
      const parsed = commandSchema.safeParse(input);
      if (!parsed.success) throw new Rejection('INVALID_COMMAND');
      logger.info('扩展命令校验完成');
      return await this.execute(parsed.data);
    } catch (error) {
      const code = classifyStorageError(error);
      // 1.3 诊断失败只在内存报告，不递归写日志。
      try { await this.db.diagnostics.add({ id: crypto.randomUUID(), actionId, code, at: Date.now() }); } catch { /* 存储不可用时不再写入。 */ }
      logger.info('扩展命令结束', { actionId, code });
      return { ok: false, actionId, code };
    }
  }

  private async execute(command: Command): Promise<Response> {
    if (command.type === 'read') {
      return this.db.transaction('r', [this.db.sessions, this.db.problems, this.db.events], async () => ({
        ok: true as const, kind: 'snapshot' as const, actionId: command.actionId,
        sessions: await this.db.sessions.orderBy('updatedAt').reverse().toArray(),
        problems: await this.db.problems.toArray(), events: await this.db.events.toArray(),
      }));
    }
    if (command.type === 'queryAction') return { ok: true, kind: 'action', actionId: command.actionId, result: (await this.db.actions.get(command.targetActionId))?.result ?? null };
    return this.write(command);
  }

  private async write(command: WriteCommand): Promise<Committed> {
    /*
     * ========================================================================
     * 步骤2：事务提交事实与回执
     * ========================================================================
     * 数据源：已校验命令与 IndexedDB。
     * 操作：1) 先幂等核对再检查版本。2) 原子保存快照、事件与回执。
     */
    logger.info('开始保存命令', { actionId: command.actionId, type: command.type });
    try {
      // 2.1 schema 输出固定字段顺序；输入 JSON 字段顺序不影响幂等。
      const fingerprint = JSON.stringify(command);
      return await this.db.transaction('rw', [this.db.sessions, this.db.problems, this.db.events, this.db.actions], async () => {
        const previous = await this.db.actions.get(command.actionId);
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new Rejection('ACTION_COLLISION');
          return previous.result;
        }
        const now = Date.now();
        let session: Session;
        let kind: LearningEvent['kind'];
        let text: string | undefined;
        if (command.type === 'start') {
          if (await this.db.sessions.get(command.sessionId) || await this.db.problems.get(command.problemSnapshotId)) throw new Rejection('REFERENCE_MISMATCH');
          session = { id: command.sessionId, problemSnapshotId: command.problemSnapshotId, problemKey: command.problemKey, status: 'active', revision: 0, draft: '', createdAt: now, updatedAt: now };
          await this.db.problems.add({ id: command.problemSnapshotId, ...SYNTHETIC_PROBLEMS[command.problemKey] });
          kind = 'started';
        } else {
          // 2.2 题目身份与 revision 不由当前标签页推测。
          const current = await this.db.sessions.get(command.sessionId);
          if (!current) throw new Rejection('NOT_FOUND');
          if (current.problemSnapshotId !== command.problemSnapshotId) throw new Rejection('REFERENCE_MISMATCH');
          if (current.revision !== command.expectedRevision) throw new Rejection('REVISION_CONFLICT');
          if (current.status !== (command.type === 'resume' ? 'paused' : 'active')) throw new Rejection('INVALID_STATE');
          session = { ...current, revision: current.revision + 1, updatedAt: now };
          if (command.type === 'saveDraft') { session.draft = command.text; kind = 'draft'; text = command.text; }
          else if (command.type === 'pause') { session.status = 'paused'; kind = 'paused'; }
          else if (command.type === 'resume') { session.status = 'active'; kind = 'resumed'; }
          else {
            if (!current.draft.trim()) throw new Rejection('INVALID_STATE');
            kind = 'attempt'; text = current.draft;
          }
        }
        // 2.3 事务完成后才返回成功，事件与原回执不覆写。
        await this.db.sessions.put(session);
        await this.db.events.add({ id: command.actionId, actionId: command.actionId, sessionId: session.id, problemSnapshotId: session.problemSnapshotId, revision: session.revision, at: now, kind, source: 'synthetic-workspace', ...(text === undefined ? {} : { text }) });
        const result: Committed = { ok: true, kind: 'committed', actionId: command.actionId, session };
        await this.db.actions.add({ id: command.actionId, fingerprint, result });
        return result;
      });
    } finally { logger.info('保存命令结束', { actionId: command.actionId }); }
  }
}
