# AlgoRhythm

面向实习与校招的算法学习助手：用户专注思考和练习，系统负责安排、辅导与记录。

**当前处于首版重新设计阶段，没有可运行应用。** 旧 demo 已按维护者要求退役；不再提供旧版安装、开发服务器或模型配置说明。

## 从哪里开始

- [会话续接入口](docs/CONTINUITY.md)：已确认方向与下一步。
- [当前进度](docs/STATUS.md)：实际完成与未验证事项。
- [首版路线](docs/ROADMAP.md)：验证和开发顺序。
- [架构与场景](docs/ARCHITECTURE.md)：主页面关闭后，侧栏如何继续保存。

首版计划把完整学习工作台和力扣侧栏放在同一个浏览器扩展中，共用一份本地学习记录。这个部署选择已有设计依据，尚未通过真实浏览器原型验收。

日常题目与正式判题仍在力扣。首版完整验收 Python，以可靠资料、按需提示、主动选择讲解和延后练习支撑学习；不做竞赛、排名或社区。

## 文档检查

安装 Node.js 24 后，无需安装项目依赖：

```sh
node scripts/check-docs.mjs
git diff --check
```

当前 CI 检查文档引用与退役边界，不代表未来产品已有测试、构建或教学验收。

## 历史与协作

旧源码、截图和开发交接保留在 Git 历史中的 [归档版本](https://github.com/harbinresearcher/algorhythm/tree/archive/demo-before-redesign-2026-10-12)。清理不改写历史，不清除用户浏览器中的题库或 API 配置。详情见 [退役记录](docs/DEMO-RETIREMENT.md)。

贡献前阅读 [CONTRIBUTING](CONTRIBUTING.md) 和 [AGENTS](AGENTS.md)。许可证：[MIT](LICENSE)。
