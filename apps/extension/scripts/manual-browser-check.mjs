import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, version as osVersion } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const logger = console;
const stable = process.argv.includes('--chrome');
const mode = stable ? 'chrome-stable' : 'chromium';
const extensionRoot = fileURLToPath(new URL('..', import.meta.url));
const extensionPath = join(extensionRoot, 'dist');
const artifactDir = join(extensionRoot, 'output/task04/manual-browser', mode);
const dbName = 'algorhythm-prototype-v1';
const tables = ['problems', 'sessions', 'events', 'actions'];
const contexts = new Set();
const evidence = { date: new Date().toISOString(), mode, os: osVersion(), results: [], errors: [], files: [], externalRequests: [], workerNetworkTargets: [], notes: [] };
await mkdir(artifactDir, { recursive: true });
let workspace;
const record = (id, name, simulated = false) => { evidence.results.push({ id, name, simulated }); logger.info('通过', id, name); };
const sortKeys = (value) => Array.isArray(value) ? value.map(sortKeys) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sortKeys(item)])) : value;
const isExternal = (url) => /^(https?|wss?):/i.test(url);
const editor = (page) => page.getByRole('textbox', { name: '你的思路与代码', exact: true });
const form = (page) => page.getByRole('form', { name: '记录自己的题目', exact: true });
async function waitSaved(page) { await page.locator('.save-status').filter({ hasText: /^已保存$/ }).waitFor(); }
async function send(page, input) {
  return page.evaluate((input) => chrome.runtime.sendMessage({ protocolVersion: 2, extensionId: chrome.runtime.id, actionId: crypto.randomUUID(), ...input }), input);
}
async function facts(page) {
  return page.evaluate(async ({ dbName, tables }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open(dbName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const transaction = db.transaction([...tables, 'backupImports'], 'readonly');
      return Object.fromEntries(await Promise.all([...tables, 'backupImports'].map((name) => new Promise((resolve, reject) => {
        const request = transaction.objectStore(name).getAll(); request.onsuccess = () => resolve([name, request.result]); request.onerror = () => reject(request.error);
      }))));
    } finally { db.close(); }
  }, { dbName, tables });
}
function comparable(data, extensionId) {
  const copy = structuredClone(data);
  for (const action of copy.actions) { const command = JSON.parse(action.fingerprint); command.extensionId = extensionId; action.fingerprint = JSON.stringify(sortKeys(command)); }
  for (const table of tables) copy[table].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return copy;
}
async function attachTarget(cdp, targetId, source) {
  // 1.1 侧栏与后台独立订阅CDP事件，不把HTML标签称作原生宿主。
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  let sequence = 0;
  const waiting = new Map();
  cdp.on('Target.receivedMessageFromTarget', (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.method === 'Network.requestWillBeSent' && isExternal(message.params.request.url)) evidence.externalRequests.push({ source, url: message.params.request.url });
    if (message.method === 'Network.webSocketCreated' && isExternal(message.params.url)) evidence.externalRequests.push({ source, url: message.params.url });
    const pending = waiting.get(message.id); if (!pending) return;
    waiting.delete(message.id); clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
  });
  async function command(method, params = {}) {
    const id = ++sequence;
    const result = new Promise((resolve, reject) => { const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10_000); waiting.set(id, { resolve, reject, timer }); });
    await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }); return result;
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    assert.equal(result.exceptionDetails, undefined, 'target expression must complete'); return result.result.value;
  }
  await command('Network.enable');
  return { command, evaluate, async waitFor(expression) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise((done) => setTimeout(done, 50)); }
    throw new Error(`Target condition failed: ${expression}`);
  } };
}
async function installOfficial(context, profile, path) {
  /*
   * ========================================================================
   * 步骤1：从官方页面在隔离Chrome配置加载
   * ========================================================================
   * 数据源：当前临时配置、生产dist与限定PID的目录选择器。
   * 操作：1) 不使用已移除的加载参数。2) helper严格核验路径及文件摘要。
   */
  logger.info('开始官方加载', { mode }); const page = await context.newPage();
  try {
    // 1.1 同一配置重启时保留已安装构建，不操作个人窗口。
    await page.goto('chrome://extensions');
    if (await page.locator('extensions-item').count() === 0) {
      if (!await page.locator('#devMode').evaluate((element) => element.checked)) await page.locator('#devMode').click();
      assert.equal(await page.locator('#devMode').evaluate((element) => element.checked), true);
      const choosing = page.waitForEvent('filechooser', { timeout: 3_000 }).catch(() => null);
      await page.locator('#loadUnpacked').click(); const chooser = await choosing;
      if (chooser) await chooser.setFiles(path);
      else await promisify(execFile)('pwsh.exe', ['-NoProfile', '-File', join(extensionRoot, 'scripts/backup-select-extension.ps1'), '-ProfilePath', profile, '-ExtensionPath', path], { timeout: 15_000, windowsHide: true });
      if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker', { timeout: 15_000 });
    }
    await page.screenshot({ path: join(artifactDir, `official-loader-${evidence.results.length}.png`), fullPage: true });
  } catch (error) {
    await page.screenshot({ path: join(artifactDir, 'official-loader-failure.png'), fullPage: true }).catch(() => undefined);
    if (error.stdout) evidence.loaderDiagnostic = error.stdout; throw error;
  } finally { await page.close(); logger.info('官方加载结束'); }
}
async function openContext(profile, path, knownId) {
  const options = { headless: !stable, chromiumSandbox: true, acceptDownloads: true, viewport: { width: 1360, height: 1000 } };
  if (stable) Object.assign(options, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', ignoreDefaultArgs: ['--disable-extensions'] });
  else Object.assign(options, { channel: 'chromium', args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`] });
  assert.equal(contexts.size, 0);
  const context = await chromium.launchPersistentContext(profile, options); contexts.add(context); context.setDefaultTimeout(12_000);
  context.on('request', (request) => { if (isExternal(request.url())) evidence.externalRequests.push({ source: request.serviceWorker() ? 'worker-context' : 'page-context', url: request.url() }); });
  context.on('page', (page) => { page.on('pageerror', (error) => evidence.errors.push(error.message)); page.on('websocket', (socket) => { if (isExternal(socket.url())) evidence.externalRequests.push({ source: 'page-websocket', url: socket.url() }); }); });
  if (stable) await installOfficial(context, profile, path);
  const worker = context.serviceWorkers()[0] ?? (knownId ? undefined : await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  const id = worker ? new URL(worker.url()).hostname : knownId; assert.ok(id); if (knownId) assert.equal(id, knownId);
  evidence.browserVersion = context.browser()?.version();
  const anchor = context.pages()[0] ?? await context.newPage(); const cdp = await context.newCDPSession(anchor); const attached = new Set();
  async function monitorWorkers() {
    for (const target of (await cdp.send('Target.getTargets')).targetInfos.filter((item) => item.type === 'service_worker' && item.url.startsWith(`chrome-extension://${id}/`))) {
      if (attached.has(target.targetId)) continue;
      await attachTarget(cdp, target.targetId, 'worker-cdp'); attached.add(target.targetId); evidence.workerNetworkTargets.push({ id, url: target.url });
    }
  }
  await monitorWorkers();
  return { context, id, profile, path, workerUrl: worker?.url() ?? `chrome-extension://${id}/background.js`, monitorWorkers };
}
async function closeContext(context) { if (context) { await context.close(); contexts.delete(context); } }
async function openWorkspace(installation, selectedId = '') {
  workspace = await installation.context.newPage(); await workspace.goto(`chrome-extension://${installation.id}/workspace.html${selectedId ? `#${selectedId}` : ''}`);
  await workspace.getByRole('button', { name: '记录自己的题目', exact: true }).waitFor(); await installation.monitorWorkers(); return workspace;
}
async function createManual(page, title, url = '', keyboard = false) {
  await page.getByRole('button', { name: '记录自己的题目', exact: true }).click(); await form(page).waitFor();
  if (keyboard) {
    await form(page).getByRole('textbox', { name: '题目标题', exact: true }).focus(); await page.keyboard.insertText(title);
    await page.keyboard.press('Tab'); await page.keyboard.insertText(url); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '保存并开始练习'); await page.keyboard.press('Enter');
  } else {
    await form(page).getByRole('textbox', { name: '题目标题', exact: true }).fill(title); await form(page).getByRole('textbox', { name: '原题链接（可选）', exact: true }).fill(url);
    await form(page).getByRole('button', { name: '保存并开始练习', exact: true }).click();
  }
  await form(page).waitFor({ state: 'detached' }); await editor(page).waitFor(); await waitSaved(page); assert.equal(await page.locator('.problem h1').textContent(), title.trim());
}
async function chooseBackup(page, backup, name = 'manual-backup.json') {
  await page.getByLabel('选择备份文件', { exact: true }).setInputFiles(typeof backup === 'string' ? backup : { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.getByRole('button', { name: '确认导入', exact: true }).waitFor();
}
async function confirmImport(page) {
  await page.getByRole('button', { name: '确认导入', exact: true }).click(); await page.locator('.backup-panel .notice').filter({ hasText: '导入成功' }).waitFor({ timeout: 35_000 });
}
async function downloadBackup(page, name) {
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '下载备份', exact: true }).click(); const download = await downloading;
  assert.match(download.suggestedFilename(), /^algorhythm-prototype-backup-.*\.json$/); const path = join(artifactDir, `${name}.json`);
  await download.saveAs(path); assert.equal(await download.failure(), null); const bytes = await readFile(path);
  evidence.files.push({ name: `${name}.json`, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }); return { path, backup: JSON.parse(bytes.toString('utf8')) };
}
async function nativePanel(installation, page) {
  await page.getByRole('button', { name: '打开练习侧栏', exact: true }).click();
  await page.waitForFunction(async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length === 1);
  const cdp = await installation.context.newCDPSession(installation.context.pages()[0]);
  const target = (await cdp.send('Target.getTargets')).targetInfos.find((item) => item.url === `chrome-extension://${installation.id}/sidepanel.html`); assert.ok(target);
  const panel = await attachTarget(cdp, target.targetId, 'native-panel-cdp'); await panel.waitFor('!!document.querySelector("textarea")');
  evidence.nativePanelContexts = await page.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })); assert.equal(evidence.nativePanelContexts[0].documentUrl, target.url); return panel;
}
async function panelEdit(panel, text) {
  await panel.evaluate(`(() => { const input = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await panel.waitFor(`document.querySelector('.save-status')?.textContent === '已保存' && document.querySelector('textarea')?.value === ${JSON.stringify(text)}`);
}
async function stopWorker(installation, page) {
  const cdp = await installation.context.newCDPSession(page); const versions = new Map();
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: updates }) => { for (const item of updates) versions.set(item.versionId, item); }); await cdp.send('ServiceWorker.enable'); const deadline = Date.now() + 10_000;
  while (![...versions.values()].some((item) => item.scriptURL === installation.workerUrl) && Date.now() < deadline) await page.waitForTimeout(50);
  const version = [...versions.values()].find((item) => item.scriptURL === installation.workerUrl); assert.ok(version);
  await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  while (versions.get(version.versionId)?.runningStatus !== 'stopped' && Date.now() < deadline) await page.waitForTimeout(50);
  assert.equal(versions.get(version.versionId)?.runningStatus, 'stopped'); await cdp.detach();
}
async function freshScenario(task) {
  const installation = await openContext(await mkdtemp(join(tmpdir(), 'algorhythm-backup-manual-boundary-')), extensionPath);
  try { await task(installation, await openWorkspace(installation)); } finally { await closeContext(installation.context); }
}

async function checkBoundaries() {
  /*
   * ========================================================================
   * 步骤5：验证隔离故障注入与真实事务反例
   * ========================================================================
   * 数据源：各自全新Chromium配置、生产UI及页面/worker限定注入。
   * 操作：1) 验证原动作恢复、flush和迟到隔离。2) 不修改生产包或权限。
   */
  logger.info('开始手动建题边界验证');
  await freshScenario(async (installation, page) => {
    // 5.1 不合法输入和键盘取消不得创建事实；共享schema拒绝未知字段。
    const before = await facts(page); await page.getByRole('button', { name: '记录自己的题目', exact: true }).click();
    await form(page).getByRole('button', { name: '保存并开始练习', exact: true }).click(); await form(page).getByRole('alert').waitFor();
    await form(page).getByRole('textbox', { name: '题目标题', exact: true }).fill('长'.repeat(201)); await form(page).getByRole('button', { name: '保存并开始练习', exact: true }).click(); await form(page).getByRole('alert').waitFor();
    await form(page).getByRole('textbox', { name: '题目标题', exact: true }).fill('保留输入');
    for (const url of ['http://leetcode.cn/problems/two-sum/', 'https://leetcode.cn.evil.test/problems/two-sum/', 'https://user@leetcode.cn/problems/two-sum/', 'https://leetcode.cn:444/problems/two-sum/', 'https://leetcode.cn/problems/%74wo-sum/', 'https://leetcode.cn/contest/']) {
      await form(page).getByRole('textbox', { name: '原题链接（可选）', exact: true }).fill(url); await form(page).getByRole('button', { name: '保存并开始练习', exact: true }).click(); await form(page).getByRole('alert').waitFor(); assert.deepEqual(await facts(page), before);
    }
    await form(page).getByRole('textbox', { name: '原题链接（可选）', exact: true }).focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '取消建题'); await page.keyboard.press('Enter'); await form(page).waitFor({ state: 'detached' }); assert.deepEqual(await facts(page), before);
    const rejected = await send(page, { type: 'startManual', sessionId: randomUUID(), problemSnapshotId: randomUUID(), title: '未知字段', url: null, source: 'manual-user-v1' });
    assert.equal(rejected.code, 'INVALID_COMMAND'); assert.deepEqual(await facts(page), before); record('MP-01/04/10', '空/超长标题、恶意URL及未知字段拒绝；键盘取消不写库');
    // 5.2 最后回执写入异常由worker限定注入，四表回滚由原生IndexedDB验证。
    const worker = installation.context.serviceWorkers()[0];
    await worker.evaluate(() => { const add = IDBObjectStore.prototype.add; IDBObjectStore.prototype.add = function (...args) { if (this.name === 'actions') throw new DOMException('Synthetic receipt failure', 'UnknownError'); return add.apply(this, args); }; });
    assert.equal((await send(page, { type: 'startManual', sessionId: randomUUID(), problemSnapshotId: randomUUID(), title: '事务回滚', url: null })).code, 'STORAGE_FAILED'); assert.deepEqual(await facts(page), before);
    record('MP-02', 'worker限定最后回执写入失败，真实IndexedDB事务四表回滚', true);
  });
  await freshScenario(async (_installation, page) => {
    // 5.3 当前草稿flush失败时，不生成新建题命令，原表单和输入仍可见。
    await createManual(page, 'flush前的旧练习');
    await page.evaluate(() => { const send = chrome.runtime.sendMessage.bind(chrome.runtime); window.__calls = []; chrome.runtime.sendMessage = async (command) => { window.__calls.push(command); if (command.type === 'saveDraft') return { ok: false, actionId: command.actionId, code: 'STORAGE_FAILED' }; return send(command); }; });
    const before = await facts(page); await editor(page).fill('不能丢失的当前输入'); await page.getByRole('button', { name: '记录自己的题目', exact: true }).click();
    await form(page).getByRole('textbox', { name: '题目标题', exact: true }).fill('不应创建'); await form(page).getByRole('button', { name: '保存并开始练习', exact: true }).click(); await page.getByRole('alert').filter({ hasText: '本地保存失败' }).first().waitFor();
    assert.equal(await form(page).getByRole('textbox', { name: '题目标题', exact: true }).inputValue(), '不应创建'); assert.equal(await editor(page).inputValue(), '不能丢失的当前输入');
    assert.equal(await page.evaluate(() => window.__calls.filter((item) => item.type === 'startManual').length), 0); assert.deepEqual(await facts(page), before);
    await page.screenshot({ path: join(artifactDir, 'manual-flush-failure.png'), fullPage: true }); record('MP-04', '模拟flush失败保留表单和草稿，未生成startManual命令', true);
  });
  await freshScenario(async (_installation, page) => {
    // 5.4 发送前丢失只自动查询；用户恢复时所有ID和原内容保持一致。
    await page.evaluate(() => { const send = chrome.runtime.sendMessage.bind(chrome.runtime); window.__calls = []; let failed = false; chrome.runtime.sendMessage = async (command) => { window.__calls.push(structuredClone(command)); if (command.type === 'startManual' && !failed) { failed = true; throw new Error('Synthetic lost before send'); } return send(command); }; });
    await page.getByRole('button', { name: '记录自己的题目', exact: true }).click(); await form(page).getByRole('textbox', { name: '题目标题', exact: true }).fill('未知结果保留原动作');
    await form(page).getByRole('button', { name: '保存并开始练习', exact: true }).click(); await page.getByRole('button', { name: '恢复上次操作', exact: true }).waitFor();
    assert.equal(await form(page).getByRole('button', { name: '取消建题', exact: true }).isDisabled(), true); assert.equal((await facts(page)).sessions.length, 0);
    const first = await page.evaluate(() => window.__calls.filter((item) => ['startManual', 'queryAction'].includes(item.type))); assert.deepEqual(first.map((item) => item.type), ['startManual', 'queryAction']);
    await page.getByRole('button', { name: '恢复上次操作', exact: true }).click(); await form(page).waitFor({ state: 'detached' }); await waitSaved(page);
    const calls = await page.evaluate(() => window.__calls.filter((item) => ['startManual', 'queryAction'].includes(item.type)));
    assert.deepEqual(calls.map((item) => item.type), ['startManual', 'queryAction', 'queryAction', 'startManual']); assert.deepEqual(calls[0], calls[3]); assert.equal((await facts(page)).sessions.length, 1);
    record('MP-04', '模拟发送前丢失：先查回执，手动恢复重用完整原命令和所有ID', true);
  });
  await freshScenario(async (_installation, page) => {
    // 5.5 已提交后丢ACK时，真实query找到原回执，不重发startManual。
    await page.evaluate(() => { const send = chrome.runtime.sendMessage.bind(chrome.runtime); window.__calls = []; chrome.runtime.sendMessage = async (command) => { window.__calls.push(structuredClone(command)); const response = await send(command); if (command.type === 'startManual') throw new Error('Synthetic committed ACK loss'); return response; }; });
    await createManual(page, '提交后丢ACK'); const calls = await page.evaluate(() => window.__calls.filter((item) => ['startManual', 'queryAction'].includes(item.type)));
    assert.deepEqual(calls.map((item) => item.type), ['startManual', 'queryAction']); assert.equal(calls[1].targetActionId, calls[0].actionId); assert.equal((await facts(page)).sessions.length, 1); assert.equal(await page.getByRole('button', { name: '恢复上次操作', exact: true }).count(), 0);
    record('MP-04', '模拟已提交ACK丢失：真实query确认，仅一次startManual且表单关闭', true);
  });
  await freshScenario(async (_installation, page) => {
    // 5.6 提交已确认后read失败不提供重复创建入口；恢复读取仍可见原会话。
    await page.evaluate(() => { const send = chrome.runtime.sendMessage.bind(chrome.runtime); let committed = false; window.__calls = []; window.__readFailure = true; chrome.runtime.sendMessage = async (command) => { window.__calls.push(structuredClone(command)); if (command.type === 'read' && committed && window.__readFailure) throw new Error('Synthetic post-commit read failure'); const response = await send(command); if (command.type === 'startManual' && response.ok) committed = true; return response; }; });
    await page.getByRole('button', { name: '记录自己的题目', exact: true }).click(); await form(page).getByRole('textbox', { name: '题目标题', exact: true }).fill('提交成功后读取失败'); await form(page).getByRole('button', { name: '保存并开始练习', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '记录已保存，但工作台记录更新失败' }).waitFor(); await form(page).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: '恢复上次操作', exact: true }).count(), 0); assert.equal((await facts(page)).sessions.length, 1); assert.equal(await page.getByRole('status').filter({ hasText: /^记录已保存。$/ }).count(), 1);
    await page.evaluate(() => { window.__readFailure = false; }); await page.getByRole('button', { name: '更新记录', exact: true }).click(); await editor(page).waitFor();
    assert.equal(await page.evaluate(() => window.__calls.filter((item) => item.type === 'startManual').length), 1); record('MP-04', '模拟提交后read失败保留成功提示、关闭表单，无恢复重建入口', true);
  });
  await freshScenario(async (_installation, page) => {
    // 5.7 迟到建题回执期间，快速双击仍只创建一个会话。
    await page.evaluate(() => { const send = chrome.runtime.sendMessage.bind(chrome.runtime); window.__calls = []; chrome.runtime.sendMessage = async (command) => { window.__calls.push(structuredClone(command)); const response = await send(command); if (command.type === 'startManual') return new Promise((done) => { window.__releaseStart = () => done(response); }); return response; }; });
    await page.getByRole('button', { name: '记录自己的题目', exact: true }).click(); await form(page).getByRole('textbox', { name: '题目标题', exact: true }).fill('双击只创建一次');
    await form(page).getByRole('button', { name: '保存并开始练习', exact: true }).evaluate((button) => { button.click(); button.click(); }); await page.waitForFunction(() => typeof window.__releaseStart === 'function');
    assert.equal((await facts(page)).sessions.length, 1); assert.equal(await form(page).getByRole('button', { name: '保存并开始练习', exact: true }).isDisabled(), true); assert.equal(await page.evaluate(() => window.__calls.filter((item) => item.type === 'startManual').length), 1);
    await page.evaluate(() => window.__releaseStart()); await form(page).waitFor({ state: 'detached' }); await waitSaved(page); record('MP-02/04', '模拟迟到建题回执并快速双击：一条命令和一个会话，期间禁止重复建题', true);
  });
  await freshScenario(async (installation, page) => {
    // 5.8 A/B编辑代次与新会话切换必须等待各自确认，不能串写草稿。
    await createManual(page, '迟到草稿的原题'); const firstId = (await facts(page)).sessions[0].id;
    await page.evaluate(() => { const send = chrome.runtime.sendMessage.bind(chrome.runtime); let count = 0; window.__calls = []; chrome.runtime.sendMessage = async (command) => { window.__calls.push(command); if (command.type !== 'saveDraft') return send(command); count++; if (count === 1) { const response = await send(command); return new Promise((done) => { window.__releaseA = () => done(response); }); } if (count === 2) return new Promise((done) => { window.__releaseB = async () => done(await send(command)); }); return send(command); }; });
    await editor(page).fill('A已提交'); await page.waitForFunction(() => typeof window.__releaseA === 'function'); await editor(page).fill('B仍在编辑'); await page.evaluate(() => window.__releaseA()); await page.waitForFunction(() => typeof window.__releaseB === 'function'); assert.equal(await page.locator('.save-status').textContent(), '正在保存');
    await page.getByRole('button', { name: '记录自己的题目', exact: true }).click(); await form(page).getByRole('textbox', { name: '题目标题', exact: true }).fill('确认B后才切题'); await form(page).getByRole('button', { name: '保存并开始练习', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__calls.filter((item) => item.type === 'startManual').length), 0); assert.equal((await facts(page)).sessions[0].draft, 'A已提交'); await page.evaluate(() => window.__releaseB()); await form(page).waitFor({ state: 'detached' }); await waitSaved(page);
    assert.equal(await editor(page).inputValue(), ''); assert.equal((await facts(page)).sessions.find((item) => item.id === firstId).draft, 'B仍在编辑'); await page.locator('.sessions button').filter({ hasText: '迟到草稿的原题' }).click(); await waitSaved(page); assert.equal(await editor(page).inputValue(), 'B仍在编辑');
    record('MP-04', '模拟A/B迟到确认：B确认前不建新题，新旧草稿归属隔离', true);
    // 5.9 两个真实页面的revision冲突保留冲突方本地输入。
    await page.reload(); await editor(page).waitFor(); const second = await installation.context.newPage(); await second.goto(page.url()); await editor(second).waitFor(); await editor(page).fill('第一窗口已确认'); await waitSaved(page); await editor(second).fill('第二窗口保留输入');
    await second.getByRole('alert').filter({ hasText: '另一窗口已经保存' }).waitFor(); assert.equal(await editor(second).inputValue(), '第二窗口保留输入'); await second.screenshot({ path: join(artifactDir, 'manual-conflict.png'), fullPage: true }); await second.close(); record('MP-04/10', '手动会话真实双页面revision冲突，冲突方保留本地文本');
  });
  await freshScenario(async (_installation, page) => {
    // 5.10 受控旧页面信封由真实v2后台拒绝，不能把不兼容显示为空库。
    assert.equal((await send(page, { type: 'read', protocolVersion: 1 })).code, 'PROTOCOL_MISMATCH');
    await page.addInitScript(() => { const send = chrome.runtime.sendMessage.bind(chrome.runtime); chrome.runtime.sendMessage = (command) => send({ ...command, protocolVersion: 1 }); });
    await page.reload(); await page.getByRole('alert').filter({ hasText: '页面和后台版本不一致，请重新打开扩展' }).waitFor(); assert.equal(await page.getByText('还没有练习记录。', { exact: true }).count(), 0); record('MP-06', '受控旧页面信封被真实v2后台拒绝，UI提示重开且不显示空库', true);
  });
  logger.info('手动建题边界验证结束');
}

try {
  /*
   * ========================================================================
   * 步骤2：从冻结v1记录验证手动建题和真实持久化
   * ========================================================================
   * 数据源：生产dist、冻结v1文件、独立临时配置与真实IndexedDB。
   * 操作：1) 保留旧指纹和回执。2) 有无链接均用真实表单建题，不访问原题。
   */
  logger.info('开始手动记录真实闭环', { mode });
  // 2.1 清单只更新已授权版本与说明；权限不得变化。
  const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '0.2.0'); assert.deepEqual(manifest.permissions, ['sidePanel']);
  for (const key of ['host_permissions', 'content_scripts', 'externally_connectable', 'web_accessible_resources']) assert.equal(manifest[key], undefined);
  const sourceProfile = await mkdtemp(join(tmpdir(), 'algorhythm-backup-manual-source-'));
  let source = await openContext(sourceProfile, extensionPath); let page = await openWorkspace(source); evidence.sourceExtensionId = source.id;
  const fixture = JSON.parse(await readFile(join(extensionRoot, 'tests/fixtures/backup-v1.json'), 'utf8'));
  await chooseBackup(page, fixture, 'frozen-v1.json'); await confirmImport(page);
  const legacy = await facts(page);
  for (const action of legacy.actions) {
    const original = fixture.data.actions.find((item) => item.id === action.id); assert.equal(JSON.parse(action.fingerprint).protocolVersion, 1);
    assert.deepEqual({ ...JSON.parse(action.fingerprint), extensionId: fixture.source.extensionId }, JSON.parse(original.fingerprint));
    assert.deepEqual((await send(page, { type: 'queryAction', targetActionId: action.id })).result, original.result);
  }
  record('MP-06/07', '冻结v1文件真实导入；原v1指纹保留，在线v2查询返回旧回执');
  await createManual(page, '  本地原创练习  ', '', true);
  assert.equal(await page.getByRole('link', { name: '打开原题', exact: true }).count(), 0); await editor(page).fill('原创练习也能保存。'); await waitSaved(page);
  record('MP-01/10', '键盘完成无链接建题，标题去除首尾空白，本地草稿保存');
  const title = '<img src=x onerror=alert(1)> 我的数组练习'; const url = 'https://leetcode.cn/problems/two-sum/description/?x=1#part';
  await createManual(page, title, url);
  const link = page.getByRole('link', { name: '打开原题', exact: true });
  assert.equal(await link.getAttribute('href'), 'https://leetcode.cn/problems/two-sum/'); assert.equal(await link.getAttribute('target'), '_blank'); assert.deepEqual((await link.getAttribute('rel')).split(' ').sort(), ['noopener', 'noreferrer']);
  assert.equal(await page.locator('.problem img').count(), 0); assert.equal(await page.getByText('用户手动记录，未读取原题', { exact: true }).count(), 1);
  await editor(page).fill('def solve(nums):\n    return "<b>只是文本</b>"'); await waitSaved(page);
  await page.getByRole('button', { name: '记录这次尝试', exact: true }).click(); await page.locator('.history li').waitFor();
  const sourceFacts = await facts(page); const manualProblem = sourceFacts.problems.find((item) => item.title === title); const selected = sourceFacts.sessions.find((item) => item.problemSnapshotId === manualProblem.id); evidence.manualSessionId = selected.id;
  assert.equal(manualProblem.source, 'manual-user-v1'); assert.equal(manualProblem.statement, ''); assert.ok(sourceFacts.events.filter((item) => item.sessionId === selected.id).every((item) => item.source === 'manual-workspace'));
  record('MP-01/02/05', '链接本地规范化；HTML标题和笔记纯文本；手动来源、快照与事件一致');
  // 2.2 相同链接再次建独立会话，然后明确选回原会话。
  await createManual(page, '相同链接的另一次练习', url); const duplicated = await facts(page); assert.equal(duplicated.problems.filter((item) => item.url === manualProblem.url).length, 2);
  await page.locator('.sessions button').filter({ hasText: title }).click(); await waitSaved(page); assert.equal(await editor(page).inputValue(), selected.draft);
  await editor(page).fill('# 打开侧栏前确认原会话'); await waitSaved(page);
  record('MP-05', '同链接建立不同会话，原草稿和尝试互不覆盖'); await page.screenshot({ path: join(artifactDir, 'workspace-manual.png'), fullPage: true });
  logger.info('手动记录真实闭环结束');

  /*
   * ========================================================================
   * 步骤3：原生侧栏在主页面关闭及后台重启后续写
   * ========================================================================
   * 数据源：真实SIDE_PANEL、ServiceWorker状态与同一独立浏览器配置。
   * 操作：1) 关闭工作台后保存和记录尝试。2) 后台停止和浏览器重开后核对。
   */
  logger.info('开始原生侧栏与重启验证');
  const panel = await nativePanel(source, page); assert.equal(await panel.evaluate('document.querySelector(".problem h1").textContent'), title);
  assert.equal(await panel.evaluate('document.querySelector(".manual-problem-form") === null && !Array.from(document.querySelectorAll("button")).some(item => item.textContent === "记录自己的题目")'), true);
  await page.close(); await panelEdit(panel, '# 工作台关闭后，在原生侧栏续写'); await panel.evaluate('document.querySelector(".editor button.primary").click()'); await panel.waitFor('document.querySelectorAll(".history li").length === 2');
  const capture = await panel.command('Page.captureScreenshot'); await writeFile(join(artifactDir, 'native-panel.png'), Buffer.from(capture.data, 'base64'));
  page = await openWorkspace(source, selected.id); assert.equal(await editor(page).inputValue(), '# 工作台关闭后，在原生侧栏续写');
  await stopWorker(source, page); await editor(page).fill('# 后台真实停止后续写'); await waitSaved(page); await source.monitorWorkers();
  assert.equal((await facts(page)).sessions.find((item) => item.id === selected.id).draft, '# 后台真实停止后续写');
  await page.getByRole('button', { name: '暂停练习', exact: true }).click(); await page.getByRole('button', { name: '继续练习', exact: true }).waitFor(); await page.getByRole('button', { name: '继续练习', exact: true }).click(); await waitSaved(page);
  await closeContext(source.context); source = await openContext(sourceProfile, extensionPath, source.id); page = await openWorkspace(source, selected.id);
  await editor(page).waitFor(); assert.equal(await editor(page).inputValue(), '# 后台真实停止后续写'); assert.equal(await page.locator('.history li').count(), 2);
  record('MP-03/10', '原生侧栏在工作台关闭后保存；真实worker停启、暂停恢复与浏览器重启均保留');
  // 3.1 窄屏侧栏页面布局和原生宿主持久化证据分别报告。
  const narrow = await source.context.newPage(); await narrow.goto(`chrome-extension://${source.id}/sidepanel.html#${selected.id}`); await editor(narrow).waitFor(); await narrow.setViewportSize({ width: 360, height: 900 });
  assert.ok(await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await editor(narrow).focus(); await narrow.keyboard.press('Tab'); assert.equal(await narrow.evaluate(() => document.activeElement.textContent), '记录这次尝试');
  await narrow.screenshot({ path: join(artifactDir, 'manual-panel-360.png'), fullPage: true }); await narrow.close(); record('MP-10', '360px侧栏页面无横向溢出，编辑器键盘进入尝试按钮');
  logger.info('原生侧栏与重启验证结束');

  /*
   * ========================================================================
   * 步骤4：真实下载并在不同扩展ID的空配置中恢复
   * ========================================================================
   * 数据源：按钮实际下载的混合v2文件与生产构建原样副本。
   * 操作：1) 比较四表、来源、URL及两版指纹。2) 续写后重导不得回退。
   */
  logger.info('开始手动记录备份恢复');
  await editor(page).fill('# 下载前立即输入，必须先flush'); const original = await downloadBackup(page, 'manual-source-backup');
  assert.equal(original.backup.formatVersion, 2); assert.equal(original.backup.scope, 'practice-records-v2'); assert.equal(original.backup.data.sessions.find((item) => item.id === selected.id).draft, '# 下载前立即输入，必须先flush');
  assert.ok(original.backup.data.actions.some((item) => JSON.parse(item.fingerprint).protocolVersion === 1)); assert.ok(original.backup.data.actions.some((item) => JSON.parse(item.fingerprint).protocolVersion === 2)); assert.deepEqual(Object.keys(original.backup.data).sort(), [...tables].sort());
  await closeContext(source.context);
  const targetPath = await mkdtemp(join(tmpdir(), 'algorhythm-backup-manual-build-')); await cp(extensionPath, targetPath, { recursive: true }); const targetProfile = await mkdtemp(join(tmpdir(), 'algorhythm-backup-manual-target-'));
  let target = await openContext(targetProfile, targetPath); page = await openWorkspace(target); evidence.targetExtensionId = target.id;
  assert.notEqual(target.id, source.id); assert.ok(Object.values(await facts(page)).every((rows) => rows.length === 0)); await chooseBackup(page, original.path); await confirmImport(page);
  const restored = await facts(page); assert.deepEqual(comparable(Object.fromEntries(tables.map((table) => [table, restored[table]])), source.id), comparable(original.backup.data, source.id));
  for (const action of restored.actions) assert.deepEqual((await send(page, { type: 'queryAction', targetActionId: action.id })).result, action.result);
  await page.locator('.sessions button').filter({ hasText: title }).click(); await waitSaved(page); assert.equal(await page.getByRole('link', { name: '打开原题', exact: true }).getAttribute('href'), manualProblem.url);
  const continued = '# 空配置恢复后继续练习，重导不能回退'; await editor(page).fill(continued); await waitSaved(page); await page.getByRole('button', { name: '记录这次尝试', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.history li').length === 3);
  const beforeReimport = await facts(page); await chooseBackup(page, original.path); await confirmImport(page); assert.deepEqual(await facts(page), beforeReimport); assert.equal(await editor(page).inputValue(), continued);
  const roundTrip = await downloadBackup(page, 'manual-target-continued'); assert.equal(roundTrip.backup.data.sessions.find((item) => item.id === selected.id).draft, continued);
  record('MP-07/09/10', '实际v2下载在另一空配置跨ID恢复；四表及v1/v2指纹一致，续练后重导不回退');
  // 4.1 矛盾来源、关系和未来格式只预览拒绝，五表不变。
  const invalids = [
    ['future', (backup) => { backup.formatVersion = 3; }], ['scope', (backup) => { backup.scope = 'prototype-storage-v1'; }],
    ['source', (backup) => { backup.data.problems.find((item) => item.key === 'manual').source = 'synthetic-v1'; }],
    ['title', (backup) => { backup.data.problems.find((item) => item.key === 'manual').title = '与原动作不同'; }],
    ['event', (backup) => { backup.data.events.find((item) => item.source === 'manual-workspace').source = 'synthetic-workspace'; }],
    ['orphan', (backup) => { backup.data.sessions[0].problemSnapshotId = randomUUID(); }],
  ];
  for (const [name, mutate] of invalids) {
    const backup = structuredClone(original.backup); backup.backupId = randomUUID(); mutate(backup);
    await page.getByLabel('选择备份文件', { exact: true }).setInputFiles({ name: `${name}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }); await page.locator('.backup-panel [role=alert]').waitFor();
    assert.deepEqual(await facts(page), beforeReimport); assert.equal(await page.getByRole('button', { name: '确认导入', exact: true }).count(), 0);
  }
  record('MP-08', '本地预览拒绝未来版本、scope错配、来源/标题/事件矛盾及无主引用，五表不变'); await page.screenshot({ path: join(artifactDir, 'target-manual-restored.png'), fullPage: true });
  await closeContext(target.context); target = await openContext(targetProfile, targetPath, target.id); page = await openWorkspace(target, selected.id); assert.equal(await editor(page).inputValue(), continued); assert.deepEqual(await facts(page), beforeReimport); await closeContext(target.context);
  record('MP-03/07', '恢复目标配置再次完整重启后，续写、尝试与导入回执保留'); logger.info('手动记录备份恢复结束');

  if (!stable) await checkBoundaries();
  evidence.notes.push('真实IndexedDB、原生SIDE_PANEL、CDP确认后台停止、浏览器完整重启、按钮下载及跨独立配置恢复分别断言。');
  evidence.notes.push('页面传输、草稿迟到与worker回执写入故障为限定测试注入，生产包没有故障入口。未测真实配额耗尽、事务中途终止浏览器、旧v1二进制或完整浏览器支持矩阵。');
  evidence.notes.push('errors仅统计Playwright页面pageerror，不覆盖原生侧栏或worker全部Runtime异常。网络仅覆盖监听窗口，worker CDP挂接前及重启后重新挂接前不在该窗口内。');
  assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.externalRequests, []); assert.ok(evidence.workerNetworkTargets.length > 0);
  record('MP-05/09', '监听期间未观察到生产扩展页面及worker的HTTP/HTTPS/WebSocket请求；未访问原题或新增权限');
} catch (error) {
  evidence.failure = error.stack; process.exitCode = 1; logger.error('手动练习浏览器检查失败', error.message); await workspace?.screenshot({ path: join(artifactDir, 'failure.png'), fullPage: true }).catch(() => undefined);
} finally {
  for (const context of [...contexts]) await closeContext(context).catch(() => undefined);
  await writeFile(join(artifactDir, 'results.json'), JSON.stringify(evidence, null, 2)); logger.info('手动练习浏览器检查结束');
}
