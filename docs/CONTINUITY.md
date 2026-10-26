# AlgoRhythm 会话续接入口

更新：2026-10-26。先读本页，需要细节时再打开对应规格；不用重新阅读全部聊天。

## 当前任务

当前交回[程序员任务 04](superpowers/plans/2026-10-25-programmer-04-manual-practice.md)，规格为 [RFC-03](superpowers/specs/2026-10-25-manual-practice-design.md)。用户手动建题、两端续练和备份 v1/v2 兼容已完成任务范围验证，等待总架构审查。分支 `codex/task-04-manual-practice` 基于 `31e2508`，定义 #24 未合并时以 `codex/task-04-definition` 为 PR base。实际提交与 PR 见 STATUS；不在脏主目录集成。

先读[任务 04 验收](verification/2026-10-25-manual-practice.md)及[结果摘要](verification/2026-10-25-manual-practice-results.json)：本轮 367 项、构建、新旧 Chromium 及 Chrome 稳定版文件闭环已分层记录，受控故障不作真实故障。手动内容始终保留用户来源，不升级为平台事实；真实采集和模型未接入。

任务 03 已获[总架构范围验收](verification/2026-10-25-task03-architect-review.md)。#21 → #22 → #23 的[集成准备](superpowers/plans/2026-10-25-repository-integration-02.md)独立保存，尚未合并；不在脏主目录操作集成。任务 04 从包含其定义的分支隔离开发，不回退到旧 main。

