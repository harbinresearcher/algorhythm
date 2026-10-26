import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/core/store';
import { BackupError, digestBackup, exportBackup, importBackup, parseBackup, queryBackup, validateBackup } from '../src/core/backup';
import { backupCommandSchema, backupImportReceiptSchema, backupResponseSchema, MAX_BACKUP_BYTES, type Backup } from '../src/shared/backup';
import fixtureJson from './fixtures/backup-v1.json';
import { createBackupFixture, FIXTURE_TIME, SOURCE_EXTENSION_ID, TARGET_EXTENSION_ID, fixtureId } from './helpers/backup-fixture';

type LegacyBackup = Extract<Backup, { formatVersion: 1 }>;
const logger = console;
const fixture = fixtureJson as LegacyBackup;
const fresh = () => structuredClone(fixture);
const stores: Store[] = [];
const makeStore = (extensionId = SOURCE_EXTENSION_ID) => {
  const store = new Store(`backup-${crypto.randomUUID()}`, extensionId); stores.push(store); return store;
};
const rejects = (input: unknown, code = 'BACKUP_INVALID') => {
  expect(() => validateBackup(input)).toThrow(BackupError);
  expect(() => validateBackup(input)).toThrow(expect.objectContaining({ code }));
};
const changeCommand = (b: LegacyBackup, index: number, fields: Record<string, unknown>) => {
  const command = JSON.parse(b.data.actions[index].fingerprint);
  b.data.actions[index].fingerprint = JSON.stringify({ ...command, ...fields });
};
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(stores.splice(0).map((store) => store.db.delete()));
});

/*
 * ========================================================================
 * 步骤1：核验文件形状与真实事实链
 * ========================================================================
 * 数据源：真实 Store 固化的合成 fixture 与独立变异。
 * 操作：1) 分别断言拒绝类别。2) 验证空备份和合法时钟回拨。
 */
