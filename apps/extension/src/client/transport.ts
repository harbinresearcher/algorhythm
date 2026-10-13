import { PROTOCOL_VERSION, responseSchema, type Command, type Committed, type WriteCommand } from '../shared/protocol';
export class ClientError extends Error { constructor(readonly code: string) { super(code); } }
const logger = console;
export function createClient(extensionId: string, send: (command: Command) => Promise<unknown>, timeoutMs = 5_000) {
  const envelope = () => ({ protocolVersion: PROTOCOL_VERSION, extensionId, actionId: crypto.randomUUID() } as const);
  async function request(command: Command) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([send(command), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ClientError('CONNECTION_LOST')), timeoutMs);
      })]);
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success || parsed.data.actionId !== command.actionId) throw new ClientError('INVALID_RESPONSE');
      if (!parsed.data.ok) throw new ClientError(parsed.data.code);
      return parsed.data;
    } finally { clearTimeout(timer); }
  }
  async function query(command: WriteCommand) {
    const result = await request({ ...envelope(), type: 'queryAction', targetActionId: command.actionId });
    if (result.kind !== 'action' || (result.result && result.result.actionId !== command.actionId)) throw new ClientError('INVALID_RESPONSE');
    return result.result;
  }
  async function write(command: WriteCommand, recovering = false): Promise<Committed> {
    /*
     * ========================================================================
     * 步骤1：提交命令并核实未知结果
     * ========================================================================
     * 数据源：原动作 ID 与后台回执。
     * 操作：1) 手动恢复先查原结果。2) 丢确认时只查询，不自动重发。
     */
    logger.info('开始请求保存', { actionId: command.actionId });
    try {
      // 1.1 已提交动作直接恢复；未提交动作仅在手动恢复时补传。
      if (recovering) {
        let previous: Committed | null;
        try { previous = await query(command); } catch { throw new ClientError('OUTCOME_UNKNOWN'); }
        if (previous) return previous;
      }
      try {
        const result = await request(command);
        if (result.kind !== 'committed') throw new ClientError('INVALID_RESPONSE');
        return result;
      } catch (error) {
        if (error instanceof ClientError && !['CONNECTION_LOST', 'INVALID_RESPONSE'].includes(error.code)) throw error;
        // 1.2 连接失败不能推断事务失败，也不产生新的 actionId。
        try { const known = await query(command); if (known) return known; } catch { /* 保留未知状态。 */ }
        throw new ClientError('OUTCOME_UNKNOWN');
      }
    } finally { logger.info('保存请求结束', { actionId: command.actionId }); }
  }
  return {
    envelope, write,
    async read() {
      const result = await request({ ...envelope(), type: 'read' });
      if (result.kind !== 'snapshot') throw new ClientError('INVALID_RESPONSE');
      return result;
    },
  };
}
