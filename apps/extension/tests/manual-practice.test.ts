import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/core/store';
import { normalizeManualProblem } from '../src/shared/manual-problem';
import { commandSchema, PROTOCOL_VERSION } from '../src/shared/protocol';
import { commandSchema as legacyCommandSchema, PROTOCOL_VERSION as LEGACY_VERSION } from '../src/shared/legacy-protocol';
import fixture from './fixtures/backup-v1.json';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const sender = { id: extensionId, url: `chrome-extension://${extensionId}/workspace.html`, frameId: 0 };
const stores: Store[] = [];
const makeStore = () => { const store = new Store(`manual-${crypto.randomUUID()}`, extensionId); stores.push(store); return store; };
const envelope = () => ({ protocolVersion: 2, extensionId, actionId: crypto.randomUUID() });
const manual = (fields: Record<string, unknown> = {}) => ({ ...envelope(), type: 'startManual', sessionId: crypto.randomUUID(), problemSnapshotId: crypto.randomUUID(), title: '我的数组练习', url: null, ...fields });
const counts = async (store: Store) => Promise.all([store.db.problems.count(), store.db.sessions.count(), store.db.events.count(), store.db.actions.count()]);
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map((store) => store.db.delete())); });

/*
 * ========================================================================
 * 步骤1：固定手动标题及原题链接的纯规范化边界
 * ========================================================================
 * 数据源：原创标题和本地 URL 字符串，不访问题目网站。
 * 操作：1) 只接受指定主机与路径。2) 恶意或未规范输入返回固定错误，不泄露内容。
 */
describe('MP-01/05 手动题目纯规范化', () => {
  it.each([
    ['  我的数组练习\n', '', '我的数组练习', null],
    ['<img src=x onerror=alert(1)>', '  ', '<img src=x onerror=alert(1)>', null],
    ['😀'.repeat(100), '', '😀'.repeat(100), null],
    ['我的练习', 'https://leetcode.cn/problems/two-sum/', '我的练习', 'https://leetcode.cn/problems/two-sum/'],
    ['我的练习', 'https://leetcode.cn/problems/two-sum/description/?x=1#part', '我的练习', 'https://leetcode.cn/problems/two-sum/'],
    ['我的练习', 'https://leetcode.cn/problems/two-sum/submissions', '我的练习', 'https://leetcode.cn/problems/two-sum/'],
    ['我的练习', 'https://leetcode.cn/problems/two-sum/solutions/?q=%2F#%20', '我的练习', 'https://leetcode.cn/problems/two-sum/'],
    ['我的练习', ' HTTPS://LEETCODE.CN:443/problems/two-sum ', '我的练习', 'https://leetcode.cn/problems/two-sum/'],
  ])('规范化合法输入 %#', (title, url, expectedTitle, expectedUrl) => {
    expect(normalizeManualProblem({ title: title!, url: url! })).toEqual({ title: expectedTitle, url: expectedUrl });
  });
  it.each(['', ' \n\t ', '字'.repeat(201), '😀'.repeat(100) + 'x'])('拒绝空白或过长标题 %#', (title) => {
    expect(() => normalizeManualProblem({ title, url: '' })).toThrow(expect.objectContaining({ code: 'INVALID_TITLE', message: 'INVALID_TITLE' }));
  });
  it.each([
    'http://leetcode.cn/problems/two-sum/', 'https://leetcode.com/problems/two-sum/', 'https://leetcode.cn.evil.test/problems/two-sum/',
    'https://evil.test@leetcode.cn/problems/two-sum/', 'https://user:password@leetcode.cn/problems/two-sum/', 'https://@leetcode.cn/problems/two-sum/',
    'https://leetcode.cn:444/problems/two-sum/', 'https://leetcode.cn./problems/two-sum/', 'https://ｌｅｅｔｃｏｄｅ.cn/problems/two-sum/',
    'https://%6ceetcode.cn/problems/two-sum/', 'https:leetcode.cn/problems/two-sum/', 'javascript:alert(1)', '//leetcode.cn/problems/two-sum/',
    'https://leetcode.cn/problems/%74wo-sum/', 'https://leetcode.cn/problems/wrong/%2e%2e/two-sum/', 'https://leetcode.cn/problems/wrong/../two-sum/',
    'https://leetcode.cn/problems/two-sum\\description/', 'https://leetcode.cn/pro\nblems/two-sum/', 'https://leetcode.cn/problems/Upper/',
    'https://leetcode.cn/problems/two sum/', 'https://leetcode.cn/problems/' + 'a'.repeat(201), 'https://leetcode.cn/problems//',
    'https://leetcode.cn/contest/two-sum/', 'https://leetcode.cn/problems/two-sum/editorial/', 'https://leetcode.cn/problems/two-sum/submissions/10001/',
  ])('拒绝非允许或被URL解析器掩盖的路径 %#', (url) => {
    expect(() => normalizeManualProblem({ title: '我的练习', url })).toThrow(expect.objectContaining({ code: 'INVALID_URL', message: 'INVALID_URL' }));
  });
});

