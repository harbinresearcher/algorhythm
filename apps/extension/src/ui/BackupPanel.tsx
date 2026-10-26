import { useRef, useState, type ChangeEvent } from 'react';
import { createBackupClient } from '../client/backup';
import { ClientError } from '../client/transport';
import { BackupError, digestBackup, parseBackup } from '../core/backup';
import { MAX_BACKUP_BYTES, type Backup, type BackupImportReceipt } from '../shared/backup';
import { formatTime, timeDateTime } from './time';

const logger = console;
type Preview = { file: File; backup: Backup; digest: string };
type Props = {
  busy: boolean; blocked: boolean;
  run: <T>(task: () => Promise<T>) => Promise<T>;
  onPendingChange: (pending: boolean) => void;
  onImported: () => Promise<void>;
};
const errors: Record<string, string> = {
  BACKUP_INVALID: '备份内容或记录关系不合法，未导入。',
  BACKUP_UNSUPPORTED_VERSION: '不支持这份文件的格式或版本，未导入。',
  BACKUP_TOO_LARGE: '备份超过10 MiB或记录数量上限，未导入。',
  BACKUP_CONFLICT: '发现同 ID 内容不同，整份备份未导入。已有记录保持原样。',
  BACKUP_ID_COLLISION: '这份备份的 ID 已用于另一份内容，未导入。请核对原文件。',
  BACKUP_DIGEST_MISMATCH: '文件与确认时的摘要不一致，未导入。请重新选择原文件。',
  OUTCOME_UNKNOWN: '暂时无法确认导入结果。请保留原文件，点击“核实并重试”。',
  STORAGE_FULL: '本地空间不足，操作未完成。当前草稿仍可单独导出。',
  STORAGE_DENIED: '浏览器拒绝访问本地存储，操作未完成。',
  STORAGE_FAILED: '本地存储操作失败，请保留原文件后重试。',
  FORBIDDEN: '此页面没有备份权限，请从完整工作台进入。',
  PROTOCOL_MISMATCH: '页面和后台版本不一致，请重新打开工作台。',
  INSTANCE_MISMATCH: '这份请求属于另一扩展，请重新打开工作台。',
  INVALID_RESPONSE: '后台响应不符合备份协议，本次操作未能确认。',
  CONNECTION_LOST: '连接中断，本次操作未能确认。请保留原文件。',
  INVALID_STATE: '当前还有未完成的操作，请先处理后再备份。',
};
const messageFor = (error: unknown) => error instanceof ClientError || error instanceof BackupError
  ? errors[error.code] ?? `操作未完成（${error.code}）。` : '操作未完成，请保留原文件后重试。';

