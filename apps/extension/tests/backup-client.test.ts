import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackupClient } from '../src/client/backup';
import type { Backup, BackupCommand, BackupImportReceipt } from '../src/shared/backup';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const backupId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const digest = 'a'.repeat(64);
const otherDigest = 'b'.repeat(64);
const backup: Backup = { format: 'algorhythm-backup', formatVersion: 1, scope: 'prototype-storage-v1',
  backupId, exportedAt: 1, source: { appVersion: '0.1.0', extensionId },
  data: { problems: [], sessions: [], events: [], actions: [] } };
const receipt: BackupImportReceipt = { backupId, digest, sourceExtensionId: extensionId, exportedAt: 1, importedAt: 2,
  added: { problems: 0, sessions: 0, events: 0, actions: 0 }, skipped: { problems: 0, sessions: 0, events: 0, actions: 0 } };
const imported = (command: BackupCommand) => ({ ok: true, kind: 'backup.imported', actionId: command.actionId, receipt });
const status = (command: BackupCommand, known: BackupImportReceipt | null = null) =>
  ({ ok: true, kind: 'backup.status', actionId: command.actionId, backupId, digest, receipt: known });

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('备份客户端边界', () => {
  it('导出只接受对应动作的严格备份响应', async () => {
    const commands: BackupCommand[] = [];
    const client = createBackupClient(extensionId, async (command) => {
      commands.push(command);
      return { ok: true, kind: 'backup.exported', actionId: command.actionId, backup };
    });
    expect(await client.exportBackup()).toEqual(backup);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: 'backup.export', protocolVersion: 1, extensionId });
  });

  it('导入返回身份匹配的成功回执', async () => {
    const commands: BackupCommand[] = [];
    const client = createBackupClient(extensionId, async (command) => { commands.push(command); return imported(command); });
    expect(await client.importBackup(backup, digest)).toEqual(receipt);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: 'backup.import', backup, expectedDigest: digest });
  });

  it.each(['BACKUP_CONFLICT', 'STORAGE_FULL', 'FORBIDDEN'])('已分类后台错误%s直接失败，不查询或重发', async (code) => {
    const commands: BackupCommand[] = [];
    const client = createBackupClient(extensionId, async (command) => { commands.push(command); return { ok: false, actionId: command.actionId, code }; });
    await expect(client.importBackup(backup, digest)).rejects.toMatchObject({ code });
    expect(commands.map((command) => command.type)).toEqual(['backup.import']);
  });

  it.each(['schema', 'actionId', 'kind', 'backupId', 'digest'])('首次导入%s非法只查一次，不接受成功', async (field) => {
    const commands: BackupCommand[] = [];
    const client = createBackupClient(extensionId, async (command) => {
      commands.push(command);
      if (command.type === 'backup.query') return status(command);
      const result = imported(command);
      if (field === 'schema') return { ...result, unexpected: true };
      if (field === 'actionId') return { ...result, actionId: otherId };
      if (field === 'kind') return status(command, receipt);
      return { ...result, receipt: { ...receipt, [field]: field === 'backupId' ? otherId : otherDigest } };
    });
    await expect(client.importBackup(backup, digest)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(commands.map((command) => command.type)).toEqual(['backup.import', 'backup.query']);
  });

  it('send拒绝后只查询一次；查到已提交结果才恢复成功', async () => {
    const commands: BackupCommand[] = [];
    const client = createBackupClient(extensionId, async (command) => {
      commands.push(command);
      if (command.type === 'backup.import') throw new Error('disconnected');
      return status(command, receipt);
    });
    expect(await client.importBackup(backup, digest)).toEqual(receipt);
    expect(commands.map((command) => command.type)).toEqual(['backup.import', 'backup.query']);
  });

  it.each(['null', 'reject', 'invalid'])('send拒绝且查询%s仍未知，不自动重发', async (queryResult) => {
    const commands: BackupCommand[] = [];
    const client = createBackupClient(extensionId, async (command) => {
      commands.push(command);
      if (command.type === 'backup.import' || queryResult === 'reject') throw new Error('disconnected');
      return queryResult === 'invalid' ? { ok: true } : status(command);
    });
    await expect(client.importBackup(backup, digest)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(commands.map((command) => command.type)).toEqual(['backup.import', 'backup.query']);
  });

  it('默认等待30秒后查询；超时不自动重发导入', async () => {
    vi.useFakeTimers();
    const commands: BackupCommand[] = [];
    const client = createBackupClient(extensionId, async (command) => {
      commands.push(command);
      return command.type === 'backup.import' ? new Promise<never>(() => undefined) : status(command);
    });
    let settled = false;
    const pending = client.importBackup(backup, digest).catch((error: unknown) => { settled = true; return error; });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe(false);
    expect(commands.map((command) => command.type)).toEqual(['backup.import']);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(commands.map((command) => command.type)).toEqual(['backup.import', 'backup.query']);
  });

  it('手动恢复先查询；已有回执时不重发', async () => {
    const commands: BackupCommand[] = [];
    const client = createBackupClient(extensionId, async (command) => { commands.push(command); return status(command, receipt); });
    expect(await client.importBackup(backup, digest, true)).toEqual(receipt);
    expect(commands.map((command) => command.type)).toEqual(['backup.query']);
  });

  it('手动恢复查询null后才重发同文件和摘要', async () => {
    const commands: BackupCommand[] = [];
    const client = createBackupClient(extensionId, async (command) => {
      commands.push(command);
      return command.type === 'backup.query' ? status(command) : imported(command);
    });
    expect(await client.importBackup(backup, digest, true)).toEqual(receipt);
    expect(commands.map((command) => command.type)).toEqual(['backup.query', 'backup.import']);
    expect(commands[0]).toMatchObject({ backupId, expectedDigest: digest });
    expect(commands[1]).toMatchObject({ backup, expectedDigest: digest });
  });

  it('手动恢复查询失败时不重发', async () => {
    const commands: BackupCommand[] = [];
    const client = createBackupClient(extensionId, async (command) => { commands.push(command); throw new Error('offline'); });
    await expect(client.importBackup(backup, digest, true)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(commands.map((command) => command.type)).toEqual(['backup.query']);
  });

  it.each(['schema', 'actionId', 'backupId', 'digest', 'receiptBackupId', 'receiptDigest', 'kind'])('查询%s错误不能确认结果', async (field) => {
    const client = createBackupClient(extensionId, async (command) => {
      const result = status(command, receipt);
      if (field === 'schema') return { ...result, unexpected: true };
      if (field === 'actionId') return { ...result, actionId: otherId };
      if (field === 'backupId') return { ...result, backupId: otherId };
      if (field === 'digest') return { ...result, digest: otherDigest };
      if (field === 'receiptBackupId') return { ...result, receipt: { ...receipt, backupId: otherId } };
      if (field === 'receiptDigest') return { ...result, receipt: { ...receipt, digest: otherDigest } };
      return imported(command);
    });
    await expect(client.queryBackup(backupId, digest)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each(['schema', 'actionId', 'kind'])('导出%s错误不生成备份', async (field) => {
    const client = createBackupClient(extensionId, async (command) => {
      const result = { ok: true, kind: 'backup.exported', actionId: command.actionId, backup };
      if (field === 'schema') return { ...result, unexpected: true };
      if (field === 'actionId') return { ...result, actionId: otherId };
      return imported(command);
    });
    await expect(client.exportBackup()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
