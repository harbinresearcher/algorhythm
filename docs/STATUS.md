# AlgoRhythm 当前进度

更新日期：2026-10-10（Asia/Shanghai）。每次工作结束必须更新此文件；当前事实以此为准，未来计划见 [ROADMAP.md](ROADMAP.md)。

## 当前阶段

第一阶段 / P0：本地 MVP 功能已实现，模拟 AI 闭环已验证；真实 AI 分类验收尚未完成。仓库已公开（MIT）并更名为 **AlgoRhythm**（仓库名 `algorhythm`），`main` 已启用分支保护；上一轮完成公开仓库的安全加固与社区健康文件。

## 已完成

- AI 设置保存到 localStorage，文本或链接导入；链接先经 Jina Reader 读取正文。
- AI 配置跟上当前模型：默认改为 Base URL `https://api.deepseek.com` + Model `deepseek-flash`（旧默认 `deepseek-chat` 已被 DeepSeek 于 2026-07-24 停用）；设置界面加入「预设供应商」（DeepSeek / OpenAI）与各字段说明；README、SUPPORT 的示例模型名同步。验证：`lint`、`format:check`、`test`（29 项）、`build` 全部通过。
- OpenAI 风格分析请求，固定 16 种模式，JSON/字段校验、超时与可见错误。
- IndexedDB 题库、模式筛选、完整题干与分析详情。
- 先独立回忆再揭示，FSRS 默认参数 + fuzz，事务评分与防重复点击。
- 深色桌面与移动布局，README 与三页运行截图。
- MIT、贡献指南、架构说明、长期路线图、Issue / PR 模板。
- ESLint、Prettier、编辑器和 Git 换行配置；Agent 的统一进度更新要求。
- 公开仓库后的安全加固：密钥扫描、推送保护、Dependabot 告警与安全更新、CodeQL 默认代码扫描、GitHub 私有漏洞报告。
- 社区健康文件：SECURITY.md、CODE_OF_CONDUCT.md、SUPPORT.md、CHANGELOG.md、`.github/CODEOWNERS`。
- README 增加徽章与「贡献与支持」入口，并修正“仓库私有”“暂不启用 CI”等过时表述；CONTRIBUTING 补充分支保护、推送保护与社区规范。
- `main` 分支保护：要求 PR 合入、禁止强推与删除分支，仓库所有者保留应急旁路。
- 仓库描述、16 个话题标签、GitHub Discussions（含 Q&A 分类）与社交预览图素材。
- 2026-10-10 项目更名为 **AlgoRhythm**：应用品牌（`[ar] AlgoRhythm`）、`package.json` 包名、页面标题、日志前缀、内部存储标识、全部文档与五张运行截图同步更新；`docs/phase-1-plan.md` 标注为历史存档并保留正文原貌。
- GitHub Actions CI（`npm ci` / lint / format:check / test / build）与分组 Dependabot 周更；`AGENTS.md` 的「MVP 暂不添加 GitHub Actions」规则已推翻。
- 修正 Node 版本声明：`engines.node` 由 `^22.12.0` 改为 `^22.13.0`（eslint 10 的实际要求），README / CONTRIBUTING / STATUS 的正文与徽章同步。

## 进行中

没有后台开发任务。真实 AI 验收等待用户配置自己的 Key；未开始第二阶段开发。

## 待开始

- 使用真实 API 导入一道题，确认分类与洞察质量。
- 是否启动模式化增强阶段，由用户决定。
- 手动上传社交预览图：Settings → General → Social preview，素材见 `docs/assets/social-preview.png`。
- 手动确认 Settings → Advanced Security 中的 validity checks 与 non-provider patterns（API 无法开启）。

## 本轮验证

切片 1 轮（2026-10-10）：CI 安全网 + Node 版本声明修正

- **CI 首次运行成功**：`CI` 工作流在 PR #2 上由 `pull_request` 事件触发，job `lint / format / test / build` 的 9 个步骤全部 success（Set up job → checkout → setup-node → npm ci → lint → format:check → test → build → 收尾）。
- **门禁有效性实测**：另开一次性分支 `test/verify-ci-gate`（草稿 PR #3）故意引入一个未使用变量，CI **精确地在 `Run npm run lint` 步骤失败**（运行 `38020663342`，`conclusion: failure`）。随后关闭 PR #3 并删除远端与本地分支，未合并。这条证据说明 CI 是真拦得住的门，不是摆设。
- `.github/dependabot.yml` 通过 GitHub 自身的格式校验：PR 检查项 `.github/dependabot.yml` 为 `pass`（1s）。
- PR #2 全部 4 项检查为绿：`lint / format / test / build`、`CodeQL`、`Analyze (javascript-typescript)`、`.github/dependabot.yml`。
- **Node 版本修正已复验**：用 semver 逐个校验 124 个带 `engines.node` 的依赖 —— Node `22.13.0` 与 `24.0.0` 均为 **0 个不满足**；修正前的 `22.12.0` 有 **10 个不满足**（整个 eslint 10 家族）。
- 本地实跑：`npm ci`、`npm run lint`、`npm run format:check`、`npm test`（17 项）、`npm run build` 全部通过。
- 全仓 `22.12` 仅剩两处**记录该缺陷本身**的文档（本文件的变更说明与规格 §4.7），源码与配置已无残留。
- **未包含在本次提交**：`src/` 下的数据导出/导入实现。按分工交由 Codex，接口与文案见规格附录 A、任务拆解见 `docs/superpowers/plans/2026-10-10-slice-1-ci-and-data-backup.md` 的 Task 5–9。

