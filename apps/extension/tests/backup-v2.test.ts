import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/core/store';
import { digestBackup, exportBackup, importBackup, queryBackup, validateBackup } from '../src/core/backup';
import { backupSchema, type Backup } from '../src/shared/backup';
import legacyJson from './fixtures/backup-v1.json';
import mixedJson from './fixtures/backup-v2.json';
import { createMixedBackupFixture } from './helpers/backup-v2-fixture';
import { FIXTURE_TIME, SOURCE_EXTENSION_ID, TARGET_EXTENSION_ID, fixtureId } from './helpers/backup-fixture';

const stores: Store[] = [];
const makeStore = (extensionId = SOURCE_EXTENSION_ID) => { const store = new Store(`backup-v2-${crypto.randomUUID()}`, extensionId); stores.push(store); return store; };
const sender = (extensionId = TARGET_EXTENSION_ID) => ({ id: extensionId, url: `chrome-extension://${extensionId}/workspace.html`, frameId: 0 });
const envelope = (extensionId = TARGET_EXTENSION_ID) => ({ protocolVersion: 2, extensionId, actionId: crypto.randomUUID() });
const snapshot = async (store: Store) => ({ problems: await store.db.problems.toArray(), sessions: await store.db.sessions.toArray(), events: await store.db.events.toArray(), actions: await store.db.actions.toArray(), receipts: await store.db.backupImports.toArray() });
const mixed = async () => {
  let time = FIXTURE_TIME + 1_000; vi.spyOn(Date, 'now').mockImplementation(() => time++);
  return await createMixedBackupFixture(makeStore()) as Backup;
};
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map((store) => store.db.delete())); });

/*
 * ========================================================================
 * 步骤1：验证完整混合来源文件及版本分派
 * ========================================================================
 * 数据源：真实 Store 生成的 v2 记录和冻结 v1 文件。
 * 操作：1) 默认导出保留全部来源。2) 旧格式继续按旧协议验证。
 */