/*
 * ========================================================================
 * 步骤2：验证在线 v2 事务、来源及 legacy 历史不变
 * ========================================================================
 * 数据源：真实 Store、合法浏览器 sender 与冻结的 v1 合成文件。
 * 操作：1) 四表原子记录并去重。2) 旧事实只读入及续练，不在线接受旧协议。
 */
describe('MP-02/06 手动会话与历史兼容', () => {
  it('在线协议为2，冻结v1不接受手动命令', () => {
    expect(PROTOCOL_VERSION).toBe(2); expect(LEGACY_VERSION).toBe(1);
    expect(commandSchema.safeParse(manual()).success).toBe(true);
    expect(legacyCommandSchema.safeParse({ ...manual(), protocolVersion: 1 }).success).toBe(false);
    expect(legacyCommandSchema.safeParse({ ...envelope(), type: 'read' }).success).toBe(false);
  });
  it('有无链接均原子提交四表，来源明确为用户记录', async () => {
    const store = makeStore(); const first = manual();
    expect(await store.handle(first, sender)).toMatchObject({ ok: true, kind: 'committed', actionId: first.actionId, session: { id: first.sessionId, problemKey: 'manual', revision: 0, draft: '', status: 'active' } });
    expect(await counts(store)).toEqual([1, 1, 1, 1]);
    expect(await store.db.problems.get(first.problemSnapshotId)).toEqual({ id: first.problemSnapshotId, key: 'manual', title: '我的数组练习', statement: '', source: 'manual-user-v1', url: null });
    expect(await store.db.events.get(first.actionId)).toMatchObject({ source: 'manual-workspace', kind: 'started', revision: 0 });
    expect(await store.handle(manual({ url: 'https://leetcode.cn/problems/two-sum/' }), sender)).toMatchObject({ ok: true });
    expect(await counts(store)).toEqual([2, 2, 2, 2]);
  });
  it('同动作相同输入返回原回执，标题或URL变化碰撞不创建新会话', async () => {
    const store = makeStore(); const command = manual(); const first = await store.handle(command, sender);
    expect(first.ok).toBe(true); expect(await store.handle(command, sender)).toEqual(first);
    expect(await store.handle({ ...command, title: '另一标题' }, sender)).toMatchObject({ code: 'ACTION_COLLISION' });
    expect(await store.handle({ ...command, url: 'https://leetcode.cn/problems/two-sum/' }, sender)).toMatchObject({ code: 'ACTION_COLLISION' });
    expect(await counts(store)).toEqual([1, 1, 1, 1]);
  });
  it.each([['AbortError', 'STORAGE_FAILED'], ['QuotaExceededError', 'STORAGE_FULL'], ['SecurityError', 'STORAGE_DENIED']])('最后回执%s失败四表全部回滚', async (name, code) => {
    const store = makeStore(); const command = manual();
    vi.spyOn(store.db.actions, 'add').mockRejectedValueOnce(new DOMException('PRIVATE_SENTINEL', name));
    expect(await store.handle(command, sender)).toMatchObject({ ok: false, code }); expect(await counts(store)).toEqual([0, 0, 0, 0]);
    expect(await store.handle(command, sender)).toMatchObject({ ok: true }); expect(await counts(store)).toEqual([1, 1, 1, 1]);
  });
  it('同一原题链接可创建不同会话，互不覆盖', async () => {
    const store = makeStore(); const url = 'https://leetcode.cn/problems/two-sum/';
    const a = manual({ url }); const b = manual({ url });
    expect((await store.handle(a, sender)).ok).toBe(true); expect((await store.handle(b, sender)).ok).toBe(true);
    expect(await counts(store)).toEqual([2, 2, 2, 2]);
  });
  it('后续动作从实际manual快照保持事件来源，暂停恢复规则不变', async () => {
    const store = makeStore(); const command = manual(); await store.handle(command, sender);
    const reference = { sessionId: command.sessionId, problemSnapshotId: command.problemSnapshotId };
    const send = (type: string, revision: number, fields = {}) => store.handle({ ...envelope(), ...reference, type, expectedRevision: revision, ...fields }, sender);
    expect(await send('saveDraft', 0, { text: '# 我自己的代码' })).toMatchObject({ ok: true });
    expect(await send('recordAttempt', 1)).toMatchObject({ ok: true });
    expect(await send('pause', 2)).toMatchObject({ ok: true, session: { status: 'paused' } });
    expect(await send('saveDraft', 3, { text: '不应保存' })).toMatchObject({ code: 'INVALID_STATE' });
    expect(await send('resume', 3)).toMatchObject({ ok: true, session: { status: 'active' } });
    expect((await store.db.events.toArray()).map((row) => row.source)).toEqual(Array(5).fill('manual-workspace'));
    expect(await store.db.events.where('kind').equals('attempt').first()).toMatchObject({ text: '# 我自己的代码' });
  });
  it.each([
    { title: '   ' }, { title: 'x'.repeat(201) }, { title: ' 未去空白 ' }, { url: '' }, { url: 'https://leetcode.cn/problems/two-sum/description/?a=1' },
    { url: 'http://leetcode.cn/problems/two-sum/' }, { source: 'manual-user-v1' }, { statement: '' }, { revision: 0 }, { createdAt: 1 },
  ])('服务器只接受规范化严格命令 %j', async (fields) => {
    const store = makeStore(); expect(await store.handle(manual(fields), sender)).toMatchObject({ code: 'INVALID_COMMAND' }); expect(await counts(store)).toEqual([0, 0, 0, 0]);
  });
  it('v2 start不能借manual key创建，v1页面消息明确拒绝', async () => {
    const store = makeStore(); const input = manual();
    expect(await store.handle({ ...envelope(), type: 'start', sessionId: input.sessionId, problemSnapshotId: input.problemSnapshotId, problemKey: 'manual' }, sender)).toMatchObject({ code: 'INVALID_COMMAND' });
    expect(await store.handle({ ...input, protocolVersion: 1 }, sender)).toMatchObject({ code: 'PROTOCOL_MISMATCH' });
    expect(await counts(store)).toEqual([0, 0, 0, 0]);
  });
  it('旧synthetic库可读取、查询旧回执并以v2续练，不重写v1指纹', async () => {
    const store = makeStore();
    await store.db.transaction('rw', [store.db.problems, store.db.sessions, store.db.events, store.db.actions], async () => {
      await store.db.problems.bulkAdd(fixture.data.problems as never); await store.db.sessions.bulkAdd(fixture.data.sessions as never);
      await store.db.events.bulkAdd(fixture.data.events as never); await store.db.actions.bulkAdd(fixture.data.actions as never);
    });
    const oldActions = await store.db.actions.toArray(); const session = fixture.data.sessions[0]; const action = fixture.data.actions[0];
    expect(await store.handle({ ...envelope(), type: 'read' }, sender)).toMatchObject({ ok: true, sessions: expect.arrayContaining([{ ...session }]) });
    expect(await store.handle({ ...envelope(), type: 'queryAction', targetActionId: action.id }, sender)).toMatchObject({ ok: true, result: action.result });
    expect(await store.handle({ ...envelope(), type: 'saveDraft', sessionId: session.id, problemSnapshotId: session.problemSnapshotId, expectedRevision: session.revision, text: '旧题继续写' }, sender)).toMatchObject({ ok: true, session: { revision: session.revision + 1 } });
    expect(await store.db.events.where('sessionId').equals(session.id).last()).toMatchObject({ source: 'synthetic-workspace' });
    for (const row of oldActions) expect(await store.db.actions.get(row.id)).toEqual(row);
    expect(await store.handle(JSON.parse(action.fingerprint), sender)).toMatchObject({ code: 'PROTOCOL_MISMATCH' });
    expect(store.db.verno).toBe(2); expect(store.db.tables.map((table) => table.name).sort()).toEqual(['actions', 'backupImports', 'diagnostics', 'events', 'problems', 'sessions']);
  });
});