更名轮（2026-10-10）：

- 全仓检索旧名（`LCC` / `LeetCode Companion` / `leetcode-companion` / `CompanionDB` / `[Companion]` / `companion.ai.v1`）：除 `CHANGELOG.md`（记录本次更名）、`docs/HANDOFF.md`（历史条目）与 `docs/phase-1-plan.md`（历史存档）三处有意保留外，无残留。
- 命名脚本对 17 个文件执行 32 处替换，每处都带出现次数断言，全部命中，无静默漏改。
- 本提交已 rebase 到 `f18fe94`（PR #1：链接导入修复）之上。4 处冲突手工合并：ARCHITECTURE 的存储标识改名与 `source.ts` / Jina Reader 说明合并保留；测试改用 `AlgoRhythmDB` 且保留 `resolveProblemSource`；两张截图取远端较新版本后按新品牌重拍。
- npm run lint、npm run format:check、npm test（17 项）、npm run build、git diff --check：全部通过。
- 隔离浏览器实测（合并后的新 UI）：`a.brand` 渲染为 `[ar] AlgoRhythm`，页面标题为 `AlgoRhythm`，控制台无错误；导入三数之和 / 无重复字符的最长子串 / 两数之和成功，成功浮层为「导入成功：三数之和」。AI 响应由请求拦截伪造，含新契约要求的 `isAlgorithmProblem: true`。
- 五张运行截图在合并后代码上重拍：import 1345×1775、library 1360×1040、review-recall 1360×1040、review 1345×1798、mobile 375×1907。含滚动条的整页截图宽度比视口少 15px，属预期。
- 社交预览图重新生成：1280×640，字标改为 Algo 常规 + Rhythm 加粗，徽标为 `[ar]`，底部地址为新仓库名。

仓库公开与安全配置轮（2026-10-09）：

- `gh api` 回读：密钥扫描、推送保护、Dependabot 告警与安全更新、私有漏洞报告均为 enabled。
- CodeQL 默认代码扫描：`CodeQL Setup` 工作流 completed/success，语言 javascript、javascript-typescript、typescript，每周调度。
- 全历史密钥扫描：4 次提交的全部 blob 匹配 `sk-`、`ghp_`、`gho_`、`github_pat_`、`AIza`、`xox[baprs]-`、私钥头与 `AKIA`，以及凭据赋值模式，均无命中。
- 分支保护：回读 required_pr=true、approvals=0、enforce_admins=false、allow_force_pushes=false、allow_deletions=false。
- 仓库描述、16 个话题标签、Discussions 启用状态与 Q&A 分类：回读一致。
- 文档相对链接：9 个文件、49 个相对链接全部有效。
- npm run lint、npm run format:check、npm test（12 项）、npm run build：全部通过。本轮只改文档、CODEOWNERS 与预览图素材，未触碰 src 与 tests。
- 社交预览图：`docs/assets/social-preview.png`，1280×640，由 `docs/assets/make_social_preview.py` 生成，配色取自 `src/index.css`。

功能开发轮（上一轮）：

- npm run lint：通过，无警告。
- npm run format:check：通过。
- npm test：17 项通过（含链接来源与非算法输入回归）。
- npm run build：TypeScript 与 Vite 构建通过。
- git diff --check：通过。
- 干净目录 npm ci：成功；随后 lint、format:check、12 项测试和 build 全部通过，依赖审计为零已知漏洞。
- 新增 lint 发现两处重抛错误未保留 cause，已修复；用户看到的错误文字未改变。
- 上一轮开发服务器与生产预览的浏览器验证通过，包括持久化、错误恢复、隐藏答案、评分、移动布局与删除；截图为模拟 AI 响应。

## 已知问题与边界

- 没有真实模型验收结果，模拟响应只能证明流程。
- 清除站点数据会丢失题库，目前没有导出或云同步。
- API Key 未加密，保存在此浏览器 localStorage。
- Base URL 对应服务需支持浏览器跨域请求和 JSON 输出。
- 非法主要模式有分类待确认警告；兜底标签不是可信 AI 结论。
- FSRS 的“忘了”可能几分钟后再次到期，不意味着当天永远移出到期列表。
- 之前的受限环境曾导致 Git 登录与 esbuild 扫描失败；当前权限已恢复，GitHub MVP 同步与原生依赖构建均已成功。
- CodeQL 首次扫描产出 1 条告警：`js/clear-text-storage-of-sensitive-data`（high，`src/ai.ts:200`），即 API Key 明文存入 localStorage。已按「已接受的风险（won't fix）」关闭，理由指向本文件的边界说明与 SECURITY.md；不是待修复缺陷。
- 密钥扫描的 `secret_scanning_validity_checks` 与 `secret_scanning_non_provider_patterns` 通过 REST API 无法开启（PATCH 被静默忽略），需在 Settings → Advanced Security 界面确认；不影响主密钥扫描与推送保护。
- 社交预览图没有 API，只能人工上传。
- 分支保护要求 PR 且审批数为 0：这是 solo 仓库的必要选择，否则维护者无法批准自己的 PR，PR 将永远无法合并。
- Actions 的 `allowed_actions` 保持默认 `all`（避免拦住第三方 action）；`default_workflow_permissions` 已是只读，`fork-pr-contributor-approval` 为 `first_time_contributors`。
- 仓库尚无 lint / test / build 的 CI，PR 的状态检查为空。