describe('MP-07/08 完整备份版本与事实链', () => {
  it('冻结旧文件仍可验证并保持原摘要', async () => {
    const backup = validateBackup(structuredClone(legacyJson));
    expect(backup.formatVersion).toBe(1);
    expect(await digestBackup(backup)).toBe('b1827a2f8d7010ea02b28517a22d727132ccc6b90f0b21bbe9572498ad022b7f');
  });
  it('默认导出v2保留legacy、manual与v2 synthetic四表', async () => {
    const store = makeStore(); let time = FIXTURE_TIME + 1_000; vi.spyOn(Date, 'now').mockImplementation(() => time++);
    const expected = await createMixedBackupFixture(store);
    const actual = await exportBackup(store, { appVersion: '0.1.0', extensionId: SOURCE_EXTENSION_ID });
    expect(actual).toMatchObject({ formatVersion: 2, scope: 'practice-records-v2', data: expected.data });
    expect(actual.data.sessions).toHaveLength(5); expect(actual.data.actions).toHaveLength(21);
    expect(actual.data.problems.filter((row) => row.source === 'manual-user-v1')).toHaveLength(2);
    expect(new Set(actual.data.actions.map((row) => JSON.parse(row.fingerprint).protocolVersion))).toEqual(new Set([1, 2]));
  });
  it('严格共享schema接受混合v2文件，legacy合成历史可接v2动作', async () => {
    const backup = await mixed(); expect(backup).toEqual(mixedJson);
    expect(backupSchema.safeParse(backup).success).toBe(true); expect(validateBackup(backup)).toEqual(backup);
  });
  it.each([[1, 'practice-records-v2'], [2, 'prototype-storage-v1'], [3, 'practice-records-v2'], [2, 'foreign']])('拒绝版本与scope错配 %s/%s', async (formatVersion, scope) => {
    expect(() => validateBackup({ ...legacyJson, formatVersion, scope })).toThrow(expect.objectContaining({ code: 'BACKUP_UNSUPPORTED_VERSION' }));
  });
  const invalid: [string, (backup: Backup) => void][] = [
    ['manual冒充synthetic', (b) => Object.assign(b.data.problems[2], { source: 'synthetic-v1' })],
    ['manual带非空题干', (b) => Object.assign(b.data.problems[2], { statement: '未授权题干' })],
    ['manual快照未知字段', (b) => Object.assign(b.data.problems[2], { metadata: '未知字段' })],
    ['synthetic带url', (b) => Object.assign(b.data.problems[0], { url: null })],
    ['manual标题与指纹不同', (b) => { b.data.problems[2].title = '被替换的标题'; }],
    ['manual链接与指纹不同', (b) => Object.assign(b.data.problems[2], { url: null })],
    ['manual标题未规范', (b) => { b.data.problems[2].title = '  空白标题  '; }],
    ['manual链接未规范', (b) => Object.assign(b.data.problems[2], { url: 'https://leetcode.cn/problems/two-sum/description/' })],
    ['manual首事件来源不符', (b) => { b.data.events[13].source = 'synthetic-workspace'; }],
    ['manual后续事件来源不符', (b) => { b.data.events[14].source = 'synthetic-workspace'; }],
    ['synthetic首事件来源不符', (b) => { b.data.events[0].source = 'manual-workspace'; }],
    ['legacy动作作用manual', (b) => { const a = b.data.actions[14]; a.fingerprint = JSON.stringify({ ...JSON.parse(a.fingerprint), protocolVersion: 1 }); }],
    ['manual start使用legacy版本', (b) => { const a = b.data.actions[13]; a.fingerprint = JSON.stringify({ ...JSON.parse(a.fingerprint), protocolVersion: 1 }); }],
    ['v2未知未来动作版本', (b) => { const a = b.data.actions[14]; a.fingerprint = JSON.stringify({ ...JSON.parse(a.fingerprint), protocolVersion: 3 }); }],
    ['manual回执problemKey伪装', (b) => { b.data.actions[13].result.session.problemKey = 'unique'; }],
  ];
  it.each(invalid)('v2独立拒绝矛盾：%s', async (_label, mutate) => {
    const backup = await mixed(); mutate(backup);
    expect(() => validateBackup(backup)).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
    const target = makeStore(TARGET_EXTENSION_ID); const before = await snapshot(target);
    await expect(importBackup(target, backup, await digestBackup(backup), TARGET_EXTENSION_ID)).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
    expect(await snapshot(target)).toEqual(before);
  });
  it.each([14, 15, 16, 17])('legacy非创建动作不得作用manual %#', async (index) => {
    const backup = await mixed(); const action = backup.data.actions[index];
    action.fingerprint = JSON.stringify({ ...JSON.parse(action.fingerprint), protocolVersion: 1 });
    expect(() => validateBackup(backup)).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  });
  it('v1绝不接受v2 synthetic指纹或manual记录', async () => {
    const legacy = structuredClone(legacyJson); const action = legacy.data.actions[0];
    action.fingerprint = JSON.stringify({ ...JSON.parse(action.fingerprint), protocolVersion: 2 });
    expect(() => validateBackup(legacy)).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
    const backup = await mixed(); expect(() => validateBackup({ ...backup, formatVersion: 1, scope: 'prototype-storage-v1' })).toThrow(expect.objectContaining({ code: 'BACKUP_INVALID' }));
  });
});

/*
 * ========================================================================
 * 步骤2：验证跨实例非覆盖恢复和原子回执
 * ========================================================================
 * 数据源：混合 v2 文件、独立数据库与真实在线 v2 命令。
 * 操作：1) 只转换扩展路由。2) 保留回滚、关系冲突和续练不回退。
 */
