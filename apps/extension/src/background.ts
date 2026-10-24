import { Store } from './core/store';

const logger = console;
const store = new Store('algorhythm-prototype-v1', chrome.runtime.id);
/*
 * ========================================================================
 * 步骤1：注册扩展入口
 * ========================================================================
 * 数据源：Chrome 消息与用户工具栏操作。
 * 操作：1) 同步注册监听，后台重启仍能接收。2) 事务提交后返回确认。
 */
logger.info('开始注册扩展入口');
// 1.1 来源只采用浏览器 sender，不采用消息中的声明。
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  void store.handle(message, sender).then(respond);
  return true;
});
// 1.2 图标打开完整工作台；侧栏由界面中的用户操作打开。
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('workspace.html') });
});
logger.info('扩展入口注册完成');
