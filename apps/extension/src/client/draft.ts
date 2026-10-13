import type { Command, Committed, Session, WriteCommand } from '../shared/protocol';
import { ClientError } from './transport';

type DraftState = { session: Session; text: string; status: 'saved' | 'dirty' | 'saving' | 'error'; error: string | null };
const logger = console;
export class DraftController {
  private state: DraftState;
  private generation = 0;
  private savedGeneration = 0;
  private pending?: { command: WriteCommand; generation: number; recovering: boolean };
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private listeners = new Set<() => void>();

  constructor(session: Session, private readonly envelope: () => Pick<Command, 'protocolVersion' | 'extensionId' | 'actionId'>,
    private readonly write: (command: WriteCommand, recovering?: boolean) => Promise<Committed>) {
    this.state = { session, text: session.draft, status: 'saved', error: null };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<DraftState>) {
    this.state = { ...this.state, ...change };
    if (!this.disposed) this.listeners.forEach((listener) => listener());
  }
  edit(text: string) {
    if (this.disposed || this.state.session.status === 'paused') return;
    this.generation++;
    this.update({ text, status: this.state.error ? 'error' : this.running ? 'saving' : 'dirty' });
    clearTimeout(this.timer);
    if (!this.state.error) this.timer = setTimeout(() => { void this.flush().catch(() => undefined); }, 500);
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    if (this.state.error) return Promise.reject(new ClientError(this.state.error));
    this.running = this.drain().finally(() => { this.running = undefined; });
    return this.running;
  }
  retry() { this.update({ error: null }); return this.flush(); }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.listeners.clear(); }

  private async drain() {
    /*
     * ========================================================================
     * 步骤1：串行保存编辑快照
     * ========================================================================
     * 数据源：编辑代次、当前文本与最后确认 revision。
     * 操作：1) 一次只发一个写入。2) 确认只覆盖对应代次，失败保留文本与原动作。
     */
    logger.info('开始保存草稿');
    try {
      while (!this.disposed && this.generation !== this.savedGeneration) {
        // 1.1 保存命令绑定会话、题目与本次输入快照。
        const current = this.state.session;
        this.pending ??= { generation: this.generation, recovering: false, command: {
          ...this.envelope(), type: 'saveDraft', sessionId: current.id,
          problemSnapshotId: current.problemSnapshotId, expectedRevision: current.revision, text: this.state.text,
        } };
        const pending = this.pending;
        this.update({ status: 'saving', error: null });
        try {
          const result = await this.write(pending.command, pending.recovering);
          // 1.2 保留后续输入；旧回执不能将新内容显示为已保存。
          this.savedGeneration = pending.generation;
          this.pending = undefined;
          this.update({ session: result.session, status: this.generation === this.savedGeneration ? 'saved' : 'dirty' });
        } catch (error) {
          pending.recovering = true;
          const code = error instanceof ClientError ? error.code : 'OUTCOME_UNKNOWN';
          this.update({ status: 'error', error: code });
          throw error;
        }
      }
    } finally { logger.info('草稿保存结束'); }
  }
}
