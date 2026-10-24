import { Store, type Sender } from '../../src/core/store';

export const SOURCE_EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
export const TARGET_EXTENSION_ID = 'ponmlkjihgfedcba'.repeat(2);
export const FIXTURE_TIME = 1_700_000_000_000;
export const fixtureId = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const logger = console;

export async function createBackupFixture(store: Store) {
  /*
   * ========================================================================
   * 步骤1：用真实命令生成合成历史
   * ========================================================================
   * 数据源：两道现有合成题目与确定的 UUID。
   * 操作：1) 保存中文和 Python 草稿及多次尝试。2) 保留 active 与 paused 会话。
   */
  logger.info('开始生成合成备份历史');
  try {
    // 1.1 每个动作均由 Store 校验和事务提交，不直接制造回执。
    const sender: Sender = { id: SOURCE_EXTENSION_ID, url: `chrome-extension://${SOURCE_EXTENSION_ID}/workspace.html`, frameId: 0 };
    let action = 100;
    const send = async (fields: Record<string, unknown>) => {
      const result = await store.handle({ protocolVersion: 1, extensionId: SOURCE_EXTENSION_ID, actionId: fixtureId(action++), ...fields }, sender);
      if (!result.ok) throw new Error(`Synthetic fixture failed: ${result.code}`);
    };
    const active = { sessionId: fixtureId(1), problemSnapshotId: fixtureId(11) };
    const paused = { sessionId: fixtureId(2), problemSnapshotId: fixtureId(12) };
    // 1.2 active 会话最后保留尚未形成尝试的已确认草稿。
    await send({ type: 'start', ...active, problemKey: 'unique' });
    await send({ type: 'saveDraft', ...active, expectedRevision: 0, text: '先用集合保存见过的编号。\nseen = set()' });
    await send({ type: 'recordAttempt', ...active, expectedRevision: 1 });
    await send({ type: 'saveDraft', ...active, expectedRevision: 2, text: 'def has_duplicate(nums):\n    return len(nums) != len(set(nums))\n# 第二次尝试' });
    await send({ type: 'recordAttempt', ...active, expectedRevision: 3 });
    await send({ type: 'saveDraft', ...active, expectedRevision: 4, text: '# 已保存，还没有记录为尝试\nfor number in nums:\n    print(number)' });
    // 1.3 paused 会话包含暂停、恢复和再次暂停的真实状态转换。
    await send({ type: 'start', ...paused, problemKey: 'pair' });
    await send({ type: 'saveDraft', ...paused, expectedRevision: 0, text: '# 相邻差值\nanswer = min(b - a for a, b in zip(nums, nums[1:]))' });
    await send({ type: 'recordAttempt', ...paused, expectedRevision: 1 });
    await send({ type: 'pause', ...paused, expectedRevision: 2 });
    await send({ type: 'resume', ...paused, expectedRevision: 3 });
    await send({ type: 'saveDraft', ...paused, expectedRevision: 4, text: '暂停前已保存的中文思路\n# 下一次从这里继续' });
    await send({ type: 'pause', ...paused, expectedRevision: 5 });
  } finally { logger.info('生成合成备份历史结束'); }

  /*
   * ========================================================================
   * 步骤2：读取同一事务内的合成快照
   * ========================================================================
   * 数据源：真实 Store 的四张学习表。
   * 操作：1) 保留原 UUID 和指纹。2) 加入固定的备份来源与 envelope。
   */
  logger.info('开始读取合成备份快照');
  try {
    // 2.1 该 helper 只供测试使用，不添加生产类的方法或环境开关。
    const data = await store.db.transaction('r', [store.db.problems, store.db.sessions, store.db.events, store.db.actions], async () => ({
      problems: await store.db.problems.toArray(), sessions: await store.db.sessions.toArray(),
      events: await store.db.events.toArray(), actions: await store.db.actions.toArray(),
    }));
    return { format: 'algorhythm-backup', formatVersion: 1, scope: 'prototype-storage-v1', backupId: fixtureId(900), exportedAt: FIXTURE_TIME + 100,
      source: { appVersion: '0.1.0', extensionId: SOURCE_EXTENSION_ID }, data };
  } finally { logger.info('读取合成备份快照结束'); }
}
