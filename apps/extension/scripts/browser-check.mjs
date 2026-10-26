import { chromium } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir, version as osVersion } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const logger = console;
const artifactDir = resolve('output/playwright');
const extensionPath = resolve('dist');
const profile = await mkdtemp(join(tmpdir(), 'algorhythm-prototype-'));
await mkdir(artifactDir, { recursive: true });
const options = { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`], viewport: { width: 1360, height: 1000 } };
let context;
const evidence = { date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()), profile: 'isolated temporary profile', results: [], errors: [] };
const record = (name) => { evidence.results.push(name); logger.info('通过', name); };
async function openContext() {
  const next = await chromium.launchPersistentContext(profile, options);
  next.on('page', (page) => { page.on('pageerror', (error) => evidence.errors.push(error.message)); });
  return next;
}
async function waitSaved(page) { await page.locator('.save-status').filter({ hasText: /^已保存$/ }).waitFor(); }
async function send(page, command) {
  return page.evaluate((input) => chrome.runtime.sendMessage({ protocolVersion: 2, extensionId: chrome.runtime.id, actionId: crypto.randomUUID(), ...input }), command);
}

async function attachNativePanel(cdp, targetId) {
  // 原生 SIDE_PANEL 是 CDP page target，但 Playwright 不将其暴露为 Page。
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  let sequence = 0;
  const waiting = new Map();
  cdp.on('Target.receivedMessageFromTarget', (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id); clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
  });
  async function command(method, params = {}) {
    const id = ++sequence;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`Native panel timeout: ${method}`)); }, 10_000);
      waiting.set(id, { resolve, reject, timer });
    });
    await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) });
    return result;
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  return {
    command, evaluate,
    async waitFor(expression) {
      const end = Date.now() + 10_000;
      while (Date.now() < end) { if (await evaluate(expression)) return; await new Promise((done) => setTimeout(done, 50)); }
      throw new Error(`Native panel condition failed: ${expression}`);
    },
  };
}

try {
  /*
   * ========================================================================
   * 步骤1：验证扩展真实加载与双界面保存
   * ========================================================================
   * 数据源：生产构建、全新临时浏览器配置、合成输入。
   * 操作：1) 打开工作台。2) 关闭后通过侧栏页面继续保存。
   */
  logger.info('开始浏览器验证');
  // 1.1 浏览器版本和扩展来源来自实际运行，不使用用户登录档案。
  context = await openContext();
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  evidence.extensionId = id;
  const workspaceUrl = `chrome-extension://${id}/workspace.html`;
  let workspace = await context.newPage(); await workspace.goto(workspaceUrl);
  evidence.browser = await workspace.evaluate(() => navigator.userAgent);
  evidence.browserVersion = context.browser()?.version();
  evidence.os = osVersion();
  await workspace.getByRole('button', { name: '找出重复编号', exact: false }).click();
  await workspace.getByRole('textbox', { name: '你的思路与代码' }).fill('先遍历每个编号，用集合记录已经见过的编号。');
  await waitSaved(workspace);
  await workspace.getByRole('button', { name: '记录这次尝试', exact: true }).click();
  await workspace.locator('.history li').waitFor();
  await workspace.screenshot({ path: join(artifactDir, 'workspace.png'), fullPage: true });
  record('生产扩展工作台：创建、保存、尝试记录');

  // 1.2 记录原生侧栏打开结果；独立标签访问侧栏 HTML 不冒充原生宿主。
  await workspace.getByRole('button', { name: '打开练习侧栏', exact: true }).click();
  const anchor = context.pages()[0];
  const cdp = await context.newCDPSession(anchor);
  const panelTargets = (await cdp.send('Target.getTargets')).targetInfos.filter((target) => target.url.includes('sidepanel.html'));
  evidence.nativePanelTargets = panelTargets.map(({ type, url }) => ({ type, url }));
  evidence.nativePanelContexts = await workspace.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }));
  assert.equal(evidence.nativePanelContexts.length, 1);
  assert.equal(evidence.nativePanelContexts[0].documentUrl, panelTargets[0].url);
  const nativePanel = await attachNativePanel(cdp, panelTargets[0].targetId);
  await nativePanel.waitFor('!!document.querySelector("textarea")');
  await workspace.close();
  await nativePanel.evaluate(`(() => { const input = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '原生侧栏在工作台关闭后仍保存。'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await nativePanel.waitFor('document.querySelector(".save-status")?.textContent === "已保存" && document.querySelector("textarea")?.value === "原生侧栏在工作台关闭后仍保存。"');
  await nativePanel.evaluate('document.querySelector(".editor button.primary").click()');
  await nativePanel.waitFor('document.querySelectorAll(".history li").length === 2');
  assert.equal(await nativePanel.evaluate('document.querySelector(".history li pre").textContent'), '原生侧栏在工作台关闭后仍保存。');
  workspace = await context.newPage(); await workspace.goto(workspaceUrl);
  assert.equal(await workspace.getByRole('textbox', { name: '你的思路与代码' }).inputValue(), '原生侧栏在工作台关闭后仍保存。');
  record('SC-01 原生：Chrome SIDE_PANEL 上下文内保存草稿和尝试，关闭工作台不影响；历史按 revision 排序');
  const capture = await nativePanel.command('Page.captureScreenshot');
  await writeFile(join(artifactDir, 'native-panel.png'), Buffer.from(capture.data, 'base64'));
  const panel = await context.newPage(); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.getByRole('textbox', { name: '你的思路与代码' }).waitFor(); await workspace.close();
  await panel.getByRole('textbox', { name: '你的思路与代码' }).fill('工作台已关闭，继续在侧栏页面记录。'); await waitSaved(panel);
  workspace = await context.newPage(); await workspace.goto(workspaceUrl);
  assert.equal(await workspace.getByRole('textbox', { name: '你的思路与代码' }).inputValue(), '工作台已关闭，继续在侧栏页面记录。');
  record('SC-01 页面级：关闭工作台后侧栏页面继续保存，重开一致');
  await panel.setViewportSize({ width: 360, height: 900 });
  await panel.screenshot({ path: join(artifactDir, 'panel-360.png'), fullPage: true });
  assert.ok(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await panel.getByRole('textbox', { name: '你的思路与代码' }).focus(); await panel.keyboard.press('Tab');
  assert.equal(await panel.evaluate(() => document.activeElement.textContent), '记录这次尝试');
  record('360px 无横向溢出，编辑区可用键盘进入动作按钮');

  /*
   * ========================================================================
   * 步骤2：核实数据库事务与后台恢复
   * ========================================================================
   * 数据源：真实 Chrome runtime 消息与 IndexedDB。
   * 操作：1) 重放命令及并发冲突。2) 暂停、恢复、重新打开浏览器。
   */
  logger.info('开始消息与恢复验证');
  // 2.1 使用真实 runtime，消息 actionId 在回执丢失后仍可查询。
  let snapshot = await send(workspace, { type: 'read' });
  assert.equal(snapshot.ok, true);
  const current = snapshot.sessions[0];
  const command = { type: 'saveDraft', actionId: crypto.randomUUID(), sessionId: current.id, problemSnapshotId: current.problemSnapshotId, expectedRevision: current.revision, text: '重复动作只保存一次' };
  await send(workspace, command);
  const query = await send(workspace, { type: 'queryAction', targetActionId: command.actionId });
  assert.deepEqual(await send(workspace, command), query.result);
  assert.equal((await send(workspace, { type: 'read' })).events.filter((event) => event.actionId === command.actionId).length, 1);
  record('SC-03：忽略首次回执后查询与重放均返回原提交，只有一条事件');
  const conflict = await send(workspace, { ...command, actionId: crypto.randomUUID(), text: '过期版本' });
  assert.equal(conflict.code, 'REVISION_CONFLICT');
  record('SC-05：过期 revision 被拒绝');
  assert.equal((await send(workspace, { type: 'read', protocolVersion: 1 })).code, 'PROTOCOL_MISMATCH');
  assert.equal((await send(workspace, { type: 'read', extensionId: 'other-instance' })).code, 'INSTANCE_MISMATCH');
  record('SC-10：协议和扩展实例不一致明确拒绝');

  // 2.2 停止真实 service worker，再用 runtime 消息唤醒。
  const workerCDP = await context.newCDPSession(workspace);
  const versions = new Map();
  workerCDP.on('ServiceWorker.workerVersionUpdated', ({ versions: updates }) => { for (const item of updates) versions.set(item.versionId, item); });
  await workerCDP.send('ServiceWorker.enable');
  const deadline = Date.now() + 5_000;
  while (![...versions.values()].some((item) => item.scriptURL === worker.url()) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));
  const version = [...versions.values()].find((item) => item.scriptURL === worker.url());
  assert.ok(version, 'service worker version must be observable');
  await workerCDP.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  const stoppedDeadline = Date.now() + 5_000;
  while (versions.get(version.versionId)?.runningStatus !== 'stopped' && Date.now() < stoppedDeadline) await new Promise((done) => setTimeout(done, 50));
  assert.equal(versions.get(version.versionId)?.runningStatus, 'stopped');
  const recovered = await send(workspace, { ...command, actionId: crypto.randomUUID(), expectedRevision: query.result.session.revision, text: '重复动作只保存一次' });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.session.revision, query.result.session.revision + 1);
  record('SC-02：CDP 确认后台 stopped 后，保存消息唤醒后台且原数据保留');

  // 2.3 刷新后读权威快照，再暂停与恢复，未接入任何模型。
  await workspace.reload(); await workspace.getByRole('textbox', { name: '你的思路与代码' }).waitFor();
  await workspace.getByRole('button', { name: '暂停练习', exact: true }).click();
  await workspace.getByRole('button', { name: '继续练习', exact: true }).waitFor();
  assert.equal(await workspace.getByRole('textbox', { name: '你的思路与代码' }).isDisabled(), true);
  await workspace.getByRole('button', { name: '继续练习', exact: true }).click(); await waitSaved(workspace);
  record('暂停保留输入，恢复后可继续');
  await context.close(); context = await openContext();
  workspace = await context.newPage(); await workspace.goto(workspaceUrl);
  await workspace.getByRole('textbox', { name: '你的思路与代码' }).waitFor();
  assert.equal(await workspace.getByRole('textbox', { name: '你的思路与代码' }).inputValue(), '重复动作只保存一次');
  assert.equal(await workspace.locator('.history li').count(), 2);
  record('SC-07：同一隔离配置重启浏览器后，草稿与尝试恢复');

  // 2.4 两个真实界面从同一版本编辑，冲突方保留本地文字。
  const secondEditor = await context.newPage(); await secondEditor.goto(`chrome-extension://${id}/sidepanel.html`);
  await secondEditor.getByRole('textbox', { name: '你的思路与代码' }).waitFor();
  await workspace.getByRole('textbox', { name: '你的思路与代码' }).fill('第一窗口已保存'); await waitSaved(workspace);
  await secondEditor.getByRole('textbox', { name: '你的思路与代码' }).fill('第二窗口未保存，必须保留');
  await secondEditor.getByText('另一窗口已经保存了新内容。', { exact: false }).waitFor();
  assert.equal(await secondEditor.getByRole('textbox', { name: '你的思路与代码' }).inputValue(), '第二窗口未保存，必须保留');
  await secondEditor.screenshot({ path: join(artifactDir, 'conflict.png'), fullPage: true });
  record('SC-05 UI：另一窗口保存后，本地冲突文本保留且显示恢复入口');
  await secondEditor.close();

  // 2.5 只在测试页面延迟已提交回执；生产包无故障注入开关。
  await workspace.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    let count = 0;
    chrome.runtime.sendMessage = async (command) => {
      if (command.type !== 'saveDraft') return original(command);
      count++;
      if (count === 1) {
        const committed = await original(command);
        return new Promise((done) => { window.releaseA = () => done(committed); });
      }
      if (count === 2) return new Promise((done) => { window.releaseB = async () => done(await original(command)); });
      return original(command);
    };
  });
  await workspace.getByRole('textbox', { name: '你的思路与代码' }).fill('A 已提交');
  await workspace.waitForFunction(() => !!window.releaseA);
  await workspace.getByRole('textbox', { name: '你的思路与代码' }).fill('B 仍在编辑');
  await workspace.evaluate(() => window.releaseA());
  await workspace.waitForFunction(() => !!window.releaseB);
  assert.equal(await workspace.locator('.save-status').textContent(), '正在保存');
  assert.equal((await send(workspace, { type: 'read' })).sessions[0].draft, 'A 已提交');
  await workspace.evaluate(() => window.releaseB()); await waitSaved(workspace);
  assert.equal((await send(workspace, { type: 'read' })).sessions[0].draft, 'B 仍在编辑');
  record('SC-11 UI：迟到 A 确认不会把 B 标为已保存，B 确认后才显示保存');
  await workspace.reload(); await workspace.getByRole('textbox', { name: '你的思路与代码' }).waitFor();
  await workspace.getByRole('button', { name: '寻找相邻差值', exact: false }).click();
  await workspace.getByRole('textbox', { name: '你的思路与代码' }).fill('这是 B 题的尝试'); await waitSaved(workspace);
  snapshot = await send(workspace, { type: 'read' });
  assert.equal(snapshot.sessions.find((session) => session.id === current.id).draft, 'B 仍在编辑');
  assert.equal(snapshot.sessions.find((session) => session.problemKey === 'pair').draft, '这是 B 题的尝试');
  record('SC-06 UI：切题前保存并等待，新旧题草稿分别归属');
  assert.deepEqual(evidence.errors, []);
  logger.info('浏览器验证完成');
} catch (error) {
  evidence.failure = error.stack;
  process.exitCode = 1;
  logger.error(error);
} finally {
  await context?.close();
  await writeFile(join(artifactDir, 'results.json'), JSON.stringify(evidence, null, 2));
}
