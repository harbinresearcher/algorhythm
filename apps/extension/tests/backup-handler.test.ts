import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleBackup } from '../src/core/backup-handler';
import { digestBackup, validateBackup } from '../src/core/backup';
import { Store } from '../src/core/store';
import type { Sender } from '../src/core/source';
import { backupResponseSchema } from '../src/shared/backup';
import rawFixture from './fixtures/backup-v1.json';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const fixture = validateBackup(rawFixture);
const sender: Sender = { id: extensionId, url: `chrome-extension://${extensionId}/workspace.html`, frameId: 0 };
const stores: Store[] = [];
const makeStore = () => { const store = new Store(`handler-${crypto.randomUUID()}`, extensionId); stores.push(store); return store; };
const envelope = () => ({ protocolVersion: 2, extensionId, actionId: crypto.randomUUID() });
const invoke = (store: Store, input: unknown, source = sender) => handleBackup(store, input, source, extensionId, '0.1.0');
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(stores.splice(0).map(store => store.db.delete())); });

describe('BK-06/11: 独立备份消息入口', () => {
  it.each([
    { ...sender, url: `chrome-extension://${extensionId}/sidepanel.html` },
    { ...sender, url: 'https://example.com/workspace.html' },
    { ...sender, id: 'pppppppppppppppppppppppppppppppp' },
    { ...sender, frameId: 1 },
    { ...sender, origin: 'https://example.com' },
  ])('只接受工作台的浏览器来源 %j', async source => {
    const store = makeStore();
    for (const type of ['backup.export', 'backup.import', 'backup.query']) {
      const input = { ...envelope(), type, role: 'workspace' };
      expect(await invoke(store, input, source)).toEqual({ ok: false, actionId: input.actionId, code: 'FORBIDDEN' });
    }
    expect(await store.db.backupImports.count()).toBe(0);
    expect(await store.db.sessions.count()).toBe(0);
  });

  it('版本、实例、未知字段和伪造角色分别拒绝', async () => {
    const store = makeStore(); const base = { ...envelope(), type: 'backup.export' };
    expect(await invoke(store, { ...base, protocolVersion: 1 })).toMatchObject({ code: 'PROTOCOL_MISMATCH' });
    expect(await invoke(store, { ...base, extensionId: 'other' })).toMatchObject({ code: 'INSTANCE_MISMATCH' });
    expect(await invoke(store, { ...base, role: 'workspace' })).toMatchObject({ code: 'INVALID_COMMAND' });
    expect(await invoke(store, { ...base, type: 'backup.unknown' })).toMatchObject({ code: 'INVALID_COMMAND' });
    expect(await invoke(store, { ...base, actionId: 'bad' })).toEqual({ ok: false, actionId: null, code: 'INVALID_COMMAND' });
  });

  it('导出、导入和重启后查询均返回严格消息与原actionId', async () => {
    const store = makeStore(); const exportCommand = { ...envelope(), type: 'backup.export' };
    const exported = await invoke(store, exportCommand);
    expect(backupResponseSchema.safeParse(exported).success).toBe(true);
    expect(exported).toMatchObject({ ok: true, kind: 'backup.exported', actionId: exportCommand.actionId,
      backup: { formatVersion: 2, scope: 'practice-records-v2', source: { extensionId, appVersion: '0.1.0' }, data: { sessions: [] } } });
    const digest = await digestBackup(fixture); const command = { ...envelope(), type: 'backup.import', backup: fixture, expectedDigest: digest };
    const imported = await invoke(store, command);
    expect(backupResponseSchema.safeParse(imported).success).toBe(true);
    expect(imported).toMatchObject({ ok: true, kind: 'backup.imported', actionId: command.actionId, receipt: { backupId: fixture.backupId, digest } });
    store.db.close();
    await store.db.open();
    const query = { ...envelope(), type: 'backup.query', backupId: fixture.backupId, expectedDigest: digest };
    const result = await invoke(store, query);
    expect(result).toMatchObject({ ok: true, kind: 'backup.status', actionId: query.actionId, backupId: fixture.backupId, digest });
    if (result.ok && result.kind === 'backup.status' && imported.ok && imported.kind === 'backup.imported') expect(result.receipt).toEqual(imported.receipt);
    const absent = await invoke(store, { ...query, backupId: crypto.randomUUID() });
    expect(absent).toMatchObject({ ok: true, receipt: null });
  });

  it.each([
    ['format', 'other', 'BACKUP_UNSUPPORTED_VERSION'],
    ['formatVersion', 3, 'BACKUP_UNSUPPORTED_VERSION'],
    ['scope', 'future', 'BACKUP_UNSUPPORTED_VERSION'],
    ['unknown', 'value', 'BACKUP_INVALID'],
  ])('损坏backup返回备份类别而非信封错误 %s', async (field, value, code) => {
    const store = makeStore();
    expect(await invoke(store, { ...envelope(), type: 'backup.import', backup: { ...fixture, [field]: value }, expectedDigest: 'a'.repeat(64) })).toMatchObject({ ok: false, code });
    expect(await store.db.sessions.count()).toBe(0);
  });

  it('摘要不符、backupId碰撞与存储故障不返回原始异常', async () => {
    const store = makeStore(); const digest = await digestBackup(fixture);
    expect(await invoke(store, { ...envelope(), type: 'backup.import', backup: fixture, expectedDigest: '0'.repeat(64) })).toMatchObject({ code: 'BACKUP_DIGEST_MISMATCH' });
    await invoke(store, { ...envelope(), type: 'backup.import', backup: fixture, expectedDigest: digest });
    expect(await invoke(store, { ...envelope(), type: 'backup.query', backupId: fixture.backupId, expectedDigest: '0'.repeat(64) })).toMatchObject({ code: 'BACKUP_ID_COLLISION' });
    vi.spyOn(store.db.backupImports, 'get').mockRejectedValueOnce(new DOMException('PRIVATE_SENTINEL', 'SecurityError'));
    const failed = await invoke(store, { ...envelope(), type: 'backup.query', backupId: fixture.backupId, expectedDigest: digest });
    expect(failed).toMatchObject({ code: 'STORAGE_DENIED' });
    expect(JSON.stringify(failed)).not.toContain('PRIVATE_SENTINEL');
  });
});
