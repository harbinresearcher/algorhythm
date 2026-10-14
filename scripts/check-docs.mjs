import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const logger = console;
const root = resolve(process.argv[2] ?? process.cwd());
const failures = [];

/*
 * ========================================================================
 * 步骤1：检查设计基线
 * ========================================================================
 * 数据源：指定仓库目录。
 * 操作：
 * 1) 确认续接与设计入口存在。
 * 2) 拒绝旧 demo 入口重新混入当前文档基线。
 */
logger.info('开始检查设计基线');
// 1.1 检查必要入口。
for (const file of ['README.md', 'AGENTS.md', 'LICENSE', 'docs/CONTINUITY.md', 'docs/STATUS.md', 'docs/ARCHITECTURE.md']) {
  if (!existsSync(resolve(root, file))) failures.push(`Missing required file: ${file}`);
}
// 1.2 新原型位于 apps/extension；根目录旧 demo 入口继续禁止。
for (const file of ['src/App.tsx', 'src/ai.ts', 'tests/core.test.ts', 'index.html', 'package.json', 'package-lock.json']) {
  if (existsSync(resolve(root, file))) failures.push(`Retired application entry found: ${file}`);
}
logger.info('设计基线检查完成');

/*
 * ========================================================================
 * 步骤2：检查本地文档引用
 * ========================================================================
 * 数据源：仓库 Markdown 文件。
 * 操作：
 * 1) 跳过 Git 元数据、依赖及产物。
 * 2) 检查行内相对文件引用，不请求外部网站。
 */
logger.info('开始检查本地文档引用');
const documents = [];
const pending = [root];
const excluded = new Set(['.git', 'node_modules', 'dist', '.tmp', '.browsers', '.npm-cache', 'output']);
// 2.1 只遍历普通目录和文件，不跟随符号链接。
while (pending.length) {
  const directory = pending.pop();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) pending.push(fullPath);
    else if (entry.isFile() && entry.name.endsWith('.md')) documents.push(fullPath);
  }
}
let links = 0;
// 2.2 检查当前文档使用的行内文件链接，锚点和远端内容不在此检查范围。
for (const file of documents) {
  const content = readFileSync(file, 'utf8').replace(/```[^\n]*\n[\s\S]*?```/g, '');
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
    links++;
    try {
      if (!existsSync(resolve(dirname(file), decodeURIComponent(target)))) {
        failures.push(`${relative(root, file)}: missing link ${target}`);
      }
    } catch {
      failures.push(`${relative(root, file)}: malformed link ${target}`);
    }
  }
}
logger.info(`文档引用检查完成：${documents.length} 份文档，${links} 个本地引用`);

/*
 * ========================================================================
 * 步骤3：报告检查结果
 * ========================================================================
 * 操作：
 * 1) 输出文件级错误，不读取个人配置。
 * 2) 失败返回非零状态供 CI 阻断。
 */
logger.info('开始汇总检查结果');
// 3.1 任一失败都影响最终退出码。
for (const failure of failures) logger.error(failure);
process.exitCode = failures.length ? 1 : 0;
logger.info(`检查结束：${failures.length} 个错误`);
