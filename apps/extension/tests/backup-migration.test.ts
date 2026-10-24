import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/core/store';
import fixture from './fixtures/backup-v1.json';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const v1Stores = { sessions: 'id,updatedAt', problems: 'id', events: 'id,sessionId,kind', actions: 'id', diagnostics: 'id,at' };
const learningTables = ['problems', 'sessions', 'events', 'actions'] as const;
const oldTables = [...learningTables, 'diagnostics'];
const databases: Dexie[] = [];
const ownedNames = new Set<string>();
const logger = console;
const diagnostic = { id: '00000000-0000-4000-8000-000000000901', actionId: null, code: 'STORAGE_FAILED', at: 1_700_000_000_123 };
const receipt = {
  backupId: '00000000-0000-4000-8000-000000000902', digest: 'a'.repeat(64), sourceExtensionId: extensionId,
  exportedAt: 1_700_000_000_100, importedAt: 1_700_000_000_200,
  added: { problems: 2, sessions: 2, events: 13, actions: 13 }, skipped: { problems: 0, sessions: 0, events: 0, actions: 0 },
};

function newName() {
  const name = `backup-migration-${crypto.randomUUID()}`;
  ownedNames.add(name);
  return name;
}
function legacyDatabase(name: string) {
  const db = new Dexie(name);
  db.version(1).stores(v1Stores);
  databases.push(db);
  return db;
}
function currentStore(name: string) {
  const store = new Store(name, extensionId);
  databases.push(store.db);
  return store;
}
async function seedLegacy(db: Dexie) {
  /*
   * ========================================================================
   * 步骤1：建立真实旧版布局的合成数据库
   * ========================================================================
   * 数据源：Store 命令生成的固定合成 fixture 和一条脱敏诊断。
   * 操作：1) 写入旧版五表。2) 不创建新表或修改原字段。
   */
  logger.info('开始建立迁移合成数据');
  try {
    // 1.1 fixture 保留原动作 ID、中文和 Python 文本。
    await db.transaction('rw', oldTables, async () => {
      for (const name of learningTables) await db.table(name).bulkAdd(structuredClone(fixture.data[name]));
      // 1.2 diagnostics 不属于备份，但升级必须保留。
      await db.table('diagnostics').add(diagnostic);
    });
  } finally { logger.info('建立迁移合成数据结束'); }
}
async function readOldTables(db: Dexie) {
  return db.transaction('r', oldTables, async () => Object.fromEntries(
    await Promise.all(oldTables.map(async (name) => [name, await db.table(name).toArray()])),
  ));
}

afterEach(async () => {
  vi.restoreAllMocks();
  // 只关闭和删除此文件用随机名称建立的合成库。
  databases.splice(0).forEach((db) => db.close());
  await Promise.all([...ownedNames].map((name) => Dexie.delete(name)));
  ownedNames.clear();
});