当前[程序员任务 03](superpowers/plans/2026-10-25-programmer-03-submission-correlation.md)已按 [RFC-02](superpowers/specs/2026-10-25-submission-correlation-design.md)完成离线合成关联，[PR #23](https://github.com/harbinresearcher/algorhythm/pull/23) 已交回审查，未合并。先读 [STATUS](STATUS.md)、[本轮验收](verification/2026-10-25-submission-correlation.md)和[来源核查](research/2026-10-25-leetcode-access-boundary.md)。实现分支 `codex/task-03-submission-correlation` 基于定义提交 `c1423b3`；#22 未合并时 PR 暂以 `codex/task-03-definition` 为 base。许可准入仍 unresolved，没有真实采集器或生产入口接入，合成通过不代表 AC-06。

当前[程序员任务 02](superpowers/plans/2026-10-14-programmer-02-backup-restore.md)已按[备份恢复 RFC-01](superpowers/specs/2026-10-14-prototype-backup-restore-design.md)和[ADR-0001](adr/0001-prototype-backup-restore.md)完成合成原型四表备份与非覆盖恢复，[分层验收](verification/2026-10-14-backup-restore.md)已记录，已完成范围审查和实现集成。不自动启动下一功能。任务 01 的[总架构验收](verification/2026-10-14-task01-architect-review.md)原样保留。

2026-10-24 用户授权后，PR #14、#15 已合并，main 为 `605d619`；任务 02 已通过[总架构范围验收](verification/2026-10-24-task02-architect-review.md)。[集成记录](verification/2026-10-24-integration-01.md)说明验证与保留边界。文档交接 #21 和任务定义 #22 未合并，实现分支保留其祖先关系。先核对工作区、分支和未提交改动，不能从旧 main `caac0c1` 或退役 demo 起步。

## 已冻结的方向

- 面向准备实习与校招的普通大学生，尤其是基础弱、刷题吃力的人；不做竞赛、社区和排名。
- 用户专注思考和练习；系统负责安排、辅导和记录。优先培养从条件推导思路的能力。
- 力扣承担日常题库与正式判题；主平台负责安排与历史，轻量侧栏负责当前题目的帮助与采集。
- 可靠资料配合 AI 小步辅导。不要求用户准确诊断卡点，支持“我不会”。
- 用户主动选择完整讲解；查看讲解不算完成，更不算掌握。暂停、结束、判题通过、独立应用分开记录。
- 原始事实与模型判断分开；没有记录到帮助，不等于没有外部帮助。
- 首版完整验收 Python；先做数组与哈希、双指针、滑动窗口、二分查找，约 20–30 题是内容准备预算。
- 一个受控教练流程；每次用户动作最多一次模型请求，不自动重试，不运行用户代码。
- 旧 demo 已按用户要求退役，新工程按批准规格设计。历史代码保留在 Git 归档；没有授权扩大到后端、账户或云同步。
- 首版采用同一扩展内的完整工作台和侧栏，共用扩展来源数据库；后台处理写入，不能依赖其常驻内存。

## 按需阅读

1. [领域与共享契约](superpowers/specs/2026-10-12-v1-domain-contracts-design.md)：实体、状态、权限、跨端接口边界。
2. [教练与学习安排](superpowers/specs/2026-10-12-v1-coach-scheduling-design.md)：完整使用过程、提示与讲解、FSRS 与表现证据。
3. [存储与力扣接入](superpowers/specs/2026-10-12-v1-storage-integration-design.md)：数据归属、采集关联、备份、隐私和故障恢复。
4. [验收与发布](superpowers/specs/2026-10-12-v1-acceptance-release-design.md)：验收编号、评审清单对应关系、验证顺序与待决项。
5. [扩展工作台场景](superpowers/specs/2026-10-12-extension-workspace-design.md)：关闭主页面、后台重启、写入确认和多标签冲突。

四份基线、扩展工作台场景和任务 02 的 RFC-01/ADR-0001 是当前设计依据。2026-10-11 [产品初稿](superpowers/specs/2026-10-11-learning-product-definition-draft.md)保留为历史背景。旧实现契约仅在 [退役归档](DEMO-RETIREMENT.md) 追溯，不再约束新代码；保持已经确认的用户行为与数据边界。

## 下一步从这里继续

交回任务 04 的实现、完整备份及分层证据，等待总架构审查与下一张任务单；不合并 PR，不启动任务 05、采集、模型或 FSRS。当前在线协议 v2、默认备份 v2（继续导入冻结 v1）、数据库布局 v2。旧 action 的 v1 指纹与回执原样保留，旧包不能当作回退方案。任务 03 仍是未被生产入口导入的纯模块；实际提交、PR、检查与未测项见 STATUS。

备份只允许工作台发起，侧栏仍走原学习命令。先等当前草稿确认，再下载或确认导入；其他页面未确认输入不在文件中。选择文件只作本地预览，不写库。相同记录跳过，同 ID 不同内容整份拒绝，不提供强制覆盖或清空库。

导入结果未知时，只自动查一次 backup.query，不自动重发；用户“核实并重试”先查询，确认无回执才用原文件和摘要重试。刷新后可重新选择同一文件核实。成功导入的回执与学习事实一同提交，旧备份重试不能覆盖继续练习后保存的新草稿。

任务 02 的提交、PR 和未测项只看 STATUS。本轮 Chromium 与 Chrome 稳定版文件闭环、真实 IndexedDB 升级和模拟故障已分别记录，不能把模拟或旧证据改称新实测。浏览器产物保留在 `apps/extension/output/task02/backup-browser`；命令和官方加载入口见 [README](../README.md)。原型不能保存唯一一份重要学习记录。

任务 01 的[分层验收](verification/2026-10-13-prototype-acceptance-followup.md)与[总架构验收](verification/2026-10-14-task01-architect-review.md)是上一切片证据：覆盖 Chromium、Chrome 155 稳定版官方页面加载和工作台/原生侧栏最小闭环。首轮记录保留在[历史验收](verification/2026-10-13-extension-prototype.md)，不计入任务 02 的新通过数。

尚未完成：完整领域 schema 与正式备份版本、其他浏览器版本支持矩阵、真实力扣采集、内容许可核查、模型实测、连续试用。原 SC-04/08/09 的真实故障/来源验证仍有缺口，异常退出与未确认输入组合未穷举；任务 02 不自动补齐这些发布门槛。不需要再问用户是否认同已冻结方向。

## 保存与续接约定

- 当前进度与实际检查只维护在 [STATUS.md](STATUS.md)；本页只保留方向、入口和下一动作。
- 每完成一段工作，更新相应规格、STATUS 和必要的续接指针；记录决定、理由、替代方案、证据边界。
- 新决定引用规格条款或验收编号；旧决定被替代时注明原因，不让两份冲突说明同时有效。
- 文档与代码按仓库规则检查、提交、推送；用户对 #14、#15 的合并授权已完成，不延伸到文档 PR、仓库设置或后续功能。不扩展到采集、模型、FSRS、云端或付费调用，后续功能等待独立任务。
- 给用户解释时用具体使用过程和短句；工程细节留在规格，不再要求用户逐条裁决技术问题。
- 本地记忆只保存本入口与偏好等短索引；仓库文件是其他 Agent 也能读取的持久依据。不能承诺所有新会话自动加载本地记忆。
