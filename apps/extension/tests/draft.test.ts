import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftController } from '../src/client/draft';
import { createClient, ClientError } from '../src/client/transport';
import type { Committed, Session, WriteCommand } from '../src/shared/protocol';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const session: Session = { id: crypto.randomUUID(), problemSnapshotId: crypto.randomUUID(), problemKey: 'unique', status: 'active', revision: 0, draft: '', createdAt: 1, updatedAt: 1 };
const envelope = () => ({ protocolVersion: 1 as const, extensionId, actionId: crypto.randomUUID() });
const commit = (command: WriteCommand): Committed => ({ ok: true, kind: 'committed', actionId: command.actionId, session: { ...session, revision: 'expectedRevision' in command ? command.expectedRevision + 1 : 0, draft: command.type === 'saveDraft' ? command.text : '' } });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('草稿确认', () => {
  it('SC-11: A 的迟到确认不能把 B 标为已保存，且串行使用新 revision', async () => {
    const resolvers: ((result: Committed) => void)[] = [];
    const write = vi.fn((_: WriteCommand) => new Promise<Committed>((resolve) => resolvers.push(resolve)));
    const draft = new DraftController(session, envelope, write);
    draft.edit('A');
    const saving = draft.flush();
    draft.edit('B');
    expect(write).toHaveBeenCalledTimes(1);
    resolvers[0](commit(write.mock.calls[0][0]));
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(draft.getSnapshot()).toMatchObject({ text: 'B', status: 'saving' });
    expect(write.mock.calls[1][0]).toMatchObject({ text: 'B', expectedRevision: 1 });
    resolvers[1](commit(write.mock.calls[1][0]));
    await saving;
    expect(draft.getSnapshot()).toMatchObject({ text: 'B', status: 'saved', session: { revision: 2 } });
    draft.dispose();
  });

  it('500ms debounce 且显式 flush 不等待计时', async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (command: WriteCommand) => commit(command));
    const draft = new DraftController(session, envelope, write);
    draft.edit('A'); await vi.advanceTimersByTimeAsync(499);
    expect(write).not.toHaveBeenCalled();
    draft.edit('B'); await draft.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toMatchObject({ text: 'B' });
    draft.dispose();
  });

  it('SC-05/08: 失败保留文字，不自动重试，手动重试复用动作 ID', async () => {
    const write = vi.fn(async (command: WriteCommand) => commit(command));
    write.mockRejectedValueOnce(new ClientError('OUTCOME_UNKNOWN'));
    const draft = new DraftController(session, envelope, write);
    draft.edit('不丢这段');
    await expect(draft.flush()).rejects.toThrow();
    expect(draft.getSnapshot()).toMatchObject({ text: '不丢这段', status: 'error', error: 'OUTCOME_UNKNOWN' });
    draft.edit('继续编辑');
    expect(write).toHaveBeenCalledTimes(1);
    await draft.retry();
    expect(write.mock.calls[1][0].actionId).toBe(write.mock.calls[0][0].actionId);
    expect(write.mock.calls[2][0]).toMatchObject({ text: '继续编辑', expectedRevision: 1 });
    draft.dispose();
  });

  it('SC-06: 编辑器销毁后迟到确认不通知新视图', async () => {
    let resolve!: (result: Committed) => void;
    const write = vi.fn((_: WriteCommand) => new Promise<Committed>((done) => { resolve = done; }));
    const draft = new DraftController(session, envelope, write);
    const listener = vi.fn(); draft.subscribe(listener);
    draft.edit('A'); const saving = draft.flush(); draft.dispose(); listener.mockClear();
    resolve(commit(write.mock.calls[0][0])); await saving;
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('传输恢复', () => {
  it('SC-03: 丢失写回执后先查询动作，返回原提交', async () => {
    const command: WriteCommand = { ...envelope(), type: 'saveDraft', sessionId: session.id, problemSnapshotId: session.problemSnapshotId, expectedRevision: 0, text: 'A' };
    const send = vi.fn().mockRejectedValueOnce(new Error('disconnect')).mockImplementationOnce(async (query) => ({ ok: true, kind: 'action', actionId: query.actionId, result: commit(command) }));
    expect(await createClient(extensionId, send).write(command)).toEqual(commit(command));
    expect(send.mock.calls[1][0]).toMatchObject({ type: 'queryAction', targetActionId: command.actionId });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('无法确认时不猜成功，不自动重发写请求', async () => {
    const command: WriteCommand = { ...envelope(), type: 'start', sessionId: session.id, problemSnapshotId: session.problemSnapshotId, problemKey: 'unique' };
    const send = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(createClient(extensionId, send).write(command)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('回执 actionId 不匹配不得接受', async () => {
    const send = vi.fn(async () => ({ ok: true, kind: 'action', actionId: crypto.randomUUID(), result: null }));
    await expect(createClient(extensionId, send).read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
