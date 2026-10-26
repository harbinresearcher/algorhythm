import { Store } from '../../src/core/store';
import type { Backup } from '../../src/shared/backup';
import legacyJson from '../fixtures/backup-v1.json';
import { FIXTURE_TIME, SOURCE_EXTENSION_ID, fixtureId } from './backup-fixture';

const logger = console;
const legacy = legacyJson as Extract<Backup, { formatVersion: 1 }>;
export async function createMixedBackupFixture(store: Store) {
  /*
   * ========================================================================
   * 步骤1：保留历史事实并用在线命令生成混合练习
   * ========================================================================
   * 数据源：冻结 v1 合成记录与原创的手动练习标题、代码。
   * 操作：1) 原文保留历史指纹。2) 新练习及历史续写均经过真实 Store 事务。
   */
  logger.info('开始生成混合备份历史');
  try {
    // 1.1 载入真实历史文件，不把旧动作改成在线协议。
    await store.db.problems.bulkAdd(structuredClone(legacy.data.problems));
    await store.db.sessions.bulkAdd(structuredClone(legacy.data.sessions));
    await store.db.events.bulkAdd(structuredClone(legacy.data.events));
    await store.db.actions.bulkAdd(structuredClone(legacy.data.actions));
    const sender = { id: SOURCE_EXTENSION_ID, url: `chrome-extension://${SOURCE_EXTENSION_ID}/workspace.html`, frameId: 0 };
    let action = 1_000;
    const send = async (fields: Record<string, unknown>) => {
      const result = await store.handle({ protocolVersion: 2, extensionId: SOURCE_EXTENSION_ID, actionId: fixtureId(action++), ...fields }, sender);
      if (!result.ok) throw new Error(`Mixed fixture failed: ${result.code}`);
    };
    // 1.2 手动会话含快照链接、草稿、尝试与暂停恢复。
    const manual = { sessionId: fixtureId(3), problemSnapshotId: fixtureId(13) };
    await send({ type: 'startManual', ...manual, title: '自建数组练习 <b>只作文本</b>', url: 'https://leetcode.cn/problems/two-sum/' });
    await send({ type: 'saveDraft', ...manual, expectedRevision: 0, text: '# 原创练习\nseen = set()' });
    await send({ type: 'recordAttempt', ...manual, expectedRevision: 1 });
    await send({ type: 'pause', ...manual, expectedRevision: 2 });
    await send({ type: 'resume', ...manual, expectedRevision: 3 });
    // 1.3 同时保留无链接练习、新合成会话和旧合成会话的在线续写。
    await send({ type: 'startManual', sessionId: fixtureId(4), problemSnapshotId: fixtureId(14), title: '无链接原创练习', url: null });
    await send({ type: 'start', sessionId: fixtureId(5), problemSnapshotId: fixtureId(15), problemKey: 'pair' });
    await send({ type: 'saveDraft', sessionId: legacy.data.sessions[0].id, problemSnapshotId: legacy.data.sessions[0].problemSnapshotId, expectedRevision: legacy.data.sessions[0].revision, text: '# 旧会话用新协议继续保存' });
    const data = await store.db.transaction('r', [store.db.problems, store.db.sessions, store.db.events, store.db.actions], async () => ({
      problems: await store.db.problems.toArray(), sessions: await store.db.sessions.toArray(),
      events: await store.db.events.toArray(), actions: await store.db.actions.toArray(),
    }));
    return { format: 'algorhythm-backup', formatVersion: 2, scope: 'practice-records-v2', backupId: fixtureId(901), exportedAt: FIXTURE_TIME + 2_000,
      source: { appVersion: '0.1.0', extensionId: SOURCE_EXTENSION_ID }, data };
  } finally { logger.info('生成混合备份历史结束'); }
}
