const logger = console;

export function formatTime(timestamp: number): string {
  /*
   * ========================================================================
   * 步骤1：显示协议允许的时间
   * ========================================================================
   * 数据源：已保存记录或备份的epoch毫秒。
   * 操作：1) 有效Date沿用原显示。2) 超出Date范围时保留原毫秒值。
   */
  logger.info('开始格式化记录时间');
  try {
    // 1.1 协议安全整数范围大于Date范围，不能将合法记录当损坏数据。
    if (Number.isNaN(new Date(timestamp).getTime())) return `${timestamp}（UTC毫秒）`;
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp);
  } finally { logger.info('记录时间格式化结束'); }
}

export function timeDateTime(timestamp: number): string | undefined {
  /*
   * ========================================================================
   * 步骤1：生成有效的语义时间
   * ========================================================================
   * 数据源：原始epoch毫秒。
   * 操作：1) 检查Date可表示范围。2) 仅为有效日期提供ISO属性。
   */
  logger.info('开始生成语义时间');
  try {
    // 1.1 无法表示的Date省略属性，正文仍显示原始毫秒。
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  } finally { logger.info('语义时间生成结束'); }
}
