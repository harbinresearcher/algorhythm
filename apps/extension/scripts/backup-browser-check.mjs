import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, version as osVersion } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const logger = console;
const stable = process.argv.includes('--chrome');
const mode = stable ? 'chrome-stable' : 'chromium';
const extensionRoot = fileURLToPath(new URL('..', import.meta.url));
const extensionPath = join(extensionRoot, 'dist');
const artifactDir = join(extensionRoot, 'output/task02/backup-browser', mode);
const dbName = 'algorhythm-prototype-v1';
const tables = ['problems', 'sessions', 'events', 'actions'];
const contexts = new Set();
const evidence = { date: new Date().toISOString(), mode, os: osVersion(), results: [], errors: [], files: [], notes: [] };
await mkdir(artifactDir, { recursive: true });
let workspace;
let webServer;
const record = (id, name, detail) => { evidence.results.push({ id, name, ...(detail ? { detail } : {}) }); logger.info('通过', id, name); };
const sortKeys = (value) => Array.isArray(value) ? value.map(sortKeys) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sortKeys(item)])) : value;
function digestBackup(backup) {
  const data = Object.fromEntries(tables.map((table) => [table, [...backup.data[table]].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)]));
  return createHash('sha256').update(JSON.stringify(sortKeys({ ...backup, data }))).digest('hex');
}
function comparableData(data, extensionId) {
  const copy = structuredClone(data);
  for (const action of copy.actions) { const command = JSON.parse(action.fingerprint); command.extensionId = extensionId; action.fingerprint = JSON.stringify(sortKeys(command)); }
  for (const table of tables) copy[table].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return copy;
}
async function send(page, fields) {
  return page.evaluate((input) => chrome.runtime.sendMessage({ protocolVersion: 1, extensionId: chrome.runtime.id, actionId: crypto.randomUUID(), ...input }), fields);
}
async function waitSaved(page) { await page.locator('.save-status').filter({ hasText: /^已保存$/ }).waitFor(); }
async function closeContext(context) { if (context) { await context.close(); contexts.delete(context); } }
async function openContext(profile, path, knownExtensionId) {
  /*
   * ========================================================================
   * 步骤1：打开隔离配置并加载生产构建
   * ========================================================================
   * 数据源：当前 dist 的原样副本与本脚本创建的临时配置。
   * 操作：1) Chromium 使用扩展测试加载方式。2) 稳定版使用官方页面和限定窗口的目录选择器。
   */
  logger.info('开始加载测试扩展', { mode });
  try {
    // 1.1 一次只保留一个本任务浏览器，稳定版不使用已移除的加载参数。
    assert.equal(contexts.size, 0);
    const options = { headless: !stable, chromiumSandbox: true, acceptDownloads: true, viewport: { width: 1360, height: 1000 } };
    if (stable) Object.assign(options, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', ignoreDefaultArgs: ['--disable-extensions'] });
    else Object.assign(options, { channel: 'chromium', args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`] });
    const context = await chromium.launchPersistentContext(profile, options);
    contexts.add(context);
    evidence.browserVersion = context.browser()?.version();
    context.on('page', (page) => page.on('pageerror', (error) => evidence.errors.push(error.message)));
    // 1.2 官方页面及原生选择器只处理当前测试配置，不读取个人登录档案。
    if (stable) await installOfficial(context, profile, path);
    // 稳定版重开已安装配置时 worker 可以休眠，工作台会唤醒它；只复用此前同配置核实的 ID。
    const worker = context.serviceWorkers()[0] ?? (knownExtensionId ? undefined : await context.waitForEvent('serviceworker', { timeout: 15_000 }));
    const extensionId = worker ? new URL(worker.url()).hostname : knownExtensionId;
    if (knownExtensionId) assert.equal(extensionId, knownExtensionId);
    evidence.browserVersion = context.browser()?.version();
    return { context, worker, id: extensionId, profile, path };
  } finally { logger.info('加载测试扩展结束'); }
}
async function installOfficial(context, profile, path) {
  /*
   * ========================================================================
   * 步骤2：从官方扩展页面安装测试构建
   * ========================================================================
   * 数据源：当前临时配置与生产 manifest。
   * 操作：1) 开启测试配置的开发者模式。2) UI Automation 严格匹配该配置所属窗口。
   */
  logger.info('开始官方页面加载');
  const installation = await context.newPage();
  try {
    // 2.1 重开相同配置时沿用已安装构建，不重复安装或修改系统设置。
    await installation.goto('chrome://extensions');
    if (await installation.locator('extensions-item').count() === 0) {
      const toggle = installation.locator('#devMode');
      if (!await toggle.evaluate((element) => element.checked)) await toggle.click();
      assert.equal(await toggle.evaluate((element) => element.checked), true);
      const event = installation.waitForEvent('filechooser', { timeout: 3_000 }).catch(() => null);
      await installation.locator('#loadUnpacked').click();
      const chooser = await event;
      // 2.2 原生选择器不产生 filechooser 时，调用限定测试窗口的 pwsh7 helper。
      if (chooser) await chooser.setFiles(path);
      else await promisify(execFile)('pwsh.exe', ['-NoProfile', '-File', join(extensionRoot, 'scripts/backup-select-extension.ps1'), '-ProfilePath', profile, '-ExtensionPath', path], { timeout: 15_000, windowsHide: true });
      if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker', { timeout: 15_000 });
    }
    await installation.screenshot({ path: join(artifactDir, `official-loader-${evidence.results.length}.png`), fullPage: true });
  } catch (error) {
    await installation.screenshot({ path: join(artifactDir, 'official-loader-failure.png'), fullPage: true }).catch(() => undefined);
    if (error.stdout) evidence.loaderDiagnostic = error.stdout;
    throw error;
  } finally { await installation.close(); logger.info('官方页面加载结束'); }
}
async function openWorkspace(installation) {
  const page = await installation.context.newPage();
  await page.goto(`chrome-extension://${installation.id}/workspace.html`);
  // UI RED 必须先停在该入口，不提前检查数据库版本。
  await page.getByRole('heading', { name: '备份与恢复', exact: true }).waitFor({ timeout: 10_000 });
  return page;
}
async function rawRead(target, names) {
  return target.evaluate(async ({ dbName, names }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open(dbName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const transaction = db.transaction(names, 'readonly');
      const data = Object.fromEntries(await Promise.all(names.map((name) => new Promise((resolve, reject) => {
        const request = transaction.objectStore(name).getAll(); request.onsuccess = () => resolve([name, request.result]); request.onerror = () => reject(request.error);
      }))));
      return { nativeVersion: db.version, storeNames: Array.from(db.objectStoreNames), data };
    } finally { db.close(); }
  }, { dbName, names });
}
async function facts(target) { return (await rawRead(target, [...tables, 'backupImports'])).data; }
async function downloadBackup(page, name) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载备份', exact: true }).click();
  const download = await downloading;
  assert.match(download.suggestedFilename(), /^algorhythm-prototype-backup-.*\.json$/);
  const path = join(artifactDir, `${name}.json`);
  await download.saveAs(path);
  assert.equal(await download.failure(), null);
  const content = await readFile(path);
  assert.ok(content.byteLength <= 10 * 1024 * 1024);
  evidence.files.push({ name: `${name}.json`, bytes: content.byteLength, sha256: createHash('sha256').update(content).digest('hex') });
  return { path, backup: JSON.parse(content.toString('utf8')) };
}
const region = (page) => page.getByRole('region', { name: '备份与恢复', exact: true });
async function chooseBackup(page, backup) {
  const file = typeof backup === 'string' ? backup : { name: 'synthetic-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) };
  await page.getByLabel('选择备份文件', { exact: true }).setInputFiles(file);
  await page.getByRole('button', { name: '确认导入', exact: true }).waitFor();
}
async function confirmImport(page) {
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await region(page).getByRole('status').filter({ hasText: '导入成功。仅补入缺失记录，相同记录已跳过。' }).waitFor({ timeout: 35_000 });
}
function independentData(data, preservedIds = []) {
  const preserve = new Set(preservedIds);
  const mapping = new Map([...new Set(tables.flatMap((table) => data[table].map((row) => row.id)))].filter((id) => !preserve.has(id)).map((id) => [id, randomUUID()]));
  const rewrite = (value) => typeof value === 'string' ? mapping.get(value) ?? value : Array.isArray(value) ? value.map(rewrite)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)])) : value;
  const copy = rewrite(data);
  for (const action of copy.actions) action.fingerprint = JSON.stringify(rewrite(JSON.parse(action.fingerprint)));
  return copy;
}
async function attachNativePanel(context, page) {
  await page.getByRole('button', { name: '打开练习侧栏', exact: true }).click();
  const cdp = await context.newCDPSession(page);
  await page.waitForFunction(async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length === 1);
  const panel = (await cdp.send('Target.getTargets')).targetInfos.find((target) => target.url.endsWith('/sidepanel.html'));
  assert.ok(panel, 'native SIDE_PANEL target must exist');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: panel.targetId, flatten: false });
  let sequence = 0;
  const waiting = new Map();
  cdp.on('Target.receivedMessageFromTarget', (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message); const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id); clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
  });
  return async (expression) => {
    const id = ++sequence;
    const pending = new Promise((resolve, reject) => { const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Native panel timeout')); }, 10_000); waiting.set(id, { resolve, reject, timer }); });
    await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true, userGesture: true } }) });
    const result = await pending;
    assert.equal(result.exceptionDetails, undefined, 'native panel expression must complete');
    return result.result.value;
  };
}
async function stopWorker(context, page, url) {
  const cdp = await context.newCDPSession(page); const versions = new Map();
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions: updates }) => { for (const item of updates) versions.set(item.versionId, item); });
  await cdp.send('ServiceWorker.enable');
  const deadline = Date.now() + 10_000;
  while (![...versions.values()].some((item) => item.scriptURL === url) && Date.now() < deadline) await page.waitForTimeout(50);
  const version = [...versions.values()].find((item) => item.scriptURL === url);
  assert.ok(version, 'real service worker version must be observable');
  await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  while (versions.get(version.versionId)?.runningStatus !== 'stopped' && Date.now() < deadline) await page.waitForTimeout(50);
  assert.equal(versions.get(version.versionId)?.runningStatus, 'stopped');
  await cdp.detach();
}
async function verifySources(installation, page, backup) {
  /*
   * ========================================================================
   * 步骤4：核对原生侧栏、网页和子框架隔离
   * ========================================================================
   * 数据源：真实 SIDE_PANEL、无扩展权限的本机网页和生产 manifest。
   * 操作：1) 侧栏拒绝备份但仍能保存。2) 网页与 iframe 不能取得工作台权限。
   */
  logger.info('开始浏览器来源隔离验证');
  try {
    // 4.1 原生宿主不冒充普通标签页；三个管理消息全部受限。
    const evaluate = await attachNativePanel(installation.context, page);
    for (const fields of [{ type: 'backup.export' }, { type: 'backup.import', backup, expectedDigest: digestBackup(backup) }, { type: 'backup.query', backupId: backup.backupId, expectedDigest: digestBackup(backup) }]) {
      const result = await evaluate(`chrome.runtime.sendMessage({ protocolVersion: 1, extensionId: chrome.runtime.id, actionId: crypto.randomUUID(), ...${JSON.stringify(fields)} })`);
      assert.equal(result.code, 'FORBIDDEN');
    }
    assert.equal(await evaluate('document.querySelector("input[type=file]") === null'), true);
    const current = await evaluate('chrome.runtime.sendMessage({ protocolVersion: 1, extensionId: chrome.runtime.id, actionId: crypto.randomUUID(), type: "read" })');
    const active = current.sessions.find((session) => session.status === 'active'); assert.ok(active);
    const saved = await evaluate(`chrome.runtime.sendMessage({ protocolVersion: 1, extensionId: chrome.runtime.id, actionId: crypto.randomUUID(), type: 'saveDraft', sessionId: '${active.id}', problemSnapshotId: '${active.problemSnapshotId}', expectedRevision: ${active.revision}, text: '原生侧栏隔离后仍可保存' })`);
    assert.equal(saved.ok, true);
    record('BK-11', '原生 SIDE_PANEL 拒绝三个备份消息，学习保存仍可用');
    // 4.2 本机普通网页和生产 CSP 提供真实隔离证据，不增加产品权限。
    webServer = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Isolated permission probe</title><main>Local synthetic origin</main>'); });
    await new Promise((done) => webServer.listen(0, '127.0.0.1', done));
    logger.info('开始普通网页权限验证');
    const ordinary = await installation.context.newPage(); await ordinary.goto(`http://127.0.0.1:${webServer.address().port}`);
    const denied = await ordinary.evaluate(async (extensionId) => {
      if (!globalThis.chrome?.runtime?.sendMessage) return { response: null };
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ response: null, timedOut: true }), 5_000);
        chrome.runtime.sendMessage(extensionId, { type: 'backup.export' }, (response) => { clearTimeout(timer); resolve({ response: response ?? null, error: chrome.runtime.lastError?.message }); });
      });
    }, installation.id);
    assert.notEqual(denied.response?.ok, true);
    assert.notEqual(denied.timedOut, true, 'ordinary-page denial must be observable rather than assumed from timeout');
    await ordinary.evaluate((url) => { const frame = document.createElement('iframe'); frame.src = url; document.body.append(frame); }, page.url());
    await ordinary.waitForTimeout(300);
    assert.equal(await ordinary.evaluate(() => { try { return !!document.querySelector('iframe').contentWindow.chrome?.runtime?.id; } catch { return false; } }), false);
    await ordinary.close(); webServer.closeAllConnections(); await new Promise((done) => webServer.close(done)); webServer = undefined;
    logger.info('普通网页权限验证结束');
    const before = await facts(page);
    await page.evaluate((url) => { const frame = document.createElement('iframe'); frame.id = 'synthetic-frame-probe'; frame.src = url; document.body.append(frame); }, page.url());
    await page.waitForTimeout(300);
    const child = page.frames().find((frame) => frame.parentFrame() === page.mainFrame() && frame.url() === page.url());
    if (child) {
      // 实测允许装载的扩展子框架仍须由 browser sender.frameId 拒绝管理请求。
      for (const fields of [{ type: 'backup.export' }, { type: 'backup.import', backup, expectedDigest: digestBackup(backup) }, { type: 'backup.query', backupId: backup.backupId, expectedDigest: digestBackup(backup) }]) {
        assert.equal((await send(child, fields)).code, 'FORBIDDEN');
      }
    } else assert.equal(await page.evaluate(() => { const frame = document.getElementById('synthetic-frame-probe'); try { return !!frame.contentDocument?.querySelector('#backup-title'); } catch { return false; } }), false);
    await page.evaluate(() => document.getElementById('synthetic-frame-probe').remove());
    assert.deepEqual(await facts(page), before);
    record('BK-11', '普通网页无备份授权，工作台子框架不能发送管理消息', child ? '实际装载子框架的三个备份消息均收到 FORBIDDEN，五表不变' : '子框架被装载策略阻断');
  } finally { logger.info('浏览器来源隔离验证结束'); }
}