describe('BK-01/04 文件与事实链纯校验', () => {
  it('冻结 v1 fixture 保留真实 UUID、指纹、active/paused、多尝试和未尝试草稿', () => {
    // 1.1 独立验证历史文件，不用在线 v2 命令重建或改写旧指纹。
    expect(validateBackup(fresh())).toEqual(fixture);
    expect(fixture).toMatchObject({ formatVersion: 1, scope: 'prototype-storage-v1' });
    expect(fixture.data.sessions.map((row) => row.id)).toEqual([fixtureId(1), fixtureId(2)]);
    expect(fixture.data.sessions.map((row) => row.status)).toEqual(['active', 'paused']);
    expect(fixture.data.actions.every((row) => JSON.parse(row.fingerprint).protocolVersion === 1)).toBe(true);
    expect(fixture.data.events.filter((row) => row.kind === 'attempt')).toHaveLength(3);
    expect(fixture.data.sessions[0].draft).toContain('还没有记录为尝试');
  });
  it('真实 Store helper 生成在线 v2 动作和 v2 文件', async () => {
    /*
     * ========================================================================
     * 步骤1：区分在线生成与冻结历史样本
     * ========================================================================
     * 数据源：真实 Store 的 v2 命令与固定 v1 fixture。
     * 操作：1) 验证新文件版本与完整事实链。2) 分别核对新旧动作的协议版本。
     */
    logger.info('开始核对在线与历史备份版本');
    try {
      // 1.1 固定后台时钟，独立校验在线命令生成的四表事实。
      let time = FIXTURE_TIME; vi.spyOn(Date, 'now').mockImplementation(() => time++);
      const current = await createBackupFixture(makeStore());
      expect(current).toMatchObject({ formatVersion: 2, scope: 'practice-records-v2' });
      expect(validateBackup(current)).toEqual(current);
      expect(current.data.problems).toEqual(fixture.data.problems);
      expect(current.data.sessions.map(({ id, status, revision, draft }) => ({ id, status, revision, draft }))).toEqual(fixture.data.sessions.map(({ id, status, revision, draft }) => ({ id, status, revision, draft })));
      expect(current.data.events).toHaveLength(13);
      expect(current.data.actions).toHaveLength(13);
      // 1.2 在线动作使用 v2，历史动作的协议版本仍是 v1。
      expect(current.data.actions.every((row) => JSON.parse(row.fingerprint).protocolVersion === 2)).toBe(true);
      expect(fixture.data.actions.every((row) => JSON.parse(row.fingerprint).protocolVersion === 1)).toBe(true);
    } finally { logger.info('核对在线与历史备份版本结束'); }
  });
  it('允许空备份', () => {
    const b = fresh(); b.data = { problems: [], sessions: [], events: [], actions: [] };
    expect(validateBackup(b)).toEqual(b);
  });
  it('非法 JSON 明确归类', () => {
    expect(() => parseBackup('{')).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  });
  it('原始文件恰好 10 MiB 可解析，越界在解析前拒绝', () => {
    const b = fresh(); const text = JSON.stringify(b); const bytes = new TextEncoder().encode(text).byteLength;
    const boundary = `${' '.repeat(MAX_BACKUP_BYTES - bytes)}${text}`;
    expect(parseBackup(boundary)).toEqual(b);
    expect(() => parseBackup(` ${boundary}`)).toThrow(expect.objectContaining({ code: 'BACKUP_TOO_LARGE' }));
  });
  it.each(['format', 'formatVersion', 'scope'] as const)('未知 %s 单独归类', (field) => {
    rejects({ ...fresh(), [field]: field === 'formatVersion' ? 3 : 'foreign' }, 'BACKUP_UNSUPPORTED_VERSION');
  });
  const invalid: [string, (b: LegacyBackup) => void][] = [
    ['顶层未知字段', (b) => Object.assign(b, { apiKey: 'CONFIG_SENTINEL' })],
    ['source 未知字段', (b) => Object.assign(b.source, { config: 'CONFIG_SENTINEL' })],
    ['data 未知表', (b) => Object.assign(b.data, { backupImports: [] })],
    ['会话未知字段', (b) => Object.assign(b.data.sessions[0], { config: 'CONFIG_SENTINEL' })],
    ['回执未知字段', (b) => Object.assign(b.data.actions[0].result.session, { config: 'CONFIG_SENTINEL' })],
    ['title 超长', (b) => { b.data.problems[0].title = '字'.repeat(201); }],
    ['statement 超长', (b) => { b.data.problems[0].statement = '字'.repeat(32_001); }],
    ['draft 超长', (b) => { b.data.sessions[0].draft = '字'.repeat(32_001); }],
    ['event text 超长', (b) => { b.data.events[1].text = '字'.repeat(32_001); }],
    ['fingerprint 超长', (b) => { b.data.actions[0].fingerprint = 'x'.repeat(256_001); }],
    ['时间戳负数', (b) => { b.data.sessions[0].updatedAt = -1; }],
    ['不安全时间戳', (b) => { b.data.events[0].at = Number.MAX_SAFE_INTEGER + 1; }],
    ['revision 小数', (b) => { b.data.sessions[0].revision = 0.5; }],
    ['来源 ID 不合法', (b) => { b.source.extensionId = 'foreign'; }],
    ['悬空会话题目', (b) => { b.data.sessions[0].problemSnapshotId = fixtureId(999); }],
    ['悬空快照', (b) => { b.data.problems.push({ ...b.data.problems[0], id: fixtureId(999) }); }],
    ['两会话共享快照', (b) => { b.data.sessions[1].problemSnapshotId = b.data.sessions[0].problemSnapshotId; }],
    ['problemKey 不符', (b) => { b.data.problems[0].key = 'pair'; }],
    ['悬空事件会话', (b) => { b.data.events[0].sessionId = fixtureId(999); }],
    ['事件题目不符', (b) => { b.data.events[0].problemSnapshotId = b.data.problems[1].id; }],
    ['event/action ID 不符', (b) => { b.data.events[0].actionId = b.data.events[1].actionId; }],
    ['缺少 action', (b) => { b.data.actions.pop(); }],
    ['缺少 event', (b) => { b.data.events.pop(); }],
    ['revision 缺号', (b) => { b.data.events[1].revision = 2; }],
    ['回执 actionId 不符', (b) => { b.data.actions[0].result.actionId = fixtureId(999); }],
    ['伪造中间回执', (b) => { b.data.actions[1].result.session.draft = '伪造内容'; }],
    ['末条快照不符', (b) => { b.data.sessions[0].draft = '伪造当前快照'; }],
    ['createdAt 改写', (b) => { b.data.actions[1].result.session.createdAt++; }],
    ['start 回执非空草稿', (b) => { b.data.actions[0].result.session.draft = '伪造开始草稿'; }],
    ['巨大 revision 缺少事实', (b) => { b.data.sessions[0].revision = Number.MAX_SAFE_INTEGER; }],
    ['非文本事件夹带文本', (b) => { b.data.events[0].text = '注入文本'; }],
    ['尝试文本不符', (b) => { b.data.events[2].text = '不同尝试'; }],
    ['草稿文本不符', (b) => { b.data.events[1].text = '不同草稿'; }],
    ['状态转换不符', (b) => { b.data.events[9].kind = 'resumed'; }],
    ['指纹非法 JSON', (b) => { b.data.actions[0].fingerprint = '{'; }],
    ['指纹管理命令', (b) => { b.data.actions[0].fingerprint = JSON.stringify({ protocolVersion: 1, extensionId: SOURCE_EXTENSION_ID, actionId: b.data.actions[0].id, type: 'read' }); }],
    ['指纹未知字段', (b) => changeCommand(b, 0, { role: 'admin' })],
    ['指纹扩展 ID 不符', (b) => changeCommand(b, 0, { extensionId: 'ponmlkjihgfedcbaponmlkjihgfedcba' })],
    ['指纹协议版本不符', (b) => changeCommand(b, 0, { protocolVersion: 2 })],
    ['expectedRevision 不符', (b) => changeCommand(b, 1, { expectedRevision: 1 })],
  ];
  it.each(invalid)('独立拒绝类别：%s', (_label, mutate) => { const b = fresh(); mutate(b); rejects(b); });
  it.each(['problems', 'sessions', 'events', 'actions'] as const)('%s 重复 ID 即使内容相同也拒绝', (table) => {
    const b = fresh(); const rows = b.data[table]; rows.push(structuredClone(rows[0]) as never); rejects(b);
  });
  it.each([['problems', 1_000], ['sessions', 1_000], ['events', 10_000], ['actions', 10_000]] as const)('%s 记录数越界归类 TOO_LARGE', (table, limit) => {
    const b = fresh(); b.data[table] = Array.from({ length: limit + 1 }, () => b.data[table][0]) as never; rejects(b, 'BACKUP_TOO_LARGE');
  });
  it('后台按对象序列化 UTF-8 字节数检查', () => {
    const b = fresh(); Object.assign(b, { foreign: '中'.repeat(Math.ceil(MAX_BACKUP_BYTES / 3)) }); rejects(b, 'BACKUP_TOO_LARGE');
  });
  it('时钟回拨但 revision 连续仍合法', () => {
    const b = fresh(); b.data.events[1].at = FIXTURE_TIME - 10; b.data.actions[1].result.session.updatedAt = b.data.events[1].at;
    expect(validateBackup(b)).toEqual(b);
  });
  it('MAX_SAFE_INTEGER 时间本身合法，不假定可转为浏览器 Date', () => {
    const b = fresh(); const id = b.data.sessions[0].id;
    b.exportedAt = Number.MAX_SAFE_INTEGER;
    b.data.sessions[0].createdAt = Number.MAX_SAFE_INTEGER;
    b.data.events[0].at = Number.MAX_SAFE_INTEGER;
    for (const action of b.data.actions.filter((row) => row.result.session.id === id)) action.result.session.createdAt = Number.MAX_SAFE_INTEGER;
    b.data.actions[0].result.session.updatedAt = Number.MAX_SAFE_INTEGER;
    expect(validateBackup(b)).toEqual(b);
  });
  it('文本长度边界允许，指纹长度边界包含 JSON 空白', () => {
    const b = fresh(); b.data.problems[0].title = '字'.repeat(200); b.data.problems[0].statement = '字'.repeat(32_000);
    const action = b.data.actions[0]; action.fingerprint = `${' '.repeat(256_000 - action.fingerprint.length)}${action.fingerprint}`;
    expect(validateBackup(b)).toEqual(b);
  });
  it('空白已保存草稿不能伪造成合法尝试', () => {
    const b = fresh(); const text = ' \n\t'; changeCommand(b, 1, { text });
    b.data.events[1].text = text; b.data.events[2].text = text;
    b.data.actions[1].result.session.draft = text; b.data.actions[2].result.session.draft = text;
    rejects(b);
  });
  it('1000 个独立会话与题目恰好达到上限仍合法', () => {
    const b = fresh(); b.data = { problems: [], sessions: [], events: [], actions: [] };
    for (let i = 0; i < 1_000; i++) {
      const session = { ...fixture.data.actions[0].result.session, id: fixtureId(1_000 + i), problemSnapshotId: fixtureId(10_000 + i) };
      const id = fixtureId(20_000 + i);
      b.data.problems.push({ ...fixture.data.problems[0], id: session.problemSnapshotId }); b.data.sessions.push(session);
      b.data.events.push({ ...fixture.data.events[0], id, actionId: id, sessionId: session.id, problemSnapshotId: session.problemSnapshotId });
      b.data.actions.push({ id, fingerprint: JSON.stringify({ protocolVersion: 1, extensionId: SOURCE_EXTENSION_ID, actionId: id, type: 'start', sessionId: session.id, problemSnapshotId: session.problemSnapshotId, problemKey: session.problemKey }),
        result: { ok: true, kind: 'committed', actionId: id, session } });
    }
    expect(validateBackup(b).data.sessions).toHaveLength(1_000);
  });
  it('10000 个连续事件与动作恰好达到上限仍合法', () => {
    const b = fresh(); const first = fixture.data.actions[0]; let session = structuredClone(first.result.session);
    b.data = { problems: [fixture.data.problems[0]], sessions: [], events: [fixture.data.events[0]], actions: [first] };
    for (let revision = 1; revision < 10_000; revision++) {
      const id = fixtureId(30_000 + revision); const type = revision % 2 ? 'pause' : 'resume'; const at = FIXTURE_TIME + revision;
      session = { ...session, revision, status: type === 'pause' ? 'paused' : 'active', updatedAt: at };
      b.data.events.push({ id, actionId: id, sessionId: session.id, problemSnapshotId: session.problemSnapshotId, revision, at, kind: type === 'pause' ? 'paused' : 'resumed', source: 'synthetic-workspace' });
      b.data.actions.push({ id, fingerprint: JSON.stringify({ protocolVersion: 1, extensionId: SOURCE_EXTENSION_ID, actionId: id, type, sessionId: session.id, problemSnapshotId: session.problemSnapshotId, expectedRevision: revision - 1 }),
        result: { ok: true, kind: 'committed', actionId: id, session } });
    }
    b.data.sessions = [session];
    expect(validateBackup(b).data.events).toHaveLength(10_000);
  });
});

