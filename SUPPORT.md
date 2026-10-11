# 获取帮助

AlgoRhythm 是个人维护的学习项目，不提供商业级技术支持，也没有服务等级承诺。不过提问前做一点功课，能让问题解决得快很多。

## 先查文档

多数问题在文档里已经有答案：

- [README.md](README.md)：安装、快速开始、AI 配置、常见错误含义、本地数据说明。
- [docs/STATUS.md](docs/STATUS.md)：当前进度、已知问题与边界。
- [docs/ROADMAP.md](docs/ROADMAP.md)：已规划和**尚未授权**的功能范围。
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：代码结构与职责划分。

## 提问与讨论

使用 GitHub Discussions 的 **Q&A** 分类：<https://github.com/harbinresearcher/algorhythm/discussions>

适合放在 Discussions 的内容：使用中的困惑、“这个报错是什么意思”、想法讨论、展示你的用法。

提问时请附上：

- Node.js 版本（`node -v`）与操作系统。
- 你配置的**服务商与模型名**（例如 DeepSeek / `deepseek-flash`）——**不要贴 Key，不要贴完整 Base URL 里的任何凭据**。
- 完整报错文字与复现步骤。

> **绝对不要在任何公开位置粘贴 API Key。** 如果不小心贴了，立刻到对应服务商后台吊销并重新生成；已经推送到仓库的密钥会被推送保护拦下，但已经公开的内容必须视为已泄露。

## 报告 Bug

使用 [Bug 报告模板](https://github.com/harbinresearcher/algorhythm/issues/new?template=bug_report.md) 提交 Issue。

提交前请先确认问题能在当前 `main` 上复现，并说明是开发服务器还是构建产物（`npm run preview`）；两者的浏览器存储是分开的。

## 功能建议

使用 [功能建议模板](https://github.com/harbinresearcher/algorhythm/issues/new?template=feature_request.md) 提交。

请先读 [路线图](docs/ROADMAP.md)：`- [ ]` 只表示“有可能做”，**不表示已授权开发**。第一阶段明确不做后端、账号、自动抓取、浏览器扩展、代码编辑器、掌握度图表与面试模拟，相关建议可能被推迟。

## 报告安全问题

**不要用公开 Issue 报告安全漏洞。** 请按 [SECURITY.md](SECURITY.md) 使用 GitHub 私有漏洞报告。

也请注意 SECURITY.md 中列出的“已知设计，不是漏洞”，例如 API Key 明文存在浏览器 `localStorage`。

## 参与贡献

开发环境、代码规范与 PR 流程见 [CONTRIBUTING.md](CONTRIBUTING.md)；社区行为规范见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)；版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 我们不提供

- 代填、代管或找回 API Key。
- 代为申请或充值第三方 AI 服务。
- 针对个人环境的远程协助或结对调试。
- 与 LeetCode、牛客等平台账号相关的操作或数据抓取。