describe('MP-07/08/09 混合文件原子恢复', () => {
  it('跨扩展恢复保留v1/v2版本与manual内容，查询旧回执和重发新动作均成立', async () => {
    const backup = await mixed(); const store = makeStore(TARGET_EXTENSION_ID); const digest = await digestBackup(backup);
    const receipt = await importBackup(store, backup, digest, TARGET_EXTENSION_ID);
    expect(receipt.added).toEqual({ problems: 5, sessions: 5, events: 21, actions: 21 });
    for (const action of backup.data.actions) {
      const current = (await store.db.actions.get(action.id))!; const command = JSON.parse(current.fingerprint);
      expect(command).toEqual({ ...JSON.parse(action.fingerprint), extensionId: TARGET_EXTENSION_ID });
      expect(await store.handle({ ...envelope(), type: 'queryAction', targetActionId: action.id }, sender())).toMatchObject({ ok: true, result: action.result });
      expect(await store.handle(command, sender())).toMatchObject(command.protocolVersion === 1 ? { ok: false, code: 'PROTOCOL_MISMATCH' } : action.result);
    }
    expect((await exportBackup(store, { appVersion: '0.1.0', extensionId: TARGET_EXTENSION_ID })).data.problems).toEqual(backup.data.problems);
  });
  it('恢复后保存manual草稿，再导入同文件优先回执且不回退', async () => {
    const backup = await mixed(); const store = makeStore(TARGET_EXTENSION_ID); const digest = await digestBackup(backup);
    const receipt = await importBackup(store, backup, digest, TARGET_EXTENSION_ID); const session = backup.data.sessions[2];
    expect(await store.handle({ ...envelope(), type: 'saveDraft', sessionId: session.id, problemSnapshotId: session.problemSnapshotId, expectedRevision: session.revision, text: '# 恢复后继续练习' }, sender())).toMatchObject({ ok: true, session: { revision: 5 } });
    const before = await snapshot(store); expect(await importBackup(store, backup, digest, TARGET_EXTENSION_ID)).toEqual(receipt); expect(await snapshot(store)).toEqual(before);
    expect(validateBackup(await exportBackup(store, { appVersion: '0.1.0', extensionId: TARGET_EXTENSION_ID })).data.events).toHaveLength(22);
  });
  it.each([['AbortError', 'STORAGE_FAILED'], ['QuotaExceededError', 'STORAGE_FULL'], ['SecurityError', 'STORAGE_DENIED']])('v2最后回执%s失败时五表全部回滚', async (name, code) => {
    const backup = await mixed(); const store = makeStore(TARGET_EXTENSION_ID); const digest = await digestBackup(backup);
    vi.spyOn(store.db.backupImports, 'add').mockRejectedValueOnce(new DOMException('PRIVATE_SENTINEL', name));
    await expect(importBackup(store, backup, digest, TARGET_EXTENSION_ID)).rejects.toMatchObject({ code });
    expect(await snapshot(store)).toEqual({ problems: [], sessions: [], events: [], actions: [], receipts: [] });
    expect(await queryBackup(store, backup.backupId, digest)).toBeNull();
    expect((await importBackup(store, backup, digest, TARGET_EXTENSION_ID)).added.actions).toBe(21);
  });
  it('不同文件版本复用backupId仍按原格式摘要碰撞', async () => {
    const store = makeStore(TARGET_EXTENSION_ID); const legacy = validateBackup(structuredClone(legacyJson));
    await importBackup(store, legacy, await digestBackup(legacy), TARGET_EXTENSION_ID); const before = await snapshot(store);
    const backup = await mixed(); backup.backupId = legacy.backupId;
    await expect(importBackup(store, backup, await digestBackup(backup), TARGET_EXTENSION_ID)).rejects.toMatchObject({ code: 'BACKUP_ID_COLLISION' }); expect(await snapshot(store)).toEqual(before);
  });
  it.each(['snapshot', 'event', 'action'])('跨文件manual %s归属冲突拒绝且五表不变', async (kind) => {
    const backup = await mixed(); const store = makeStore(TARGET_EXTENSION_ID); await importBackup(store, backup, await digestBackup(backup), TARGET_EXTENSION_ID);
    backup.backupId = fixtureId(90_000); const session = backup.data.sessions[2];
    if (kind === 'snapshot') {
      const clone = structuredClone(session); clone.id = fixtureId(90_001); await store.db.sessions.add(clone);
    } else if (kind === 'event') {
      const event = structuredClone(backup.data.events[13]); event.id = fixtureId(90_002); event.actionId = event.id; await store.db.events.add(event);
    } else {
      const action = structuredClone((await store.db.actions.get(backup.data.actions[13].id))!); action.id = fixtureId(90_003); action.result.actionId = action.id;
      action.fingerprint = JSON.stringify({ ...JSON.parse(action.fingerprint), actionId: action.id }); await store.db.actions.add(action);
    }
    const before = await snapshot(store);
    await expect(importBackup(store, backup, await digestBackup(backup), TARGET_EXTENSION_ID)).rejects.toMatchObject({ code: 'BACKUP_CONFLICT' }); expect(await snapshot(store)).toEqual(before);
  });
});
