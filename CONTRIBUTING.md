# 贡献指南

开始前先读 [当前进度](docs/STATUS.md)、[路线图](docs/ROADMAP.md) 和 [架构](docs/ARCHITECTURE.md)。Agent 还必须遵守 [AGENTS.md](AGENTS.md)。

参与本项目即表示你同意遵守[贡献者行为准则](CODE_OF_CONDUCT.md)。安全漏洞**不要**用公开 Issue 报告，见 [SECURITY.md](SECURITY.md)；提问与求助渠道见 [SUPPORT.md](SUPPORT.md)。

## 开发环境

Node.js 22.13+（22.x）、24.x 或 26+，使用 npm。仓库公开，克隆即可开始。

```sh
git clone https://github.com/harbinresearcher/algorhythm.git
cd algorhythm
npm install && npm run dev
```

访问 http://127.0.0.1:5173。已有 lockfile，重复安装和验证建议用 `npm ci`；不要提交 node_modules、Key 或个人浏览器数据库。

## 分支策略

- `main`：可运行的基线，第一阶段已交付功能。已启用分支保护：要求通过 PR 合入，禁止强推与删除；仓库所有者保留应急直接推送的旁路。
- `feature/<简短描述>`：从最新 main 创建，完成单一功能或修复后通过 PR 合入。
- `dev`：多人协作需要集成分支时再引入；目前不创建长期 dev 分支，避免两条基线漂移。

Agent 的明确授权直接提交例外，以当前任务指令为准。不要覆盖他人未提交内容，不强制推送共享分支。

## 代码规范

ESLint 检查 TypeScript 和 Hooks 调用位置；Prettier 统一缩进、引号和换行。使用当前 flat config `eslint.config.js`，不添加旧式 `.eslintrc.cjs`。

```sh
npm run lint
npm run format
npm run format:check
npm test
npm run build
```

- 只修改任务所需内容，类型清晰，不用 any 掩盖边界错误。
- 核心逻辑不依赖 React，UI 不直接编写排期算法。
- 主要逻辑使用现有步骤块注释、子步骤注释和开始/结束 logger.info。日志只记录动作，不含 Key、请求头或题目全文。
- 新功能或修复先定义验收方式；行为改动需相应测试，纯文档改动检查链接与事实即可。
- UI 改动检查桌面和移动尺寸；截图不得包含密钥或个人题库。
- 固定 16 种模式，FSRS 默认参数 + fuzz；路线图未授权功能不得自行实现。

## 提交信息

采用 `类型: 简短说明`，例如：

```text
feat: add pattern filter
fix: prevent duplicate review ratings
docs: update MVP status
chore: configure lint and formatting
```

每次结束必须更新 docs/STATUS.md，写明已完成内容、验证结果、已知问题和下一步。仅在需要保留详细交接背景时更新 docs/HANDOFF.md。

不要提交 API Key、`.env`、个人题库或浏览器配置。仓库启用了密钥扫描的推送保护：一旦提交中出现疑似密钥，`git push` 会被服务端直接拒绝。遇到拦截时请删除密钥并到对应服务商处轮换，**不要**用 `--no-verify` 或其他方式绕过。

## PR 流程

1. 先读 STATUS 和 ROADMAP；新功能先确认范围，Bug 提供复现步骤。
2. 创建短期 feature 分支，保持单一目的。
3. 运行 lint、format:check、test、build，记录实际结果；UI 改动附截图。
4. 填写 PR 模板，说明问题、改动、验证方式和关联 Issue。
5. 根据评审修改后重复受影响检查，再合入 main。

GitHub Actions 已验证 lint、format:check、test 和 build；仓库维护工作流另检查文档链接、工作流语法和依赖漏洞，具体触发条件见 [自动化说明](docs/REPOSITORY-AUTOMATION.md)。CodeQL 使用 GitHub 托管的默认配置。自动检查是否为 required check，以当前分支保护为准，不将“检查通过”写成“强制门禁已开启”。

Dependabot 每周提出更新 PR；小版本按生产依赖、开发依赖或 Actions 分组，大版本单独评估。更新不会自动合并；需核对当前 head SHA 的检查，业务和框架迁移交总架构确认。不要用 `--force` 或 `--legacy-peer-deps` 绕过依赖冲突。

测试替身只能证明交互与数据流程，不能当作真实 AI 分类验收。许可证为 MIT，提交前确认新增代码和素材允许以此方式分发。