function downloadBackup(backup: Backup) {
  /*
   * ========================================================================
   * 步骤1：生成本地下载文件
   * ========================================================================
   * 数据源：已校验的后台一致快照。
   * 操作：1) 用Blob和临时URL下载JSON。2) 结束后释放URL，不声称已写入磁盘。
   */
  logger.info('开始生成备份下载', { backupId: backup.backupId });
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json;charset=utf-8' }));
  try {
    // 1.1 文件名只使用当前UTC时间，不使用来源字段或用户文件名。
    const link = document.createElement('a');
    link.href = url;
    link.download = `algorhythm-prototype-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1_000); logger.info('备份下载生成结束', { backupId: backup.backupId }); }
}

export default function BackupPanel({ busy, blocked, run, onPendingChange, onImported }: Props) {
  const [client] = useState(() => createBackupClient(chrome.runtime.id, (command) => chrome.runtime.sendMessage(command)));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reading, setReading] = useState(false);
  const [working, setWorking] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState<BackupImportReceipt | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const operation = useRef(false);
  const confirmed = useRef<Preview | null>(null);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    /*
     * ========================================================================
     * 步骤1：只读验证本次文件选择
     * ========================================================================
     * 数据源：用户选择的File，不可信文本与当前选择代次。
     * 操作：1) 先检查字节上限再读取。2) 取消或换文件使迟到结果失效。
     */
    if (operation.current || unknown || busy || blocked) return;
    logger.info('开始读取备份预览');
    const generation = ++selection.current;
    const file = event.target.files?.[0];
    setPreview(null); setReceipt(null); setError(''); setNotice(''); setReading(!!file);
    try {
      // 1.1 选择文件不发送消息，也不写数据库。
      if (!file) return;
      if (file.size > MAX_BACKUP_BYTES) throw new BackupError('BACKUP_TOO_LARGE');
      const text = await file.text();
      if (generation !== selection.current) return;
      const backup = parseBackup(text);
      const digest = await digestBackup(backup);
      // 1.2 只有当前选择仍有效，才发布可确认的预览。
      if (generation === selection.current) setPreview({ file, backup, digest });
    } catch (failure) { if (generation === selection.current) setError(messageFor(failure)); }
    finally { if (generation === selection.current) setReading(false); logger.info('备份预览读取结束'); }
  }

  function cancel() {
    /*
     * ========================================================================
     * 步骤1：取消尚未提交的预览
     * ========================================================================
     * 数据源：当前本地预览与选择代次。
     * 操作：1) 作废迟到读取。2) 清除选择，不发送导入消息。
     */
    logger.info('开始取消备份预览');
    try {
      // 1.1 未知结果必须保留原文件，不允许通过取消开始另一笔导入。
      if (operation.current || unknown) return;
      selection.current++; setPreview(null); setReceipt(null); setReading(false); setError(''); setNotice('');
      if (input.current) input.current.value = '';
    } finally { logger.info('备份预览取消结束'); }
  }

  async function exportFile() {
    /*
     * ========================================================================
     * 步骤1：等待当前草稿确认后导出
     * ========================================================================
     * 数据源：父工作台互斥锁、当前草稿与后台快照。
     * 操作：1) 复用父级flush。2) 只下载完整且已校验的结果。
     */
    if (operation.current || unknown || busy || blocked) return;
    logger.info('开始处理备份下载');
    operation.current = true; setWorking(true); setError(''); setNotice('');
    let started = false;
    try {
      // 1.1 run先等DraftController.flush；失败时不请求完整备份。
      await run(async () => { started = true; downloadBackup(await client.exportBackup()); });
      setNotice('备份已生成，请确认文件已下载。');
    } catch (failure) { setError(started ? messageFor(failure) : '当前草稿尚未确认，未生成完整备份。请先在编辑区重试保存或导出草稿。'); }
    finally { operation.current = false; setWorking(false); logger.info('备份下载处理结束'); }
  }

  async function importFile(recovering = false) {
    /*
     * ========================================================================
     * 步骤1：确认导入或恢复原请求
     * ========================================================================
     * 数据源：只读预览、已确认文件与后台持久化回执。
     * 操作：1) 等草稿确认并锁住换题。2) 未知结果保留原文件，成功与刷新失败分开。
     */
    if (operation.current || busy || blocked || (!recovering && unknown)) return;
    const current = recovering ? confirmed.current : preview;
    if (!current) return;
    logger.info('开始处理备份导入', { backupId: current.backup.backupId });
    operation.current = true; setWorking(true); setError(''); setNotice('');
    let started = false;
    try {
      await run(async () => {
        // 1.1 仅在flush通过后确认本次文件，未知状态不允许换文件或另发导入。
        started = true; confirmed.current = current; onPendingChange(true);
        let result: BackupImportReceipt;
        try { result = await client.importBackup(current.backup, current.digest, recovering); }
        catch (failure) {
          const uncertain = failure instanceof ClientError && failure.code === 'OUTCOME_UNKNOWN';
          setUnknown(uncertain);
          if (!uncertain) { confirmed.current = null; onPendingChange(false); }
          throw failure;
        }
        // 1.2 已确认回执先保存；后续读取失败不能撤销导入成功。
        setReceipt(result); setUnknown(false); confirmed.current = null; onPendingChange(false);
        setNotice('导入成功。仅补入缺失记录，相同记录已跳过。');
        try { await onImported(); }
        catch { setError('导入已确认，但工作台记录更新失败。请点击“更新记录”。'); }
      });
    } catch (failure) { setError(started ? messageFor(failure) : '当前草稿尚未确认，未开始导入。请先在编辑区重试保存或导出草稿。'); }
    finally { operation.current = false; setWorking(false); logger.info('备份导入处理结束', { backupId: current.backup.backupId }); }
  }

  const disabled = busy || blocked || working;
  const rows = preview?.backup.data;
  return <section className="backup-panel" aria-labelledby="backup-title">
    <h2 id="backup-title">备份与恢复</h2>
    <p className="muted hint">仅包含本练习记录原型四表中已保存的数据，包括手动记录和合成演示。其他页面尚未确认的输入不在备份内。文件含思路和代码，请自行保管。</p>
    <div className="button-row"><button disabled={disabled || unknown || reading} onClick={() => { void exportFile(); }}>下载备份</button></div>
    <label className="backup-file-label" htmlFor="backup-file">选择备份文件</label>
    <input ref={input} id="backup-file" type="file" accept=".json,application/json" aria-label="选择备份文件"
      aria-describedby="backup-file-help" disabled={disabled || unknown} onChange={(event) => { void selectFile(event); }} />
    <p id="backup-file-help" className="muted hint">JSON文件，最多10 MiB。选择与预览不写入记录。</p>
    {reading && <p className="notice" role="status">正在验证备份文件…</p>}
    {preview && rows && <div className="backup-preview" aria-label="备份预览">
      <dl>
        <dt>文件</dt><dd>{preview.file.name}</dd>
        <dt>来源版本</dt><dd>{preview.backup.source.appVersion}</dd>
        <dt>来源扩展</dt><dd>{preview.backup.source.extensionId}</dd>
        <dt>文件版本</dt><dd>{preview.backup.formatVersion} · {preview.backup.scope}</dd>
        <dt>导出时间</dt><dd><time dateTime={timeDateTime(preview.backup.exportedAt)}>{formatTime(preview.backup.exportedAt)}</time></dd>
        <dt>题目快照</dt><dd>{rows.problems.length}</dd>
        <dt>会话</dt><dd>{rows.sessions.length}</dd>
        <dt>事件</dt><dd>{rows.events.length}</dd>
        <dt>学习动作回执</dt><dd>{rows.actions.length}</dd>
      </dl>
      <p className="hint">仅补入缺失记录。相同记录跳过；发现同 ID 内容不同，则整份不导入。不会覆盖已有学习记录。</p>
      <div className="button-row">
        <button className="primary" disabled={disabled || unknown} onClick={() => { void importFile(); }}>确认导入</button>
        <button disabled={disabled || unknown} onClick={cancel}>取消</button>
      </div>
    </div>}
    {reading && !preview && <button disabled={disabled || unknown} onClick={cancel}>取消</button>}
    {working && <p className="notice" role="status">正在等待草稿确认或处理备份，请保留此页面…</p>}
    {error && <div className="error-box" role="alert"><p>{error}</p>{unknown && <button disabled={busy || working || blocked} onClick={() => { void importFile(true); }}>核实并重试</button>}</div>}
    <p className="notice" role="status">{notice}</p>
    {receipt && <p className="muted hint" aria-label="导入回执">已确认导入回执。新增：题目{receipt.added.problems}、会话{receipt.added.sessions}、事件{receipt.added.events}、动作{receipt.added.actions}；跳过：题目{receipt.skipped.problems}、会话{receipt.skipped.sessions}、事件{receipt.skipped.events}、动作{receipt.skipped.actions}。</p>}
  </section>;
}