try {
  /*
   * ========================================================================
   * 步骤3：从真实编辑流程下载合成备份
   * ========================================================================
   * 数据源：生产 UI、两道合成题、已保存草稿和尝试。
   * 操作：1) 建立 active/paused 历史。2) 实际下载文件并保留学习文本。
   */
  logger.info('开始下载闭环');
  const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions, ['sidePanel']);
  for (const key of ['host_permissions', 'externally_connectable', 'web_accessible_resources']) assert.equal(manifest[key], undefined);
  assert.match(manifest.content_security_policy.extension_pages, /frame-src 'none'/);
  // 3.1 先检查 UI 入口，不能让数据库版本遮住旧构建的预期失败。
  const source = await openContext(await mkdtemp(join(tmpdir(), 'algorhythm-backup-source-')), extensionPath);
  workspace = await openWorkspace(source); evidence.sourceExtensionId = source.id;
  await workspace.getByRole('button', { name: '找出重复编号', exact: false }).click();
  await workspace.getByRole('textbox', { name: '你的思路与代码' }).fill('先记录已见编号。\nseen = set()'); await waitSaved(workspace);
  await workspace.getByRole('button', { name: '记录这次尝试', exact: true }).click(); await workspace.locator('.history li').waitFor();
  await workspace.getByRole('textbox', { name: '你的思路与代码' }).fill('def duplicate(nums):\n    return len(nums) != len(set(nums))\n# 第二次尝试'); await waitSaved(workspace);
  await workspace.getByRole('button', { name: '记录这次尝试', exact: true }).click(); await workspace.waitForFunction(() => document.querySelectorAll('.history li').length === 2);
  await workspace.getByRole('button', { name: '寻找相邻差值', exact: false }).click();
  await workspace.getByRole('textbox', { name: '你的思路与代码' }).fill('answer = min(b - a for a, b in zip(nums, nums[1:]))'); await waitSaved(workspace);
  await workspace.getByRole('button', { name: '暂停练习', exact: true }).click(); await workspace.getByRole('button', { name: '继续练习', exact: true }).waitFor();
  await workspace.locator('.sessions button').filter({ hasText: '找出重复编号' }).click(); await waitSaved(workspace);
  // 3.2 动作额外系统字段和诊断哨兵不能越过导出白名单。
  await workspace.evaluate(async (dbName) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open(dbName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { await new Promise((resolve, reject) => {
      const transaction = db.transaction(['actions', 'diagnostics'], 'readwrite'); const request = transaction.objectStore('actions').openCursor();
      request.onsuccess = () => { const cursor = request.result; if (cursor) cursor.update({ ...cursor.value, apiKey: 'synthetic-system-key-sentinel' }); };
      transaction.objectStore('diagnostics').add({ id: crypto.randomUUID(), actionId: null, code: 'STORAGE_FAILED', at: Date.now(), apiKey: 'synthetic-diagnostic-sentinel' });
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    }); } finally { db.close(); }
  }, dbName);
  const finalDraft = '# 点击下载时先确认草稿\nfor number in nums:\n    print(number)';
  await workspace.getByRole('textbox', { name: '你的思路与代码' }).fill(finalDraft);
  const original = await downloadBackup(workspace, 'source-backup');
  assert.equal(original.backup.data.sessions.find((session) => session.status === 'active').draft, finalDraft);
  assert.ok(original.backup.data.sessions.some((session) => session.status === 'paused'));
  assert.equal(JSON.stringify(original.backup).includes('synthetic-system-key-sentinel'), false);
  assert.equal(JSON.stringify(original.backup).includes('synthetic-diagnostic-sentinel'), false);
  assert.deepEqual(Object.keys(original.backup.data).sort(), [...tables].sort());
  await workspace.screenshot({ path: join(artifactDir, 'source-workspace.png'), fullPage: true });
  record('BK-01/07/10', '真实下载含多会话、中文、Python、尝试和确认草稿，系统哨兵未导出');
  logger.info('下载闭环结束');
  await verifySources(source, workspace, original.backup); await closeContext(source.context);

  /*
   * ========================================================================
   * 步骤5：另一空配置恢复并验证非覆盖导入
   * ========================================================================
   * 数据源：实际下载文件与生产 dist 原样副本。
   * 操作：1) 跨扩展 ID 恢复并回导。2) 核对重试、冲突、取消、非法文件和重启。
   */
  logger.info('开始恢复闭环');
  const targetPath = await mkdtemp(join(tmpdir(), 'algorhythm-backup-build-')); await cp(extensionPath, targetPath, { recursive: true });
  const targetProfile = await mkdtemp(join(tmpdir(), 'algorhythm-backup-target-'));
  let target = await openContext(targetProfile, targetPath); workspace = await openWorkspace(target); evidence.targetExtensionId = target.id;
  assert.notEqual(target.id, source.id); assert.ok(Object.values(await facts(workspace)).every((rows) => rows.length === 0));
  // 5.1 只模拟已提交响应丢失，真实事务不打桩，也不制造第二次 import。
  await workspace.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime); let dropped = false; window.backupProbeCalls = [];
    chrome.runtime.sendMessage = async (command) => { window.backupProbeCalls.push(command.type); const response = await original(command);
      if (command.type === 'backup.import' && !dropped) { dropped = true; throw new Error('Synthetic committed ACK loss'); } return response; };
    window.restoreBackupProbe = () => { chrome.runtime.sendMessage = original; };
  });
  await chooseBackup(workspace, original.path); await confirmImport(workspace);
  const calls = await workspace.evaluate(() => { const result = window.backupProbeCalls; window.restoreBackupProbe(); return result; });
  assert.equal(calls.filter((type) => type === 'backup.import').length, 1); assert.equal(calls.filter((type) => type === 'backup.query').length, 1);
  const restored = await facts(workspace); const firstReceipt = restored.backupImports[0];
  assert.deepEqual(comparableData(Object.fromEntries(tables.map((table) => [table, restored[table]])), source.id), comparableData(original.backup.data, source.id));
  assert.equal(firstReceipt.digest, digestBackup(original.backup));
  record('BK-01/06/08', '另一空配置跨扩展 ID 恢复；模拟丢 ACK 后只查询一次，没有自动重发', '真实 IndexedDB 提交，传输异常由测试页面模拟');
  await workspace.locator('.sessions button').filter({ hasText: '找出重复编号' }).click(); await waitSaved(workspace);
  assert.equal(await workspace.getByRole('textbox', { name: '你的思路与代码' }).inputValue(), finalDraft);
  const roundTrip = await downloadBackup(workspace, 'target-round-trip');
  assert.deepEqual(comparableData(roundTrip.backup.data, source.id), comparableData(original.backup.data, source.id));
  const oldAction = original.backup.data.actions.find((row) => JSON.parse(row.fingerprint).type === 'saveDraft');
  assert.deepEqual((await send(workspace, { type: 'queryAction', targetActionId: oldAction.id })).result, oldAction.result);
  const resend = { ...JSON.parse(oldAction.fingerprint), extensionId: target.id };
  assert.deepEqual(await send(workspace, resend), oldAction.result);
  assert.equal((await send(workspace, { ...resend, text: 'changed command' })).code, 'ACTION_COLLISION');
  assert.equal((await send(workspace, JSON.parse(oldAction.fingerprint))).code, 'INSTANCE_MISMATCH');
  record('BK-01/08', '实际回导四表一致，历史动作可查询去重，旧实例与篡改命令仍拒绝');
  if (!stable) {
    // 5.2 两份文件各自合法，合并后也不得破坏快照归属或 revision 唯一性。
    const problemIds = original.backup.data.problems.map((row) => row.id);
    for (const [name, preservedIds] of [
      ['共享题目快照的新会话', problemIds],
      ['同会话另一套事件历史', [...problemIds, ...original.backup.data.sessions.map((row) => row.id)]],
    ]) {
      const incoming = { ...structuredClone(original.backup), backupId: randomUUID(), data: independentData(original.backup.data, preservedIds) };
      const before = await facts(workspace);
      // 通过真实预览证明文件本身合法，再用实际 runtime 独立断言错误码。
      await chooseBackup(workspace, incoming);
      const rejected = await send(workspace, { type: 'backup.import', backup: incoming, expectedDigest: digestBackup(incoming) });
      assert.equal(rejected.code, 'BACKUP_CONFLICT');
      assert.deepEqual(await facts(workspace), before);
      assert.equal((await send(workspace, { type: 'backup.export' })).ok, true);
      await workspace.getByRole('button', { name: '取消', exact: true }).click();
      record('BK-03/04', `${name}整份拒绝且五表不变，之后仍可导出`);
    }
  }
  // 5.2 同 backupId 在续练后仍只返回原回执，不能恢复旧草稿。
  const continuedDraft = '# 恢复后继续练习，旧备份不能覆盖';
  await workspace.getByRole('textbox', { name: '你的思路与代码' }).fill(continuedDraft); await waitSaved(workspace);
  const continued = await facts(workspace); await chooseBackup(workspace, original.path); await confirmImport(workspace);
  assert.deepEqual(await facts(workspace), continued);
  assert.equal(await workspace.getByRole('textbox', { name: '你的思路与代码' }).inputValue(), continuedDraft);
  await workspace.reload(); await workspace.getByRole('textbox', { name: '你的思路与代码' }).waitFor();
  assert.equal(await workspace.getByRole('textbox', { name: '你的思路与代码' }).inputValue(), continuedDraft);
  await stopWorker(target.context, workspace, target.worker.url());
  assert.deepEqual((await send(workspace, { type: 'backup.query', backupId: original.backup.backupId, expectedDigest: digestBackup(original.backup) })).receipt, firstReceipt);
  record('BK-02/06/10', '续练后重复导入不覆盖，刷新与真实 worker 停启后原回执保留');
  // 5.3 冲突文件还包含独立新会话，整份拒绝时不得留下待添加行或回执。
  const independent = independentData(original.backup.data); const conflict = structuredClone(original.backup); conflict.backupId = randomUUID();
  for (const table of tables) conflict.data[table].push(...independent[table]);
  const beforeConflict = await facts(workspace); await chooseBackup(workspace, conflict);
  await workspace.getByRole('button', { name: '确认导入', exact: true }).click(); await region(workspace).getByRole('alert').waitFor();
  assert.deepEqual(await facts(workspace), beforeConflict);
  assert.equal((await send(workspace, { type: 'backup.query', backupId: conflict.backupId, expectedDigest: digestBackup(conflict) })).receipt, null);
  await workspace.screenshot({ path: join(artifactDir, 'conflict.png'), fullPage: true });
  record('BK-03', '同 ID 冲突整份拒绝，独立新会话、原事实及回执均不变');
  await workspace.getByRole('button', { name: '取消', exact: true }).click();
  await chooseBackup(workspace, { ...structuredClone(original.backup), backupId: randomUUID(), data: independent });
  await workspace.getByRole('button', { name: '取消', exact: true }).click(); assert.deepEqual(await facts(workspace), beforeConflict);
  for (const [name, text] of [['invalid.json', '{ invalid'], ['future.json', JSON.stringify({ ...original.backup, formatVersion: 2 })]]) {
    await workspace.getByLabel('选择备份文件', { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
    await region(workspace).getByRole('alert').waitFor(); assert.deepEqual(await facts(workspace), beforeConflict);
  }
  record('BK-04/10', '预览取消、非法 JSON 及未知版本均无学习写入或成功回执');
  await workspace.screenshot({ path: join(artifactDir, 'target-workspace.png'), fullPage: true }); await closeContext(target.context);
  target = await openContext(targetProfile, targetPath, target.id); workspace = await openWorkspace(target);
  await workspace.getByRole('textbox', { name: '你的思路与代码' }).waitFor();
  assert.equal(await workspace.getByRole('textbox', { name: '你的思路与代码' }).inputValue(), continuedDraft);
  assert.deepEqual(await facts(workspace), beforeConflict);
  record('BK-06/10', '整个目标浏览器关闭并重开后，续练草稿与回执保留');
  await closeContext(target.context); logger.info('恢复闭环结束');

  /*
   * ========================================================================
   * 步骤6：真实旧库升级与升级中断
   * ========================================================================
   * 数据源：第三个独立配置的旧版五表布局与固定合成 fixture。
   * 操作：1) 升级前同事务导出四表。2) 中断生产打开，重启后台完成升级并实际下载核对。
   */
  logger.info('开始真实 IndexedDB 迁移验证');
  const migration = await openContext(await mkdtemp(join(tmpdir(), 'algorhythm-backup-migration-')), extensionPath);
  const fixture = JSON.parse(await readFile(join(extensionRoot, 'tests/fixtures/backup-v1.json'), 'utf8'));
  await migration.worker.evaluate(async ({ dbName, data, extensionId }) => {
    for (const action of data.actions) { const command = JSON.parse(action.fingerprint); command.extensionId = extensionId; action.fingerprint = JSON.stringify(command); }
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 10);
      request.onupgradeneeded = () => {
        const db = request.result; db.createObjectStore('problems', { keyPath: 'id' });
        db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        const events = db.createObjectStore('events', { keyPath: 'id' }); events.createIndex('sessionId', 'sessionId'); events.createIndex('kind', 'kind');
        db.createObjectStore('actions', { keyPath: 'id' }); db.createObjectStore('diagnostics', { keyPath: 'id' }).createIndex('at', 'at');
      };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try { await new Promise((resolve, reject) => {
      const transaction = db.transaction(['problems', 'sessions', 'events', 'actions', 'diagnostics'], 'readwrite');
      for (const [table, rows] of Object.entries(data)) for (const row of rows) transaction.objectStore(table).add(row);
      transaction.objectStore('diagnostics').add({ id: '00000000-0000-4000-8000-000000000999', actionId: null, code: 'STORAGE_FAILED', at: 1_700_000_000_123 });
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    }); } finally { db.close(); }
  }, { dbName, data: fixture.data, extensionId: migration.id });
  const beforeUpgrade = await rawRead(migration.worker, tables); assert.equal(beforeUpgrade.nativeVersion, 10);
  await writeFile(join(artifactDir, 'migration-v1-tool-snapshot.json'), JSON.stringify(beforeUpgrade, null, 2));
  // 6.1 故障只注入测试 worker 的原生升级请求，生产包没有故障开关。
  await migration.worker.evaluate((dbName) => {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, version) => { const request = version === undefined ? open(name) : open(name, version);
      if (name === dbName && version === 20) request.addEventListener('upgradeneeded', () => request.transaction.abort()); return request; };
  }, dbName);
  workspace = await migration.context.newPage(); await workspace.goto(`chrome-extension://${migration.id}/workspace.html`);
  await workspace.getByRole('heading', { name: '备份与恢复', exact: true }).waitFor();
  assert.equal((await send(workspace, { type: 'read' })).code, 'STORAGE_FAILED');
  const preserved = await rawRead(workspace, [...tables, 'diagnostics']);
  assert.equal(preserved.nativeVersion, 10); assert.equal(preserved.storeNames.includes('backupImports'), false);
  assert.deepEqual(Object.fromEntries(tables.map((table) => [table, preserved.data[table]])), beforeUpgrade.data); assert.equal(preserved.data.diagnostics.length, 1);
  // 6.2 后台真实停启移除故障注入，由新 Store 正常升级后下载比对。
  await stopWorker(migration.context, workspace, migration.worker.url()); await workspace.reload();
  await workspace.getByRole('heading', { name: '备份与恢复', exact: true }).waitFor();
  const migrated = await downloadBackup(workspace, 'migration-v2-backup');
  assert.deepEqual(comparableData(migrated.backup.data, migration.id), comparableData(beforeUpgrade.data, migration.id));
  const afterUpgrade = await rawRead(workspace, [...tables, 'backupImports', 'diagnostics']);
  assert.equal(afterUpgrade.nativeVersion, 20); assert.deepEqual(afterUpgrade.data.diagnostics, preserved.data.diagnostics);
  const rejected = await workspace.evaluate((dbName) => new Promise((resolve) => { const request = indexedDB.open(dbName, 10); request.onerror = () => resolve(request.error.name); request.onsuccess = () => { request.result.close(); resolve('opened'); }; }), dbName);
  assert.equal(rejected, 'VersionError'); assert.deepEqual(await rawRead(workspace, [...tables, 'backupImports', 'diagnostics']), afterUpgrade);
  record('BK-09', '真实 v1 工具快照→升级中断保留→后台重启升级 v2→按钮下载四表一致', '升级前快照由测试工具读取，旧应用没有导出按钮；原生低版本请求不清库');
  evidence.notes.push('旧 Dexie 4.4.6 可不指定版本重开仅加表的 v2，模拟测试已如实表征；不宣称旧二进制必被拒绝。');
  evidence.notes.push('未制造真实配额耗尽、事务中途杀浏览器或真实连接中断；ACK 丢失及升级 abort 为测试注入，持久化为真实 IndexedDB。');
  assert.deepEqual(evidence.errors, []); logger.info('真实 IndexedDB 迁移验证结束');
  await closeContext(migration.context);
  if (!stable) {
    // 6.3 当前三个配置均已关闭，再串行运行页面范围内的 UI 故障验证。
    const child = await promisify(execFile)(process.execPath, [join(extensionRoot, 'scripts/backup-ui-boundaries.mjs')], { cwd: extensionRoot, windowsHide: true, timeout: 120_000 });
    await writeFile(join(artifactDir, 'ui-boundaries.log'), child.stdout + child.stderr);
    const boundaries = JSON.parse(await readFile(join(extensionRoot, 'output/task02/ui-boundaries/results.json'), 'utf8'));
    assert.equal(boundaries.failure, undefined); assert.deepEqual(boundaries.errors, []); assert.equal(boundaries.results.length, 10);
    record('BK-04/06/10', '串行 UI 边界脚本10项通过', '页面范围模拟：flush、未知恢复、迟到文件/摘要、读取失败、超Date时间');
  }
} catch (error) {
  evidence.failure = error.stack; process.exitCode = 1; logger.error('备份浏览器验收失败', error.message);
  await workspace?.screenshot({ path: join(artifactDir, 'workspace-failure.png'), fullPage: true }).catch(() => undefined);
} finally {
  for (const context of [...contexts]) await closeContext(context).catch(() => undefined);
  if (webServer) { webServer.closeAllConnections(); await new Promise((done) => webServer.close(done)); }
  await writeFile(join(artifactDir, 'results.json'), JSON.stringify(evidence, null, 2)); logger.info('备份浏览器验收结束');
}
