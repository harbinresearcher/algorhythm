# 仓库管理任务 01：集成已验收原型

> **For agentic workers:** 使用 executing-plans 按项完成；不启用并行实现。合并步骤仅在用户明确授权合并 PR #14、#15 后执行。

**Goal:** 将已验收的工作台、侧栏与备份恢复集成到 main，保存可追溯证据。

**Architecture:** PR #14 基于 main，PR #15 基于 #14 的原型分支。用 merge commit 保留祖先关系，先 #14、后 #15；不 squash、不 rebase、不强推。

**Tech Stack:** Git、GitHub、Node.js、现有扩展检查脚本。无新依赖。

## 边界与核查快照

2026-10-24 实时查询：

- #14 OPEN、可合并，head `f2f3e3f1a4a999803a1ce1a67336628980a7ac68`，base main `caac0c1a6740e986eb5b0b32f5d519a159a6e6ac`。documentation and extension、CodeQL 及两个 Analyze 检查通过。
- #15 OPEN、可合并，head `781e730a6ef8ce3e9887c0e847866a21131440a4`，base `feat/extension-storage-prototype`。documentation and extension 通过；不据此宣称存在其他扫描结果。
- 仓库允许 merge commit，自动删除分支关闭。本任务不调整任何仓库设置、不删除分支。
- 范围验收见[任务 01](../../verification/2026-10-14-task01-architect-review.md)和[任务 02](../../verification/2026-10-24-task02-architect-review.md)。不是正式产品发布。
- 此快照不能替代合并前复查。任一 head 改变，先审新增差异，不能套用旧验收。

## 文件与工作区

- 先读 AGENTS、CONTINUITY、STATUS 和两份审查记录。
- 不在总架构主目录 checkout、reset 或 pull：该目录有未提交架构文档。
- 不覆盖程序员工作树。集成后用独立、干净工作树检查远端 main。
- 新建 `docs/verification/2026-10-24-integration-01.md` 记录实际合并提交、检查输出和未测项。
- 选择性纳入本任务单与任务 02 架构审查；只合并 STATUS、CONTINUITY 的新增事实，不整份复制总架构目录的历史版本。
- 应用源码、manifest、数据库和依赖不属于本任务修改范围。若发现故障，保存复现并交回编码会话。

## 步骤一：授权后合并 #14

- [ ] 重新读取两个 PR 的 head/base、检查、评审意见和未解决讨论。出现失败、待处理检查或阻断评审则停止合并。
- [ ] 用 merge commit 合并 #14，操作绑定已审 head；不管理员绕过、不启用自动合并。
- [ ] 查询 PR 状态确认为 MERGED，记录实际 merge SHA；不能把 mergeable 或预生成 merge SHA 当作已合并。
- [ ] 保留原型分支，供 #15 转换基底。

## 步骤二：转换并合并 #15

- [ ] 将 #15 的 base 改为 main。重新检查差异只包含备份任务及其交接，没有把原型作为重复变更带入。
- [ ] 确认 head 仍为上述 `781e730...`，且 main 包含 #14 head；若不成立，停止，不自动 rebase。
- [ ] 等基底变更后的适用检查完成。若无新检查，核对现有 workflow 触发条件并在当前合并候选上补运行既有验证；不得仅引用旧 base 的绿灯。
- [ ] 检查通过后用 merge commit 合并 #15，同样绑定已审 head。
- [ ] 查询实际 MERGED 状态与 merge SHA，记录 main 是否包含两个已审 head。

## 步骤三：验证集成结果

- [ ] 在新的干净工作树检出远端 main，记录 SHA。
- [ ] 根目录运行 `node scripts/check-docs.mjs`、`git diff --check`，分别确认退出码为 0。
- [ ] 在 `apps/extension` 运行 `npm ci`、`npm test`、`npm run build`；应通过现有 179 项测试。失败不删断言、不改通过标准。
- [ ] 比较集成树的应用源码、锁文件、构建配置与已审 #15。完全相同则记录既有浏览器证据适用范围，不声称重跑浏览器；存在运行相关变化则交回审查并补对应浏览器验证。
- [ ] 写集成记录，更新该分支 STATUS、CONTINUITY，保留 SC-04/08/09、真实故障和支持矩阵缺口。
- [ ] 文档用单独 `codex/integration-01-handoff` 分支、`docs:` 提交及 PR 交付，不混入其他本地草稿。该文档 PR 不在本次两个实现 PR 的合并授权内。

## 停止点与下一阶段

交付两个实际 merge SHA、集成检查、文档 PR 和未测边界后停止。不自动删除分支或发布扩展。

后续产品工作优先明确真实力扣接入的许可边界及题目—代码—判题关联证据，再设计最小接入实验。此处仅确定顺序，不授权采集、账号访问、扩展权限或模型调用；任务 03 由总架构另行给出。
