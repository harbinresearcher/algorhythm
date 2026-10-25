# 仓库管理任务 02：依赖集成准备

日期：2026-10-25。准备已完成；执行合并须用户明确授权。此文件不构成合并授权。

## 已核对的依赖

- #21：main ← codex/integration-01-handoff，head `e09236240c9bb57fb9d79078545eedcff70ae484`，文档交接。
- #22：codex/integration-01-handoff ← codex/task-03-definition，head `c1423b343f5a30c8a5745f03c74e6f8059fadb77`，任务 03 定义。
- #23：codex/task-03-definition ← codex/task-03-submission-correlation，head `4a20c9cea3a73cf6f9408465c519953ebc59377c`，离线关联实现。

本次三者均 OPEN、mergeStateStatus=CLEAN。任务 03 的[范围审查](../../verification/2026-10-25-task03-architect-review.md)通过；这不是自动合并条件。#21/#22 是文档变更，#23 对发布包无变化。

## 授权后的顺序

1. 复查各 head、CI、评审线程和当前 main；提交变化先审新增差异。保留主目录及其他工作树未提交文件。
2. 以 merge commit 合并 #21，绑定预期 head。查询 MERGED 及实际 merge SHA，不删除依赖分支。
3. 将 #22 转向 main，检查差异仍只有任务定义，验证变更基底的合并候选和适用检查，再 merge commit 合并。
4. 将 #23 转向 main，检查差异仍限任务 03；在独立工作树运行 272 项测试、构建、文档与空白检查，检查发布文件与基线一致。全部通过后 merge commit 合并。
5. 对实际 main 核对三个 head 均为祖先，记录实际 merge SHA、检查和未测边界。不能用旧 base 的 CI 冒充新候选；若没有新 CI 则补跑既有检查。

不 squash、rebase、强推、绕过保护、改设置或删除分支。遇失败停止依赖链，不把后续 PR 越过失败项合入。任务 04 定义及实现 PR 不包含在上述三个 PR 的授权中。

## 编码是否必须等合并

任务 04 可按自己的任务单在定义分支上建立独立工作树，不修改上述三个 PR。这样产品工作可继续；集成时仍保留真实依赖。不要为免除合并等待而把全部文件复制到旧 main 或另造无共同祖先的分支。
