import { z } from 'zod';
import { backupCommandSchema, type BackupResponse } from '../shared/backup';
import { PROTOCOL_VERSION } from '../shared/protocol';
import { BackupError, exportBackup, importBackup, queryBackup, validateBackup } from './backup';
import { classifyStorageError, type Store } from './store';
import { isAllowedSource, type Sender } from './source';

const logger = console;
const importEnvelopeSchema = backupCommandSchema.options[1].extend({ backup: z.unknown() });

export async function handleBackup(store: Store, input: unknown, sender: Sender, extensionId: string, appVersion: string): Promise<BackupResponse> {
  /*
   * ========================================================================
   * 步骤1：核验工作台来源并分派独立管理消息
   * ========================================================================
   * 数据源：浏览器 sender、共享消息 schema 与持久化备份核心。
   * 操作：1) 先查来源、协议和实例，再验文件。2) 仅返回脱敏错误，提交后才确认。
   */
  logger.info('开始处理备份消息');
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const actionId = z.uuid().safeParse(raw.actionId).success ? raw.actionId as string : null;
  try {
    // 1.1 不接受消息声明的角色；侧栏与子框架不能管理备份。
    if (!isAllowedSource(sender, extensionId, true)) throw new BackupError('FORBIDDEN');
    if (raw.protocolVersion !== PROTOCOL_VERSION) throw new BackupError('PROTOCOL_MISMATCH');
    if (raw.extensionId !== extensionId) throw new BackupError('INSTANCE_MISMATCH');
    // 1.2 先分开信封与文件边界，保留损坏文件的明确备份错误类别。
    let prepared = input;
    if (raw.type === 'backup.import') {
      const envelope = importEnvelopeSchema.safeParse(input);
      if (!envelope.success) throw new BackupError('INVALID_COMMAND');
      prepared = { ...envelope.data, backup: validateBackup(envelope.data.backup) };
    }
    const parsed = backupCommandSchema.safeParse(prepared);
    if (!parsed.success) throw new BackupError('INVALID_COMMAND');
    const command = parsed.data;
    // 1.3 核心返回时读事务或五表写事务已经结束，不借用学习动作回执。
    if (command.type === 'backup.export') return { ok: true, kind: 'backup.exported', actionId: command.actionId,
      backup: await exportBackup(store, { appVersion, extensionId }) };
    if (command.type === 'backup.import') return { ok: true, kind: 'backup.imported', actionId: command.actionId,
      receipt: await importBackup(store, command.backup, command.expectedDigest, extensionId) };
    return { ok: true, kind: 'backup.status', actionId: command.actionId, backupId: command.backupId,
      digest: command.expectedDigest, receipt: await queryBackup(store, command.backupId, command.expectedDigest) };
  } catch (error) {
    // 1.4 不把备份专属错误塞入旧 diagnostics schema，不输出异常或学习文本。
    const code = error instanceof BackupError ? error.code : classifyStorageError(error);
    logger.info('备份消息失败', { actionId, code });
    return { ok: false, actionId, code };
  } finally { logger.info('备份消息处理结束', { actionId }); }
}