/*
 * ========================================================================
 * 步骤2：验证摘要内容与排列稳定性
 * ========================================================================
 * 数据源：同一文件的对象键、四表数组和学习文本变异。
 * 操作：1) 计算真实 SHA-256。2) 保证源 envelope 参与摘要。
 */
describe('BK-04/08 规范 JSON 摘要', () => {
  it('摘要匹配独立工具计算的 fixture SHA-256', async () => {
    // 2.0 字面预期来自独立 Python 标准库的规范 JSON 和 SHA-256。
    expect(await digestBackup(fresh())).toBe('b1827a2f8d7010ea02b28517a22d727132ccc6b90f0b21bbe9572498ad022b7f');
  });
  it('对象键顺序与四表数组顺序不影响摘要', async () => {
    // 2.1 只改变排列，不改变 fingerprint 字符串内部内容。
    const reorder = (v: unknown): unknown => Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).reverse().map(([key, value]) => [key, reorder(value)])) : v;
    const b = reorder(fresh()) as Backup; for (const rows of Object.values(b.data)) rows.reverse();
    expect(await digestBackup(b)).toBe(await digestBackup(fresh()));
  });
  it.each(['backupId', 'exportedAt', 'appVersion'] as const)('摘要包含完整 envelope：%s', async (field) => {
    const b = fresh(); if (field === 'backupId') b.backupId = fixtureId(901); else if (field === 'exportedAt') b.exportedAt++; else b.source.appVersion = '0.1.1';
    expect(await digestBackup(b)).not.toBe(await digestBackup(fresh()));
  });
  it('学习文本参与摘要，合法文本保持原样', async () => {
    const b = fresh(); const text = 'apiKey=用户自己写的学习文本'; b.data.problems[0].statement = text;
    expect(validateBackup(b).data.problems[0].statement).toBe(text);
    expect(await digestBackup(b)).not.toBe(await digestBackup(fresh()));
  });
  it('摘要保留原始 source.extensionId，不先改成目标实例', async () => {
    const b = fresh(); b.source.extensionId = TARGET_EXTENSION_ID;
    for (let index = 0; index < b.data.actions.length; index++) changeCommand(b, index, { extensionId: TARGET_EXTENSION_ID });
    expect(validateBackup(b)).toEqual(b);
    expect(await digestBackup(b)).not.toBe(await digestBackup(fresh()));
  });
});

