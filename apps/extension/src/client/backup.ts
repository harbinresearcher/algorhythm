import { validateBackup } from '../core/backup';
import { backupResponseSchema, type Backup, type BackupCommand, type BackupImportReceipt } from '../shared/backup';
import { PROTOCOL_VERSION } from '../shared/protocol';
import { ClientError } from './transport';

const logger = console;

export function createBackupClient(extensionId: string, send: (command: BackupCommand) => Promise<unknown>, timeoutMs = 30_000) {
  const envelope = () => ({ protocolVersion: PROTOCOL_VERSION, extensionId, actionId: crypto.randomUUID() } as const);

  async function request(command: BackupCommand) {
    /*
     * ========================================================================
     * 步骤1：限时等待并验证备份响应
     * ========================================================================
     * 数据源：管理命令与不可信后台响应。
     * 操作：1) 单次最多等待30秒。2) 严格核对schema和原actionId。
     */
    logger.info('开始等待备份响应', { actionId: command.actionId });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // 1.1 传输拒绝和超时只表示连接中断，不推断事务结果。
      let raw: unknown;
      try {
        raw = await Promise.race([send(command), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ClientError('CONNECTION_LOST')), timeoutMs);
        })]);
      } catch { throw new ClientError('CONNECTION_LOST'); }
      // 1.2 分类后台错误保留原错误码，不能借查询转成成功。
      const result = backupResponseSchema.safeParse(raw);
      if (!result.success || result.data.actionId !== command.actionId) throw new ClientError('INVALID_RESPONSE');
      if (!result.data.ok) throw new ClientError(result.data.code);
      return result.data;
    } finally { clearTimeout(timer); logger.info('备份响应等待结束', { actionId: command.actionId }); }
  }

  async function queryBackup(backupId: string, digest: string): Promise<BackupImportReceipt | null> {
    /*
     * ========================================================================
     * 步骤1：核实持久化导入回执
     * ========================================================================
     * 数据源：原backupId、摘要和后台查询结果。
     * 操作：1) 核对响应身份。2) 只接受对应文件的回执。
     */
    logger.info('开始核实备份', { backupId });
    try {
      // 1.1 查询响应和非空回执必须同时属于原备份与摘要。
      const result = await request({ ...envelope(), type: 'backup.query', backupId, expectedDigest: digest });
      if (result.kind !== 'backup.status' || result.backupId !== backupId || result.digest !== digest ||
        (result.receipt && (result.receipt.backupId !== backupId || result.receipt.digest !== digest))) throw new ClientError('INVALID_RESPONSE');
      return result.receipt;
    } finally { logger.info('备份核实结束', { backupId }); }
  }

  async function importBackup(backup: Backup, expectedDigest: string, recovering = false): Promise<BackupImportReceipt> {
    /*
     * ========================================================================
     * 步骤1：提交备份并核实未知结果
     * ========================================================================
     * 数据源：已确认文件、原backupId与摘要。
     * 操作：1) 手动恢复先查回执。2) 连接异常只查一次，不自动重发。
     */
    logger.info('开始请求导入备份', { backupId: backup.backupId });
    try {
      // 1.1 只有用户手动恢复且查不到回执，才允许重发同一文件。
      if (recovering) {
        let previous: BackupImportReceipt | null;
        try { previous = await queryBackup(backup.backupId, expectedDigest); } catch { throw new ClientError('OUTCOME_UNKNOWN'); }
        if (previous) return previous;
      }
      try {
        const result = await request({ ...envelope(), type: 'backup.import', backup, expectedDigest });
        if (result.kind !== 'backup.imported' || result.receipt.backupId !== backup.backupId || result.receipt.digest !== expectedDigest) throw new ClientError('INVALID_RESPONSE');
        return result.receipt;
      } catch (error) {
        if (error instanceof ClientError && !['CONNECTION_LOST', 'INVALID_RESPONSE'].includes(error.code)) throw error;
        // 1.2 空回执或查询失败均保留未知状态，不追加第二笔导入。
        try { const known = await queryBackup(backup.backupId, expectedDigest); if (known) return known; } catch { /* 保留未知结果。 */ }
        throw new ClientError('OUTCOME_UNKNOWN');
      }
    } finally { logger.info('备份导入请求结束', { backupId: backup.backupId }); }
  }

  async function exportBackup(): Promise<Backup> {
    /*
     * ========================================================================
     * 步骤1：读取已保存的一致备份
     * ========================================================================
     * 数据源：后台只读事务返回的四表快照。
     * 操作：1) 校验响应种类。2) 再验证文件关系，损坏响应不生成文件。
     */
    logger.info('开始请求导出备份');
    try {
      // 1.1 本地校验只做纯计算，不触发学习动作或数据库写入。
      const result = await request({ ...envelope(), type: 'backup.export' });
      if (result.kind !== 'backup.exported') throw new ClientError('INVALID_RESPONSE');
      try { return validateBackup(result.backup); } catch { throw new ClientError('INVALID_RESPONSE'); }
    } finally { logger.info('备份导出请求结束'); }
  }

  return { exportBackup, importBackup, queryBackup };
}