## 下一步

用户在 AI 设置中填自己的 Key，然后导入一道真实题，检查标题、固定模式、洞察和骨架；刷新确认题库保留，再完成一次评分。记录服务、模型、结果与问题，但不记录 Key。

另外两件需要人工在 GitHub 界面完成的事：上传社交预览图（Settings → General → Social preview，素材已生成）；确认 Advanced Security 里 validity checks 与 non-provider patterns 的开闭状态。

## 如何运行

Node.js 22.13+（22.x）、24.x 或 26+：

```sh
npm install
npm run dev
```

访问 http://127.0.0.1:5173。完整配置与命令见 [README](../README.md)，协作规则见 [CONTRIBUTING](../CONTRIBUTING.md)。

## 10.9 问题修复

修复链接未参与分析、描述必填、导入缺少醒目提示。新增严格算法题确认与有效标题校验，拒绝占位题目。网页请求失败不会用补充文字代替正文，不保存失败结果。读取链接依赖外部 Jina Reader；真实网页可达性与真实模型分类仍需用户环境验证。旧的错误题目不会自动删改。

本轮直接连接 r.jina.ai 的真实网络探测超时；因此不能宣称当前机器已成功读取真实 LeetCode 页面。链接来源、网页错误、模型拒绝、成功提示的测试使用模拟响应。

本轮模拟浏览器回归通过：仅链接按钮可用、401 与非法 JSON 不入库、非算法内容拒绝入库、链接加单字保留网页正文、成功浮层可见、刷新持久化、复习评分、移动布局与删除。更新导入页和移动页截图。


## 2026-10-10 多会话交接准备

本轮按用户要求准备两份独立开发会话任务：备份核心与题库备份界面。总入口为 `docs/handoffs/00-COORDINATION.md`，DSH 小任务独立登记。当前总架构会话负责契约审查、集成验收和公共进度；模块会话不共同编辑 STATUS。

已核对实际工作区 `D:\mydata\myproject\algorhythm`、既有分支 `feature/slice-1-design`、基线 `2418a63` 与 PR #2 的 CI / CodeQL SUCCESS。备份代码本轮未实施。先核心后界面，不新建分支、不合并 PR，不改变用户待决仓库设置。

发现并登记：JSON 日期类型恢复、损坏 Card 的校验缺口、嵌套白名单和预览后本地数据变化。另将过时 CI/架构说明记录为待用户派给 DSH 的小任务。不得把文档准备或既有基线 CI 通过当作备份业务验收通过。

本轮交接文档检查：引用文件存在，git diff --check 通过。现有业务基线本地 lint、format:check、17 项测试和 build 均通过；这些结果不代表尚未实现的备份功能已通过验收。


## 2026-10-10 备份核心合并验收

用户本轮明确授权合并 PR #2。提交 `2ea470d` 已包含备份白名单导出、卡片日期恢复、字段校验、事务恢复与死字段清理。事务内重新读取实际 ID，避免预览快照过期后在 skip 模式覆盖数据。

总架构本轮重新运行 lint、format:check、29 项测试、build：全部通过。GitHub 对 `2ea470d` 的 CI 与 CodeQL 已完成并通过。备份界面尚未实现，本次仅合入工程设施与核心 API，不宣称完整备份功能交付；后续界面继续在 feature/slice-1-design 上接入。

本段替代前文“src 备份尚未实施”的当前状态，历史条目保留。PR 合并状态以 GitHub 回读为准。仓库开关、required checks 与 ESLint/tsconfig 严格度未改；不删除工作分支。


## 2026-10-10 前端工作说明更新

PR #2 已实际合并，GitHub 回读合并提交为 `95a5e10`，CI 与 CodeQL 全绿，工作分支保留。用户将前端交回 Codex，新增根目录 `FRONTEND-HANDOFF.md` 作为新会话入口，纳入 Impeccable、UI/UX Pro Max、Vercel React/组件规范、按需 Figma/imagegen、web-design-guidelines 和临时浏览器验收。

同步修正 UI 交接里的核心等待条件与已关闭 PR #2 引用。当前仍只允许题库备份页面任务，不授权整站改版。此轮仅整理工作说明，未修改 UI、未调用 Figma/imagegen、未进行新的视觉审查或浏览器测试。