/*
 * ========================================================================
 * 步骤3：核验独立管理消息与回执边界
 * ========================================================================
 * 数据源：严格共享 schema 与合成管理消息。
 * 操作：1) 不让学习命令混入管理 API。2) 拒绝不完整或夹带字段的成功回执。
 */
describe('BK-04/11 共享备份消息 schema', () => {
  const envelope = { protocolVersion: 2, extensionId: SOURCE_EXTENSION_ID, actionId: fixtureId(901) };
  it('三个管理消息通过，未知字段及学习动作不通过', () => {
    expect(backupCommandSchema.safeParse({ ...envelope, type: 'backup.export' }).success).toBe(true);
    expect(backupCommandSchema.safeParse({ ...envelope, type: 'backup.import', backup: fresh(), expectedDigest: 'a'.repeat(64) }).success).toBe(true);
    expect(backupCommandSchema.safeParse({ ...envelope, type: 'backup.query', backupId: fixture.backupId, expectedDigest: 'a'.repeat(64) }).success).toBe(true);
    expect(backupCommandSchema.safeParse({ ...envelope, type: 'backup.export', role: 'admin' }).success).toBe(false);
    expect(backupCommandSchema.safeParse(JSON.parse(fixture.data.actions[0].fingerprint)).success).toBe(false);
  });
  it('回执必须包含完整计数且不允许文本字段', () => {
    const receipt = { backupId: fixture.backupId, digest: 'a'.repeat(64), sourceExtensionId: TARGET_EXTENSION_ID, exportedAt: 0, importedAt: 0,
      added: { problems: 2, sessions: 2, events: 13, actions: 13 }, skipped: { problems: 0, sessions: 0, events: 0, actions: 0 } };
    expect(backupImportReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(backupImportReceiptSchema.safeParse({ ...receipt, text: '不能带入' }).success).toBe(false);
    expect(backupImportReceiptSchema.safeParse({ ...receipt, added: { ...receipt.added, sessions: -1 } }).success).toBe(false);
    expect(backupResponseSchema.safeParse({ ok: true, kind: 'backup.imported', actionId: envelope.actionId, receipt }).success).toBe(true);
    expect(backupResponseSchema.safeParse({ ok: true, kind: 'backup.imported', actionId: envelope.actionId, receipt: null }).success).toBe(false);
    expect(backupResponseSchema.safeParse({ ok: false, actionId: null, code: 'OUTCOME_UNKNOWN' }).success).toBe(false);
  });
});

/*
 * ========================================================================
 * 步骤4：验证一致快照、非覆盖恢复和持久回执
 * ========================================================================
 * 数据源：真实 Store、IndexedDB 事务与独立合成目标库。
 * 操作：1) 对照原四表与原动作。2) 逐种断言冲突、回滚和跨实例去重。
 */
describe('BK-01/02/03/05/06/07/08 备份核心事务', () => {
  const source = { appVersion: '0.1.0', extensionId: SOURCE_EXTENSION_ID };
  const sender = (extensionId = TARGET_EXTENSION_ID) => ({ id: extensionId, url: `chrome-extension://${extensionId}/workspace.html`, frameId: 0 });
  const seed = async (store: Store, backup = fresh()) => {
    await store.db.transaction('rw', [store.db.problems, store.db.sessions, store.db.events, store.db.actions], async () => {
      await store.db.problems.bulkAdd(backup.data.problems); await store.db.sessions.bulkAdd(backup.data.sessions);
      await store.db.events.bulkAdd(backup.data.events); await store.db.actions.bulkAdd(backup.data.actions);
    });
  };
  const snapshot = async (store: Store) => ({
    problems: await store.db.problems.toArray(), sessions: await store.db.sessions.toArray(), events: await store.db.events.toArray(),
    actions: await store.db.actions.toArray(), receipts: await store.db.backupImports.toArray(),
  });
  const restore = async (store = makeStore(TARGET_EXTENSION_ID), backup: Backup = fresh()) => {
    const digest = await digestBackup(backup);
    const receipt = await importBackup(store, backup, digest, TARGET_EXTENSION_ID);
    return { store, backup, digest, receipt };
  };
  const saveCurrent = (session: Backup['data']['sessions'][number], extensionId = TARGET_EXTENSION_ID, text = '恢复后继续保存') => ({
    protocolVersion: 2, extensionId, actionId: crypto.randomUUID(), type: 'saveDraft', sessionId: session.id,
    problemSnapshotId: session.problemSnapshotId, expectedRevision: session.revision, text,
  });
  const addIndependentSession = (backup: LegacyBackup) => {
    // 4.4 混入完全独立且合法的缺失会话，证明冲突拒绝覆盖整份文件。
    const session = { ...fixture.data.actions[0].result.session, id: fixtureId(70_001), problemSnapshotId: fixtureId(70_002) };
    const id = fixtureId(70_003);
    backup.data.problems.push({ ...fixture.data.problems[0], id: session.problemSnapshotId });
    backup.data.sessions.push(session);
    backup.data.events.push({ ...fixture.data.events[0], id, actionId: id, sessionId: session.id, problemSnapshotId: session.problemSnapshotId });
    backup.data.actions.push({ id, fingerprint: JSON.stringify({ ...JSON.parse(fixture.data.actions[0].fingerprint), actionId: id, sessionId: session.id, problemSnapshotId: session.problemSnapshotId }),
      result: { ok: true, kind: 'committed', actionId: id, session } });
  };
  it('真实 Store 多会话导出→跨扩展恢复→重导出保留四表及原动作回执', async () => {
    // 4.1 来源 fixture 从真实命令产生；只规范化目标路由，不修改原事实。
    const origin = makeStore(); const initial = await createBackupFixture(origin);
    const backup = await exportBackup(origin, source);
    expect(backup.data).toEqual(initial.data); expect(validateBackup(backup)).toEqual(backup);
    const { store, receipt } = await restore(makeStore(TARGET_EXTENSION_ID), backup);
    expect(receipt.added).toEqual({ problems: 2, sessions: 2, events: 13, actions: 13 });
    expect(receipt.skipped).toEqual({ problems: 0, sessions: 0, events: 0, actions: 0 });
    const again = await exportBackup(store, { ...source, extensionId: TARGET_EXTENSION_ID });
    const expected = structuredClone(backup.data);
    for (const action of expected.actions) action.fingerprint = JSON.stringify({ ...JSON.parse(action.fingerprint), extensionId: TARGET_EXTENSION_ID });
    expect(again.data).toEqual(expected);
    for (const action of backup.data.actions) {
      expect(await store.handle({ protocolVersion: 2, extensionId: TARGET_EXTENSION_ID, actionId: crypto.randomUUID(), type: 'queryAction', targetActionId: action.id }, sender())).toMatchObject({ ok: true, result: action.result });
      const command = { ...JSON.parse(action.fingerprint), extensionId: TARGET_EXTENSION_ID };
      expect(await store.handle(command, sender())).toEqual(action.result);
    }
    const command = { ...JSON.parse(backup.data.actions[1].fingerprint), extensionId: TARGET_EXTENSION_ID, text: '同 ID 篡改' };
    expect(await store.handle(command, sender())).toMatchObject({ ok: false, code: 'ACTION_COLLISION' });
    expect(await store.handle(JSON.parse(backup.data.actions[0].fingerprint), sender())).toMatchObject({ ok: false, code: 'INSTANCE_MISMATCH' });
    expect(await store.handle(saveCurrent(again.data.sessions[0]), sender())).toMatchObject({ ok: true, session: { revision: 6, draft: '恢复后继续保存' } });
  });
  it('旧 v1 恢复后可用 v2 查询原回执，原 v1 指纹在线重发仍拒绝', async () => {
    /*
     * ========================================================================
     * 步骤4：保留历史查询与在线版本的边界
     * ========================================================================
     * 数据源：冻结 v1 文件在另一扩展实例中的导入记录。
     * 操作：1) v2 查询原动作结果。2) 拒绝重发 v1，不重写持久指纹。
     */
    logger.info('开始核对历史动作查询与重发');
    try {
      // 4.1 跨扩展只规范化路由 ID，历史动作仍携带 v1。
      const { store, backup } = await restore();
      for (const action of backup.data.actions) {
        const command = { ...JSON.parse(action.fingerprint), extensionId: TARGET_EXTENSION_ID };
        expect(await store.handle({ protocolVersion: 2, extensionId: TARGET_EXTENSION_ID, actionId: crypto.randomUUID(), type: 'queryAction', targetActionId: action.id }, sender())).toMatchObject({ ok: true, result: action.result });
        // 4.2 版本检查先于动作幂等，不能把旧在线消息当作成功重试。
        expect(await store.handle(command, sender())).toMatchObject({ ok: false, code: 'PROTOCOL_MISMATCH' });
        expect(JSON.parse((await store.db.actions.get(action.id))!.fingerprint)).toEqual(command);
      }
    } finally { logger.info('核对历史动作查询与重发结束'); }
  });
  it('空库导出和空备份恢复都成立，每次导出生成新的 envelope', async () => {
    const store = makeStore(); const first = await exportBackup(store, source); const second = await exportBackup(store, source);
    expect(first.backupId).not.toBe(second.backupId); expect(first.data).toEqual({ problems: [], sessions: [], events: [], actions: [] });
    expect((await restore(makeStore(TARGET_EXTENSION_ID), first)).receipt.added).toEqual({ problems: 0, sessions: 0, events: 0, actions: 0 });
  });
  it('同文件重试先查持久回执，继续练习后不会恢复旧草稿', async () => {
    const { store, backup, digest, receipt } = await restore();
    await store.handle(saveCurrent(backup.data.sessions[0]), sender());
    const before = await snapshot(store);
    expect(await importBackup(store, backup, digest, TARGET_EXTENSION_ID)).toEqual(receipt);
    expect(await snapshot(store)).toEqual(before);
  });
  it('同 backupId 不同摘要明确碰撞，不改数据', async () => {
    const { store, backup, receipt } = await restore(); const before = await snapshot(store);
    backup.data.problems[0].statement = '同 ID 的新内容'; const other = await digestBackup(backup);
    await expect(importBackup(store, backup, other, TARGET_EXTENSION_ID)).rejects.toMatchObject({ code: 'BACKUP_ID_COLLISION' });
    await expect(queryBackup(store, backup.backupId, other)).rejects.toMatchObject({ code: 'BACKUP_ID_COLLISION' });
    expect(await snapshot(store)).toEqual(before); expect(before.receipts).toEqual([receipt]);
  });
  it('摘要不符独立拒绝，选择文件或纯校验不写库', async () => {
    const store = makeStore(TARGET_EXTENSION_ID); const before = await snapshot(store);
    const backup = validateBackup(parseBackup(JSON.stringify(fixture)));
    await expect(importBackup(store, backup, 'f'.repeat(64), TARGET_EXTENSION_ID)).rejects.toMatchObject({ code: 'BACKUP_DIGEST_MISMATCH' });
    expect(await snapshot(store)).toEqual(before);
  });
  it('已有相同行跳过，只添加缺失行，目标独立会话完整保留', async () => {
    const store = makeStore(TARGET_EXTENSION_ID);
    const command = { protocolVersion: 2, extensionId: TARGET_EXTENSION_ID, actionId: fixtureId(5_000), type: 'start', sessionId: fixtureId(5_001), problemSnapshotId: fixtureId(5_002), problemKey: 'pair' };
    expect(await store.handle(command, sender())).toMatchObject({ ok: true });
    await store.db.problems.add(fixture.data.problems[0]);
    const { receipt } = await restore(store);
    expect(receipt.added).toEqual({ problems: 1, sessions: 2, events: 13, actions: 13 });
    expect(receipt.skipped).toEqual({ problems: 1, sessions: 0, events: 0, actions: 0 });
    expect(await store.db.sessions.count()).toBe(3);
    expect(await store.db.actions.get(command.actionId)).toMatchObject({ result: { session: { id: command.sessionId, revision: 0 } } });
  });
  it('目标同 ID 任一行不同则整份冲突，不补入其他缺失行', async () => {
    const store = makeStore(TARGET_EXTENSION_ID);
    await store.db.problems.add({ ...fixture.data.problems[0], title: '已经存在的不同内容' });
    const before = await snapshot(store);
    await expect(restore(store)).rejects.toMatchObject({ code: 'BACKUP_CONFLICT' });
    expect(await snapshot(store)).toEqual(before);
  });
  it('跨文件重复占用题目快照时整份冲突，独立会话也不补入', async () => {
    const { store } = await restore(); const backup = fresh(); backup.backupId = fixtureId(71_000);
    const sessions = new Map(backup.data.sessions.map((row, index) => [row.id, fixtureId(71_100 + index)]));
    const actions = new Map(backup.data.actions.map((row, index) => [row.id, fixtureId(71_200 + index)]));
    for (const session of backup.data.sessions) session.id = sessions.get(session.id)!;
    for (const event of backup.data.events) { event.id = actions.get(event.id)!; event.actionId = event.id; event.sessionId = sessions.get(event.sessionId)!; }
    for (const action of backup.data.actions) {
      action.id = actions.get(action.id)!; action.result.actionId = action.id;
      action.result.session.id = sessions.get(action.result.session.id)!;
      action.fingerprint = JSON.stringify({ ...JSON.parse(action.fingerprint), actionId: action.id, sessionId: action.result.session.id });
    }
    addIndependentSession(backup);
    expect(validateBackup(backup)).toEqual(backup);
    const digest = await digestBackup(backup); const before = await snapshot(store);
    await expect(importBackup(store, backup, digest, TARGET_EXTENSION_ID)).rejects.toMatchObject({ code: 'BACKUP_CONFLICT' });
    expect(await snapshot(store)).toEqual(before);
    expect(await queryBackup(store, backup.backupId, digest)).toBeNull();
    expect((await exportBackup(store, { ...source, extensionId: TARGET_EXTENSION_ID })).data.sessions).toHaveLength(2);
  });
  it('跨文件为同会话同 revision 换一组动作身份时整份冲突，独立会话也不补入', async () => {
    const { store } = await restore(); const backup = fresh(); backup.backupId = fixtureId(72_000);
    const actions = new Map(backup.data.actions.map((row, index) => [row.id, fixtureId(72_200 + index)]));
    for (const event of backup.data.events) { event.id = actions.get(event.id)!; event.actionId = event.id; }
    for (const action of backup.data.actions) {
      action.id = actions.get(action.id)!; action.result.actionId = action.id;
      action.fingerprint = JSON.stringify({ ...JSON.parse(action.fingerprint), actionId: action.id });
    }
    addIndependentSession(backup);
    expect(validateBackup(backup)).toEqual(backup);
    const digest = await digestBackup(backup); const before = await snapshot(store);
    await expect(importBackup(store, backup, digest, TARGET_EXTENSION_ID)).rejects.toMatchObject({ code: 'BACKUP_CONFLICT' });
    expect(await snapshot(store)).toEqual(before);
    expect(await queryBackup(store, backup.backupId, digest)).toBeNull();
    expect((await exportBackup(store, { ...source, extensionId: TARGET_EXTENSION_ID })).data.events).toHaveLength(13);
  });
  it('目标同会话留有备份之外的动作身份时拒绝，不能把孤立动作藏入新回执', async () => {
    const { store, backup } = await restore(); backup.backupId = fixtureId(73_000);
    const action = structuredClone((await store.db.actions.toArray())[0]); action.id = fixtureId(73_001); action.result.actionId = action.id;
    action.fingerprint = JSON.stringify({ ...JSON.parse(action.fingerprint), actionId: action.id });
    await store.db.actions.add(action); const before = await snapshot(store);
    await expect(restore(store, backup)).rejects.toMatchObject({ code: 'BACKUP_CONFLICT' });
    expect(await snapshot(store)).toEqual(before);
  });
  it('目标仅保留合法备份的部分表行时仍可补齐原历史', async () => {
    const original = await restore(); const existing = await snapshot(original.store); const store = makeStore(TARGET_EXTENSION_ID);
    await store.db.problems.add(existing.problems[0]); await store.db.sessions.add(existing.sessions[0]);
    await store.db.events.bulkAdd(existing.events.slice(0, 2)); await store.db.actions.bulkAdd(existing.actions.slice(0, 2));
    const { receipt } = await restore(store);
    expect(receipt.added).toEqual({ problems: 1, sessions: 1, events: 11, actions: 11 });
    expect(receipt.skipped).toEqual({ problems: 1, sessions: 1, events: 2, actions: 2 });
    expect(validateBackup(await exportBackup(store, { ...source, extensionId: TARGET_EXTENSION_ID })).data.sessions).toHaveLength(2);
  });
  it('目标匹配行自身非法不能被导入掩盖', async () => {
    const store = makeStore(TARGET_EXTENSION_ID);
    await store.db.problems.add(Object.assign({ ...fixture.data.problems[0] }, { apiKey: 'ILLEGAL_TARGET_FIELD' }));
    const before = await snapshot(store);
    await expect(restore(store)).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
    expect(await snapshot(store)).toEqual(before);
  });
  it('目标 action 指纹先解析规范化，字段排列差异不产生冲突', async () => {
    const { store, backup } = await restore();
    const action = (await store.db.actions.toArray())[1];
    action.fingerprint = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(action.fingerprint)).reverse()));
    await store.db.actions.put(action); backup.backupId = fixtureId(902);
    const { receipt } = await restore(store, backup);
    expect(receipt.added).toEqual({ problems: 0, sessions: 0, events: 0, actions: 0 });
    expect(receipt.skipped).toEqual({ problems: 2, sessions: 2, events: 13, actions: 13 });
    expect((await store.db.actions.get(action.id))?.fingerprint).toBe(action.fingerprint);
  });
  it('目标 action 指纹损坏明确拒绝', async () => {
    const { store, backup } = await restore(); const action = (await store.db.actions.toArray())[0];
    await store.db.actions.put({ ...action, fingerprint: 'not-json' }); backup.backupId = fixtureId(903);
    const before = await snapshot(store);
    await expect(restore(store, backup)).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
    expect(await snapshot(store)).toEqual(before);
  });
  it.each([['AbortError', 'STORAGE_FAILED'], ['QuotaExceededError', 'STORAGE_FULL'], ['SecurityError', 'STORAGE_DENIED']] as const)('最后回执 add 发生 %s 时五表一同回滚并可手动重试', async (name, code) => {
    const store = makeStore(TARGET_EXTENSION_ID); const backup = fresh(); const digest = await digestBackup(backup);
    vi.spyOn(store.db.backupImports, 'add').mockRejectedValueOnce(new DOMException('PRIVATE_FAILURE_SENTINEL', name));
    await expect(importBackup(store, backup, digest, TARGET_EXTENSION_ID)).rejects.toMatchObject({ code });
    expect(await snapshot(store)).toEqual({ problems: [], sessions: [], events: [], actions: [], receipts: [] });
    expect(await queryBackup(store, backup.backupId, digest)).toBeNull();
    expect((await importBackup(store, backup, digest, TARGET_EXTENSION_ID)).added.actions).toBe(13);
  });
  it('提交后丢响应、重开数据库仍按 backupId 查询原结果，未提交则 null', async () => {
    const { store, backup, digest, receipt } = await restore();
    store.db.close(); await store.db.open();
    expect(await queryBackup(store, backup.backupId, digest)).toEqual(receipt);
    expect(await queryBackup(store, fixtureId(999), digest)).toBeNull();
  });
  it('导出显式白名单过滤系统哨兵，合法学习文本保留，日志没有文本与指纹', async () => {
    const store = makeStore(); await seed(store); const text = '用户学习文本 apiKey=自己写下的例子';
    await store.db.problems.put(Object.assign({ ...fixture.data.problems[0], statement: text }, { config: 'SYSTEM_CONFIG_SENTINEL' }));
    await store.db.sessions.put(Object.assign({ ...fixture.data.sessions[0] }, { apiKey: 'SYSTEM_CONFIG_SENTINEL' }));
    const action = structuredClone(fixture.data.actions[0]); Object.assign(action, { config: 'SYSTEM_CONFIG_SENTINEL' }); Object.assign(action.result.session, { config: 'SYSTEM_CONFIG_SENTINEL' }); await store.db.actions.put(action);
    await store.db.diagnostics.add(Object.assign({ id: crypto.randomUUID(), actionId: null, code: 'STORAGE_FAILED' as const, at: FIXTURE_TIME }, { detail: 'DIAGNOSTIC_SENTINEL' }));
    const backup = await exportBackup(store, source); const serialized = JSON.stringify(backup);
    expect(serialized).toContain(text); expect(serialized).not.toContain('SYSTEM_CONFIG_SENTINEL'); expect(serialized).not.toContain('DIAGNOSTIC_SENTINEL'); expect(serialized).not.toContain('backupImports');
    const log = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(log).not.toContain(text); expect(log).not.toContain('SYSTEM_CONFIG_SENTINEL'); expect(log).not.toContain('DIAGNOSTIC_SENTINEL'); expect(log).not.toContain(action.fingerprint);
  });
  it('导出遇损坏数据或未知指纹版本时失败，不修复源行', async () => {
    const store = makeStore(); await seed(store); const action = structuredClone(fixture.data.actions[0]);
    action.fingerprint = JSON.stringify({ ...JSON.parse(action.fingerprint), protocolVersion: 3 }); await store.db.actions.put(action);
    const before = await snapshot(store);
    await expect(exportBackup(store, source)).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
    expect(await snapshot(store)).toEqual(before);
  });
  it('导出与真实学习写入并发时只产生完整旧快照或新快照', async () => {
    const store = makeStore(); await seed(store); const current = fixture.data.sessions[0];
    const [backup, result] = await Promise.all([exportBackup(store, source), store.handle(saveCurrent(current, SOURCE_EXTENSION_ID, '并发更新'), sender(SOURCE_EXTENSION_ID))]);
    expect(result.ok).toBe(true); expect(validateBackup(backup)).toEqual(backup);
    const exported = backup.data.sessions.find((row) => row.id === current.id)!;
    expect([5, 6]).toContain(exported.revision);
    expect(exported.draft).toBe(exported.revision === 5 ? current.draft : '并发更新');
    expect(backup.data.events).toHaveLength(exported.revision === 5 ? 13 : 14);
  });
  it('预览后目标继续写入，事务复核拒绝旧快照且不插入成功回执', async () => {
    const { store, backup } = await restore(); backup.backupId = fixtureId(904); const digest = await digestBackup(backup);
    await store.handle(saveCurrent(backup.data.sessions[0]), sender()); const before = await snapshot(store);
    await expect(importBackup(store, backup, digest, TARGET_EXTENSION_ID)).rejects.toMatchObject({ code: 'BACKUP_CONFLICT' });
    expect(await snapshot(store)).toEqual(before); expect(await queryBackup(store, backup.backupId, digest)).toBeNull();
  });
  it('同文件两次并发导入共享数据库回执，事实只保存一次', async () => {
    const store = makeStore(TARGET_EXTENSION_ID); const backup = fresh(); const digest = await digestBackup(backup);
    const [first, second] = await Promise.all([importBackup(store, backup, digest, TARGET_EXTENSION_ID), importBackup(store, backup, digest, TARGET_EXTENSION_ID)]);
    expect(first).toEqual(second); expect(await store.db.backupImports.count()).toBe(1);
    expect(await store.db.events.count()).toBe(13); expect(await store.db.actions.count()).toBe(13);
  });
  it('导入最后一步排入外部学习写入，写入等待原子提交后继续保存', async () => {
    const store = makeStore(TARGET_EXTENSION_ID); const backup = fresh(); const digest = await digestBackup(backup);
    let writing: ReturnType<Store['handle']> | undefined;
    const add = store.db.backupImports.add.bind(store.db.backupImports);
    vi.spyOn(store.db.backupImports, 'add').mockImplementationOnce((receipt) => {
      // 4.2 用独立事务模拟另一页面到达的写入，不能作为当前事务的嵌套任务。
      writing = Dexie.ignoreTransaction(() => store.handle(saveCurrent(backup.data.sessions[0], TARGET_EXTENSION_ID, '并发写入保留'), sender()));
      return add(receipt);
    });
    const receipt = await importBackup(store, backup, digest, TARGET_EXTENSION_ID);
    expect(receipt.added.events).toBe(13); expect(writing).toBeDefined();
    expect(await writing).toMatchObject({ ok: true, session: { draft: '并发写入保留', revision: 6 } });
    expect(await store.db.events.count()).toBe(14); expect(await queryBackup(store, backup.backupId, digest)).toEqual(receipt);
    expect(validateBackup(await exportBackup(store, { ...source, extensionId: TARGET_EXTENSION_ID })).data.sessions[0].draft).toBe('并发写入保留');
  });
  it('WebCrypto 哈希在所有 IndexedDB 事务之外等待', async () => {
    const store = makeStore(TARGET_EXTENSION_ID); const backup = fresh(); const digest = await digestBackup(backup);
    const realDigest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'digest').mockImplementation((algorithm, bytes) => {
      // 4.3 校验与原始数据写入真实运行，仅在哈希边界观察事务状态。
      expect(Dexie.currentTransaction).toBeNull(); return realDigest(algorithm, bytes);
    });
    expect((await importBackup(store, backup, digest, TARGET_EXTENSION_ID)).added.sessions).toBe(2);
  });
  it('目标历史动作携带错误扩展 ID 不能靠规范化掩盖', async () => {
    const { store, backup } = await restore(); backup.backupId = fixtureId(905);
    const action = (await store.db.actions.toArray())[0];
    await store.db.actions.put({ ...action, fingerprint: JSON.stringify({ ...JSON.parse(action.fingerprint), extensionId: SOURCE_EXTENSION_ID }) });
    const before = await snapshot(store);
    await expect(restore(store, backup)).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
    expect(await snapshot(store)).toEqual(before);
  });
  it('目标回执自身非法时查询和重试都拒绝，不用旧元数据掩盖损坏', async () => {
    const { store, backup, digest, receipt } = await restore();
    await store.db.backupImports.put(Object.assign({ ...receipt }, { text: 'ILLEGAL_RECEIPT_TEXT' }));
    const before = await snapshot(store);
    await expect(queryBackup(store, backup.backupId, digest)).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
    await expect(importBackup(store, backup, digest, TARGET_EXTENSION_ID)).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
    expect(await snapshot(store)).toEqual(before);
  });
  it('导出超限数据不裁剪或删除源记录', async () => {
    const store = makeStore();
    await store.db.problems.bulkAdd(Array.from({ length: 1_001 }, (_, index) => ({ ...fixture.data.problems[0], id: fixtureId(50_000 + index) })));
    await expect(exportBackup(store, source)).rejects.toMatchObject({ code: 'BACKUP_TOO_LARGE' });
    expect(await store.db.problems.count()).toBe(1_001); expect(await store.db.backupImports.count()).toBe(0);
  });
});
