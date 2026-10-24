export type Sender = { id?: string; url?: string; frameId?: number; origin?: string };
const logger = console;

export function isAllowedSource(sender: Sender, extensionId: string, workspaceOnly = false): boolean {
  /*
   * ========================================================================
   * 步骤1：核对浏览器提供的扩展页面来源
   * ========================================================================
   * 数据源：浏览器 sender 与当前扩展 ID，不读取消息自报角色。
   * 操作：1) 保留学习入口的页面、frame 和 origin 约束。2) 备份只允许工作台。
   */
  logger.info('开始校验扩展来源');
  try {
    // 1.1 原生侧栏可能缺省 frameId；非法 URL 一律拒绝。
    let url: URL;
    try { url = new URL(sender.url ?? ''); } catch { return false; }
    // 1.2 备份缩小页面白名单，不放宽扩展身份和顶层页面检查。
    const allowedPage = workspaceOnly ? url.pathname === '/workspace.html' : ['/workspace.html', '/sidepanel.html'].includes(url.pathname);
    return sender.id === extensionId && (sender.frameId === undefined || sender.frameId === 0) &&
      url.protocol === 'chrome-extension:' && url.hostname === extensionId && allowedPage &&
      (sender.origin === undefined || sender.origin === `chrome-extension://${extensionId}`);
  } finally { logger.info('扩展来源校验结束'); }
}
