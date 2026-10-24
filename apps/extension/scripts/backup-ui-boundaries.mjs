import { chromium } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const logger = console;
const artifactDir = resolve('output/task02/ui-boundaries');
const extensionPath = resolve('dist');
const fixture = JSON.parse(await readFile('tests/fixtures/backup-v1.json', 'utf8'));
const empty = (id = '00000000-0000-4000-8000-000000000900', appVersion = '0.1.0') => ({
  format: 'algorhythm-backup', formatVersion: 1, scope: 'prototype-storage-v1', backupId: id, exportedAt: 1,
  source: { appVersion, extensionId: 'abcdefghijklmnopabcdefghijklmnop' }, data: { problems: [], sessions: [], events: [], actions: [] },
});
const evidence = { date: new Date().toISOString(), profile: 'separate temporary synthetic profiles per scenario',
  mode: 'production Chromium; page-limited simulated transport, File.text and digest delays', results: [], errors: [] };
await mkdir(artifactDir, { recursive: true });
const record = (name) => { evidence.results.push(name); logger.info('通过', name); };
let context;
let page;

async function open() {
  const profile = await mkdtemp(join(tmpdir(), 'algorhythm-backup-ui-boundaries-'));
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, acceptDownloads: true,
    viewport: { width: 1360, height: 1000 }, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  context.on('page', (next) => next.on('pageerror', (error) => evidence.errors.push(error.message)));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/workspace.html`);
  await page.getByRole('heading', { name: '备份与恢复', exact: true }).waitFor();
  await page.getByRole('button', { name: '找出重复编号', exact: false }).waitFor();
  evidence.browserVersion = context.browser()?.version();
  return page;
}
async function close() { await context?.close(); context = undefined; }
async function start() {
  await page.getByRole('button', { name: '找出重复编号', exact: false }).click();
  await page.getByRole('textbox', { name: '你的思路与代码' }).waitFor();
}
async function choose(backup, name = 'synthetic-backup.json') {
  await page.getByLabel('选择备份文件', { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.getByLabel('备份预览', { exact: true }).waitFor();
}
async function installTransport(mode = 'pass') {
  await page.evaluate((mode) => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.__calls = []; window.__failImport = mode === 'unknown'; window.__failRead = false;
    chrome.runtime.sendMessage = async (command) => {
      window.__calls.push(structuredClone(command));
      if (mode === 'flush-failure' && command.type === 'saveDraft') return { ok: false, actionId: command.actionId, code: 'STORAGE_FAILED' };
      if (window.__failImport && command.type === 'backup.import') throw new Error('simulated lost import before send');
      if (window.__failRead && command.type === 'read') throw new Error('simulated read failure after successful import');
      const result = await send(command);
      if (mode === 'read-failure' && command.type === 'backup.import' && result.ok) window.__failRead = true;
      return result;
    };
  }, mode);
}

try {
  /*
   * ========================================================================
   * 步骤1：验证完整备份先确认当前草稿
   * ========================================================================
   * 数据源：生产页面、真实后台、页面限定传输记录。
   * 操作：1) 输入后立即下载。2) 模拟保存失败时验证无导出消息或下载。
   */
  logger.info('开始验证草稿与备份顺序');
  await open(); await start(); await installTransport();
  // 1.1 不等待debounce，下载必须包含刚输入的草稿。
  await page.getByRole('textbox', { name: '你的思路与代码' }).fill('合成边界：立即下载前必须保存。');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载备份', exact: true }).click();
  const download = await downloading;
  const path = join(artifactDir, 'flushed-backup.json'); await download.saveAs(path);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.data.sessions[0].draft, '合成边界：立即下载前必须保存。');
  const order = await page.evaluate(() => window.__calls.map((item) => item.type));
  assert.ok(order.indexOf('saveDraft') >= 0 && order.indexOf('saveDraft') < order.indexOf('backup.export'));
  record('BK-10 真实后台：未等debounce的当前输入先flush，再导出且下载文件含新草稿');
  await close(); await open(); await start(); await installTransport('flush-failure');
  let downloads = 0; page.on('download', () => downloads++);
  await page.getByRole('textbox', { name: '你的思路与代码' }).fill('合成边界：保存失败仍可导出草稿。');
  await page.getByRole('button', { name: '下载备份', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '未生成完整备份' }).waitFor();
  assert.equal(await page.evaluate(() => window.__calls.filter((item) => item.type === 'backup.export').length), 0);
  assert.equal(downloads, 0);
  assert.equal(await page.getByRole('button', { name: '导出草稿', exact: true }).isEnabled(), true);
  await page.screenshot({ path: join(artifactDir, 'flush-failure.png'), fullPage: true });
  record('BK-10 模拟保存失败：不发backup.export、不下载完整文件，保留导出草稿');
  logger.info('草稿与备份顺序验证结束');

  /*
   * ========================================================================
   * 步骤2：验证未知结果的锁和手动恢复
   * ========================================================================
   * 数据源：页面模拟导入传输失败，真实查询与后续真实导入。
   * 操作：1) 初次只查询不重发。2) 手动恢复先查再发同文件摘要。
   */
  logger.info('开始验证未知导入恢复');
  await close(); await open(); await start(); await choose(empty()); await installTransport('unknown');
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await page.getByRole('button', { name: '核实并重试', exact: true }).waitFor();
  // 2.1 未知结果不能换文件或切题，管理区域唯一可用按钮是原请求核实。
  assert.equal(await page.getByLabel('选择备份文件', { exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '确认导入', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '取消', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('textbox', { name: '你的思路与代码' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '更新记录', exact: true }).isDisabled(), true);
  assert.deepEqual(await page.locator('.backup-panel button:not([disabled])').allTextContents(), ['核实并重试']);
  assert.equal(await page.getByLabel('选择备份文件', { exact: true }).evaluate((input) => input.files[0].name), 'synthetic-backup.json');
  assert.deepEqual(await page.evaluate(() => window.__calls.map((item) => item.type)), ['backup.import', 'backup.query']);
  await page.screenshot({ path: join(artifactDir, 'unknown-locked.png'), fullPage: true });
  await page.evaluate(() => { window.__failImport = false; });
  await page.getByRole('button', { name: '核实并重试', exact: true }).click();
  await page.locator('.backup-panel .notice').filter({ hasText: '导入成功' }).waitFor();
  const calls = await page.evaluate(() => window.__calls);
  assert.deepEqual(calls.filter((item) => item.type.startsWith('backup.')).map((item) => item.type), ['backup.import', 'backup.query', 'backup.query', 'backup.import']);
  assert.deepEqual(calls[0].backup, calls[3].backup); assert.equal(calls[0].expectedDigest, calls[3].expectedDigest);
  record('BK-06/10 模拟传输丢失：unknown锁住原文件与切题；手动恢复先query，null后同文件摘要导入');
  logger.info('未知导入恢复验证结束');

  /*
   * ========================================================================
   * 步骤3：区分已成功导入与随后刷新失败
   * ========================================================================
   * 数据源：真实成功导入回执与页面模拟read拒绝。
   * 操作：1) 保留成功回执。2) 不显示未知状态或提供重复导入恢复。
   */
  logger.info('开始验证成功后的刷新失败');
  await close(); await open(); await start(); await choose(empty()); await installTransport('read-failure');
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '导入已确认，但工作台记录更新失败' }).waitFor();
  assert.equal(await page.locator('.backup-panel .notice').filter({ hasText: '导入成功' }).count(), 1);
  assert.equal(await page.getByLabel('导入回执', { exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: '核实并重试', exact: true }).count(), 0);
  assert.equal(await page.getByLabel('选择备份文件', { exact: true }).isEnabled(), true);
  assert.equal(await page.evaluate(() => window.__calls.filter((item) => item.type === 'backup.query').length), 0);
  await page.screenshot({ path: join(artifactDir, 'success-read-failure.png'), fullPage: true });
  record('BK-10 真实导入+模拟read失败：成功notice和回执保留，只有更新失败提示，不变成unknown');
  logger.info('成功后的刷新失败验证结束');

  /*
   * ========================================================================
   * 步骤4：验证选择代次隔离与读取前大小检查
   * ========================================================================
   * 数据源：页面限定File.text与WebCrypto延迟、合成文件。
   * 操作：1) 取消或换文件后释放旧Promise。2) 旧结果不得恢复预览或发导入。
   */
  logger.info('开始验证文件选择代次');
  await close(); await open(); await installTransport();
  for (const stage of ['text', 'hash']) {
    for (const action of ['cancel', 'replace']) {
      const marker = `old-${stage}-${action}`;
      const current = `new-${stage}-${action}`;
      await page.evaluate(({ stage, marker }) => {
        window.__nativeText ??= File.prototype.text;
        window.__nativeDigest ??= crypto.subtle.digest.bind(crypto.subtle);
        window.__releaseOld = undefined;
        File.prototype.text = function () {
          if (stage === 'text' && this.name === `${marker}.json`) return new Promise((resolve) => {
            window.__releaseOld = async () => resolve(await window.__nativeText.call(this));
          });
          return window.__nativeText.call(this);
        };
        crypto.subtle.digest = (algorithm, bytes) => {
          if (stage === 'hash' && new TextDecoder().decode(bytes).includes(marker)) return new Promise((resolve) => {
            window.__releaseOld = async () => resolve(await window.__nativeDigest(algorithm, bytes));
          });
          return window.__nativeDigest(algorithm, bytes);
        };
      }, { stage, marker });
      // 4.1 旧读取或旧摘要暂停时取消/替换，新预览生效后再释放旧结果。
      await page.getByLabel('选择备份文件', { exact: true }).setInputFiles({ name: `${marker}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(empty(undefined, marker))) });
      await page.waitForFunction(() => typeof window.__releaseOld === 'function');
      if (action === 'cancel') await page.getByRole('button', { name: '取消', exact: true }).click();
      await choose(empty(undefined, current), `${current}.json`);
      assert.equal(await page.getByLabel('备份预览', { exact: true }).getByText(current, { exact: true }).count(), 1);
      await page.evaluate(() => window.__releaseOld());
      await page.waitForTimeout(80);
      assert.equal(await page.getByLabel('备份预览', { exact: true }).getByText(current, { exact: true }).count(), 1);
      assert.equal(await page.getByLabel('备份预览', { exact: true }).getByText(marker, { exact: true }).count(), 0);
      record(`BK-10 模拟${stage}迟到：${action}后旧结果不恢复预览`);
    }
  }
  await page.evaluate(() => { window.__textReads = 0; File.prototype.text = function () { window.__textReads++; return window.__nativeText.call(this); }; });
  await page.getByLabel('选择备份文件', { exact: true }).setInputFiles({ name: 'oversized.json', mimeType: 'application/json', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 32) });
  await page.getByRole('alert').filter({ hasText: '10 MiB' }).waitFor();
  assert.equal(await page.evaluate(() => window.__textReads), 0);
  assert.equal(await page.evaluate(() => window.__calls.filter((item) => item.type.startsWith('backup.')).length), 0);
  record('BK-04/10 超10MiB文件在File.text前拒绝，预览与取消均不发备份写消息');
  logger.info('文件选择代次验证结束');

  /*
   * ========================================================================
   * 步骤5：验证安全整数时间的真实导入与读取
   * ========================================================================
   * 数据源：完整合成fixture，各时间字段改为MAX_SAFE_INTEGER。
   * 操作：1) 真实预览与事务导入。2) 手动选题后读取历史，不触发RangeError。
   */
  logger.info('开始验证超Date范围时间');
  await close(); await open();
  const withTimes = (value) => {
    if (Array.isArray(value)) return value.map(withTimes);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, ['exportedAt', 'createdAt', 'updatedAt', 'at'].includes(key) ? Number.MAX_SAFE_INTEGER : withTimes(item)]));
    return value;
  };
  await choose(withTimes(fixture), 'safe-integer-time.json');
  assert.ok((await page.getByLabel('备份预览', { exact: true }).textContent()).includes('9007199254740991（UTC毫秒）'));
  assert.equal(await page.locator('.backup-preview time').getAttribute('datetime'), null);
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await page.locator('.backup-panel .notice').filter({ hasText: '导入成功' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '你的思路与代码' }).count(), 0);
  await page.locator('.sessions button').first().click();
  await page.getByRole('textbox', { name: '你的思路与代码' }).waitFor();
  assert.ok((await page.locator('.history').textContent()).includes('9007199254740991（UTC毫秒）'));
  assert.equal(await page.locator('.history time[datetime]').count(), 0);
  await page.screenshot({ path: join(artifactDir, 'safe-integer-time-imported.png'), fullPage: true });
  record('BK-04/10 真实事务：MAX_SAFE_INTEGER时间预览、导入、手动选题及历史读取均通过；空选择保持为空');
  logger.info('超Date范围时间验证结束');
  assert.deepEqual(evidence.errors, []);
} catch (failure) {
  evidence.failure = failure.stack; process.exitCode = 1;
  logger.error('UI边界验收失败', failure.message);
  await page?.screenshot({ path: join(artifactDir, 'failure.png'), fullPage: true }).catch(() => undefined);
} finally {
  await close();
  await writeFile(join(artifactDir, 'results.json'), JSON.stringify(evidence, null, 2));
  logger.info('UI边界验收结束');
}
