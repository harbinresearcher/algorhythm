import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store, type Sender } from '../src/core/store';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const sender: Sender = { id: extensionId, url: `chrome-extension://${extensionId}/workspace.html`, frameId: 0 };
const stores: Store[] = [];
const makeStore = () => {
  const store = new Store(`test-${crypto.randomUUID()}`, extensionId);
  stores.push(store);
  return store;
};
const envelope = () => ({ protocolVersion: 1, extensionId, actionId: crypto.randomUUID() });
const start = () => ({ ...envelope(), type: 'start', sessionId: crypto.randomUUID(), problemSnapshotId: crypto.randomUUID(), problemKey: 'unique' });
const save = (session: ReturnType<typeof start>, revision = 0, text = '先遍历') => ({
  ...envelope(), type: 'saveDraft', sessionId: session.sessionId,
  problemSnapshotId: session.problemSnapshotId, expectedRevision: revision, text,
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(stores.splice(0).map((store) => store.db.delete()));
});

describe('持久化命令协议', () => {
  it('SC-01: 原生侧栏没有 tab/frameId 时仍接受可信扩展页', async () => {
    const store = makeStore();
    const panelSender = { id: extensionId, url: `chrome-extension://${extensionId}/sidepanel.html`, origin: `chrome-extension://${extensionId}` };
    expect(await store.handle(start(), panelSender)).toMatchObject({ ok: true });
    expect(await store.handle(start(), { ...panelSender, origin: 'https://example.com' })).toMatchObject({ code: 'FORBIDDEN' });
  });
  it('SC-02/03: 重开数据库后仍先去重再检查旧 revision', async () => {
    const store = makeStore();
    const session = start();
    expect((await store.handle(session, sender)).ok).toBe(true);
    const command = save(session);
    const committed = await store.handle(command, sender);
    store.db.close();
    await store.db.open();
    expect(await store.handle(command, sender)).toEqual(committed);
    expect(await store.db.events.count()).toBe(2);
    const query = await store.handle({ ...envelope(), type: 'queryAction', targetActionId: command.actionId }, sender);
    expect(query).toMatchObject({ ok: true, kind: 'action', result: committed });
    expect(await store.handle({ ...command, text: '碰撞内容' }, sender)).toMatchObject({ ok: false, code: 'ACTION_COLLISION' });
  });

  it('SC-05: 两写入同版本只接受一个', async () => {
    const store = makeStore(); const session = start();
    await store.handle(session, sender);
    const results = await Promise.all([store.handle(save(session, 0, 'A'), sender), store.handle(save(session, 0, 'B'), sender)]);
    expect(results.filter((item) => item.ok)).toHaveLength(1);
    expect(results.find((item) => !item.ok)).toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await store.db.events.count()).toBe(2);
  });

  it('SC-04: 事务中断时快照、事实与回执一同回滚，同 ID 可重试', async () => {
    const store = makeStore(); const session = start();
    await store.handle(session, sender);
    const command = save(session);
    vi.spyOn(store.db.actions, 'add').mockRejectedValueOnce(new DOMException('abort', 'AbortError'));
    expect(await store.handle(command, sender)).toMatchObject({ ok: false, code: 'STORAGE_FAILED' });
    expect((await store.db.sessions.get(session.sessionId))?.revision).toBe(0);
    expect(await store.db.events.count()).toBe(1);
    expect(await store.db.actions.get(command.actionId)).toBeUndefined();
    expect(await store.handle(command, sender)).toMatchObject({ ok: true, session: { revision: 1 } });
  });

  it('SC-06: 题目引用不符被拒绝，旧题动作只写旧题', async () => {
    const store = makeStore(); const a = start(); const b = start();
    await store.handle(a, sender); await store.handle(b, sender);
    expect(await store.handle({ ...save(a), problemSnapshotId: b.problemSnapshotId }, sender)).toMatchObject({ ok: false, code: 'REFERENCE_MISMATCH' });
    await store.handle(save(a, 0, 'A的思路'), sender);
    expect((await store.db.sessions.get(b.sessionId))?.draft).toBe('');
  });

  it('暂停后不接受草稿，恢复后可记录真实尝试快照', async () => {
    const store = makeStore(); const session = start();
    await store.handle(session, sender);
    const { text: _text, ...reference } = save(session);
    expect(await store.handle({ ...reference, type: 'pause' }, sender)).toMatchObject({ ok: true, session: { status: 'paused' } });
    expect(await store.handle(save(session, 1), sender)).toMatchObject({ ok: false, code: 'INVALID_STATE' });
    await store.handle({ ...reference, ...envelope(), expectedRevision: 1, type: 'resume' }, sender);
    await store.handle(save(session, 2, '我的代码'), sender);
    const attempt = await store.handle({ ...reference, ...envelope(), expectedRevision: 3, type: 'recordAttempt' }, sender);
    expect(attempt).toMatchObject({ ok: true, session: { revision: 4 } });
    expect(await store.db.events.where('kind').equals('attempt').first()).toMatchObject({ text: '我的代码', sessionId: session.sessionId, problemSnapshotId: session.problemSnapshotId, source: 'synthetic-workspace' });
  });

  it('SC-08: 配额不足分类明确，诊断写失败不会递归重试', async () => {
    const store = makeStore();
    vi.spyOn(store.db.actions, 'add').mockRejectedValueOnce(new DOMException('sensitive text', 'QuotaExceededError'));
    const diagnostic = vi.spyOn(store.db.diagnostics, 'add').mockRejectedValue(new Error('disk'));
    expect(await store.handle(start(), sender)).toMatchObject({ ok: false, code: 'STORAGE_FULL' });
    expect(diagnostic).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('sensitive text');
  });

  it.each([
    { ...sender, id: 'foreign-extension' },
    { ...sender, url: 'https://leetcode.cn/problems/x/' },
    { ...sender, frameId: 1 },
    { ...sender, url: `chrome-extension://${extensionId}/untrusted.html` },
  ])('SC-09: 拒绝伪造角色或内容脚本来源 %j', async (untrusted) => {
    const store = makeStore();
    expect(await store.handle(start(), untrusted)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await store.db.sessions.count()).toBe(0);
  });

  it('SC-10: 版本/扩展数据空间不兼容被明确拒绝', async () => {
    const store = makeStore();
    expect(await store.handle({ ...start(), protocolVersion: 2 }, sender)).toMatchObject({ code: 'PROTOCOL_MISMATCH' });
    expect(await store.handle({ ...start(), extensionId: 'other-instance' }, sender)).toMatchObject({ code: 'INSTANCE_MISMATCH' });
    expect(await store.handle({ ...start(), role: 'admin' }, sender)).toMatchObject({ code: 'INVALID_COMMAND' });
    expect(await store.handle({ ...start(), problemKey: 'arbitrary-url' }, sender)).toMatchObject({ code: 'INVALID_COMMAND' });
    expect(await store.db.sessions.count()).toBe(0);
  });
});