describe('BK-09: 原型数据库加表迁移（fake-indexeddb 模拟）', () => {
  it('旧 v1 五表升级后内容与索引不变，并能写入独立导入回执表', async () => {
    const name = newName();
    const legacy = legacyDatabase(name);
    await seedLegacy(legacy);
    const before = await readOldTables(legacy);
    legacy.close();

    const store = currentStore(name);
    await store.db.open();
    expect(store.db.tables.map((table) => table.name)).toContain('backupImports');
    await store.db.backupImports.add(receipt);
    expect(await store.db.backupImports.get(receipt.backupId)).toEqual(receipt);
    expect(await readOldTables(store.db)).toEqual(before);
    expect(store.db.verno).toBe(2);
    const backend = store.db.backendDB();
    expect(backend.version).toBe(20);
    const transaction = backend.transaction(oldTables, 'readonly');
    expect(Object.fromEntries(oldTables.map((table) => [table, {
      keyPath: transaction.objectStore(table).keyPath,
      indexes: Array.from(transaction.objectStore(table).indexNames),
    }]))).toEqual({
      problems: { keyPath: 'id', indexes: [] }, sessions: { keyPath: 'id', indexes: ['updatedAt'] },
      events: { keyPath: 'id', indexes: ['kind', 'sessionId'] }, actions: { keyPath: 'id', indexes: [] },
      diagnostics: { keyPath: 'id', indexes: ['at'] },
    });
  });

  it('新建数据库的成功导入回执在 Store 完全重建后仍可查询', async () => {
    const name = newName();
    const first = currentStore(name);
    await first.db.open();
    expect(first.db.tables.map((table) => table.name)).toContain('backupImports');
    await first.db.backupImports.add(receipt);
    first.db.close();

    const reopened = currentStore(name);
    await reopened.db.open();
    expect(await reopened.db.backupImports.get(receipt.backupId)).toEqual(receipt);
    expect(await readOldTables(reopened.db)).toEqual({ problems: [], sessions: [], events: [], actions: [], diagnostics: [] });
  });

  it('真实升级事务 abort 后保留 v1 五表，随后仍可正常升级', async () => {
    const name = newName();
    const legacy = legacyDatabase(name);
    await seedLegacy(legacy);
    const before = await readOldTables(legacy);
    legacy.close();

    const interrupted = legacyDatabase(name);
    interrupted.version(2).stores({ backupImports: 'backupId' }).upgrade((transaction) => {
      // 在真正的 versionchange 事务中中断，不伪造打开失败。
      transaction.abort();
    });
    await expect(interrupted.open()).rejects.toMatchObject({ name: 'AbortError' });
    interrupted.close();

    const preserved = legacyDatabase(name);
    await preserved.open();
    expect(preserved.backendDB().version).toBe(10);
    expect(Array.from(preserved.backendDB().objectStoreNames).sort()).toEqual([...oldTables].sort());
    expect(await readOldTables(preserved)).toEqual(before);
    preserved.close();

    const retry = currentStore(name);
    await retry.db.open();
    expect(retry.db.tables.map((table) => table.name)).toContain('backupImports');
    expect(await readOldTables(retry.db)).toEqual(before);
  });

  it('原生低版本请求产生 VersionError 而不清库；锁定旧 Dexie 仍可打开仅加表的 v2', async () => {
    const name = newName();
    const upgraded = legacyDatabase(name);
    upgraded.version(2).stores({ backupImports: 'backupId' });
    await seedLegacy(upgraded);
    await upgraded.table('backupImports').add(receipt);
    const before = await readOldTables(upgraded);
    upgraded.close();

    // Dexie 的两个逻辑版本对应原生 IndexedDB 的 10 和 20。
    await expect(new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 10);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    })).rejects.toMatchObject({ name: 'VersionError' });

    // 当前依赖收到 VersionError 会不带版本重开，不能假称旧代码必定拒绝。
    const oldCode = legacyDatabase(name);
    await oldCode.open();
    expect(oldCode.verno).toBe(1);
    expect(oldCode.backendDB().version).toBe(20);
    expect(await readOldTables(oldCode)).toEqual(before);
    const transaction = oldCode.backendDB().transaction('backupImports', 'readonly');
    const stored = await new Promise<unknown>((resolve, reject) => {
      const request = transaction.objectStore('backupImports').get(receipt.backupId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(stored).toEqual(receipt);
  });
});

describe('BK-11: 学习与备份复用浏览器来源检查', () => {
  const workspace = { id: extensionId, url: `chrome-extension://${extensionId}/workspace.html`, frameId: 0, origin: `chrome-extension://${extensionId}` };
  const panel = { id: extensionId, url: `chrome-extension://${extensionId}/sidepanel.html`, origin: `chrome-extension://${extensionId}` };
  it.each([
    { label: '顶层工作台', sender: workspace, learning: true, backup: true },
    { label: '原生侧栏缺省 frameId', sender: panel, learning: true, backup: false },
    { label: '普通侧栏页面', sender: { ...panel, frameId: 0 }, learning: true, backup: false },
    { label: '原工作台缺省 frameId 约定', sender: { ...workspace, frameId: undefined }, learning: true, backup: true },
    { label: '原工作台缺省 origin 约定', sender: { ...workspace, origin: undefined }, learning: true, backup: true },
    { label: '工作台 query 与 hash', sender: { ...workspace, url: `${workspace.url}?view=backup#history` }, learning: true, backup: true },
    { label: '工作台子框架', sender: { ...workspace, frameId: 1 }, learning: false, backup: false },
    { label: '其他扩展 sender ID', sender: { ...workspace, id: 'ponmlkjihgfedcbaponmlkjihgfedcba' }, learning: false, backup: false },
    { label: '其他扩展 URL', sender: { ...workspace, url: 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/workspace.html' }, learning: false, backup: false },
    { label: '普通网页', sender: { ...workspace, url: 'https://example.com/workspace.html' }, learning: false, backup: false },
    { label: '非白名单扩展页', sender: { ...workspace, url: `chrome-extension://${extensionId}/other.html` }, learning: false, backup: false },
    { label: '不一致 origin', sender: { ...workspace, origin: 'https://example.com' }, learning: false, backup: false },
    { label: '非法 URL', sender: { ...workspace, url: 'invalid' }, learning: false, backup: false },
    { label: '缺失浏览器 sender', sender: {}, learning: false, backup: false },
  ])('$label', async ({ sender, learning, backup }) => {
    const { isAllowedSource } = await import('../src/core/source');
    expect(isAllowedSource(sender, extensionId)).toBe(learning);
    expect(isAllowedSource(sender, extensionId, true)).toBe(backup);
  });
});
