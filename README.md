# AlgoRhythm

面向实习与校招的算法学习助手：用户专注思考和练习，系统负责安排、辅导与记录。

**当前有可构建的扩展存储原型，尚不是完整学习产品。** 两道原创合成题用于验证草稿、尝试和暂停恢复。旧 demo 已退役，新原型不调用模型，不采集力扣。

## 从哪里开始

- [会话续接入口](docs/CONTINUITY.md)：已确认方向与下一步。
- [当前进度](docs/STATUS.md)：实际完成与未验证事项。
- [首版路线](docs/ROADMAP.md)：验证和开发顺序。
- [架构与场景](docs/ARCHITECTURE.md)：主页面关闭后，侧栏如何继续保存。

完整工作台和练习侧栏位于同一个浏览器扩展中，共用一份本地记录。后台处理命令和数据库事务，关闭工作台不影响其他扩展页面保存。实际验证与限制见 [原型验收](docs/verification/2026-10-13-extension-prototype.md)。

日常题目与正式判题仍在力扣。首版完整验收 Python，以可靠资料、按需提示、主动选择讲解和延后练习支撑学习；不做竞赛、排名或社区。

## 运行存储原型

使用 Node.js 24 和桌面 Chrome：

```sh
cd apps/extension
npm ci
npm run build
```

打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，选中 `apps/extension/dist`。点击扩展图标打开工作台，点击“打开练习侧栏”打开原生侧栏。`npm run dev` 监听源码并重新构建；修改后台或清单后需在扩展管理页重新加载。

记录属于同一浏览器配置和扩展 ID。原型尚无完整备份，不用于保存唯一一份重要学习资料。“导出草稿”仅导出当前文本，不代表完整数据备份。

![合成练习工作台](docs/images/extension-workspace.png)

```sh
npm test
npm run build
npx playwright install chromium
npm run check:browser
```

浏览器检查使用独立临时配置，不使用个人登录档案。结果和截图在 `apps/extension/output/playwright`；正式 Chrome 安装、真实力扣、模型和教学效果须分别验收。

## 文档检查

安装 Node.js 24 后，无需安装项目依赖：

```sh
node scripts/check-docs.mjs
git diff --check
```

CI 检查文档、退役边界、类型、单元测试和扩展构建。浏览器验证结果单独记录，单元测试不代表教学验收。

## 历史与协作

旧源码、截图和开发交接保留在 Git 历史中的 [归档版本](https://github.com/harbinresearcher/algorhythm/tree/archive/demo-before-redesign-2026-10-12)。清理不改写历史，不清除用户浏览器中的题库或 API 配置。详情见 [退役记录](docs/DEMO-RETIREMENT.md)。

贡献前阅读 [CONTRIBUTING](CONTRIBUTING.md) 和 [AGENTS](AGENTS.md)。许可证：[MIT](LICENSE)。
