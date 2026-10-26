# 架构入口

旧 demo 已退役。`apps/extension` 是按新设计编写的练习记录原型，保留合成演示并支持用户手动记录；产品设计以以下文件为准：

- [领域与共享契约](superpowers/specs/2026-10-12-v1-domain-contracts-design.md)
- [教练与学习安排](superpowers/specs/2026-10-12-v1-coach-scheduling-design.md)
- [存储与力扣接入](superpowers/specs/2026-10-12-v1-storage-integration-design.md)
- [验收与发布](superpowers/specs/2026-10-12-v1-acceptance-release-design.md)
- [扩展内工作台与侧栏](superpowers/specs/2026-10-12-extension-workspace-design.md)
- [合成原型备份与恢复 RFC-01](superpowers/specs/2026-10-14-prototype-backup-restore-design.md)
- [备份决策 ADR-0001](adr/0001-prototype-backup-restore.md)
- [手动建题与练习 RFC-03](superpowers/specs/2026-10-25-manual-practice-design.md)：当前在线 v2、混合来源与备份版本边界。

首版部署选择：完整工作台与侧栏均为同一 Chrome 扩展中的页面。应用核心不依赖 UI，扩展后台负责命令校验及数据库写入，数据保存在扩展来源的 IndexedDB。未来力扣内容脚本仅提供授权观察，不持有 Key 或写入权限；当前原型没有内容脚本或真实采集。

理由：关闭主页面后仍可保存，避免首版同时维护网站数据库、扩展数据库和双向同步。

当前原型使用 React 18、TypeScript、Vite、Dexie、Zod，版本固定在 package-lock 中。简单界面使用本地 CSS；Tailwind 与 ts-fsrs 不因旧技术列表而提前安装，后续页面与复习功能需要时再引入。

```text
[工作台 / 侧栏] ── 学习消息 ── background ── core/store ── 四张学习表

[仅工作台] ── 备份管理消息 ── background ── core/backup-handler
                                                │
                                           core/backup ── 四张学习表 + backupImports
```

- `src/shared/protocol.ts`：在线 v2 严格 schema、推导类型、synthetic/manual 来源 union、两道合成演示题。
- `src/shared/legacy-protocol.ts`：逐字冻结的历史 v1 契约，只供备份回放，不用于在线降级。
- `src/shared/manual-problem.ts`：UI 和核心复用标题/链接规范化；先检查原字符串再解析 URL，不访问网站。
- `src/core/source.ts`：复用原学习来源检查，备份进一步限定为 workspace.html，不扩大原白名单。
- `src/core/store.ts`：协议版本、题目引用、状态、revision；一个事务内记录事实和原回执。核心无 React 或 chrome 全局依赖。
- `src/client/draft.ts`：编辑代次、500ms 保存、串行确认、保留失败内容。
- `src/client/transport.ts`：响应校验、5 秒超时、先查询丢失回执；写请求不自动重发。
- `src/shared/backup.ts`：独立文件、三个管理消息和导入回执的严格 schema，复用学习记录 schema 并收紧限制。
- `src/core/backup.ts`：纯关系校验、规范摘要、四表一致快照、非覆盖原子导入和持久回执查询。
- `src/core/backup-handler.ts`：先验证浏览器 sender、协议与实例，再校验备份文件并调用核心；只返回脱敏错误。
- `src/client/backup.ts`、`src/ui/BackupPanel.tsx`：任务 02 的工作台入口，负责本地预览、确认、下载及未知结果核实；具体接入与验收状态见 STATUS。
- `src/background.ts`：同步注册监听，分开学习命令与 `backup.*` 管理消息；工作台关闭与后台休眠不改变数据归属。

在线学习和备份消息统一为 protocolVersion=2，WriteCommand 仍不包含管理命令。数据库名保留 `algorhythm-prototype-v1`，布局仍为版本 2 的原六表和索引，本任务不做迁移或数据重写。会话保存当前草稿，事件保留历史事实，actions 保存请求指纹与原回执；旧 v1 指纹和 committed 内容保留。诊断仅存合法动作 ID、错误码和时间；标题、链接、文本、指纹和底层异常不进日志。原型没有账号、模型 Key 或外部网络权限。

startManual 在现有四表事务内写固定 manual-user-v1 快照、空草稿 active 会话、manual-workspace started 事件及回执。标题/URL 必须已规范，后台不静默修改指纹；其余写入从实际题目快照核对归属并推导事件来源。UI 用实际快照展示标题和来源，缺快照显示数据错误。手动内容不能成为平台事实，不接入任务 03 的合成关联模块。

```text
[工作台表单] ── 共享规范化 ── guarded / 草稿 flush ── startManual
                                                       │
                                        Store 既有四表事务与回执
                                                       │
                                       工作台 / 原生侧栏继续编辑
```

## 备份边界与事务

文件版本独立于数据库和在线消息。默认 formatVersion=2、scope=`practice-records-v2`，只含 problems、sessions、events、actions，显式白名单保留手动标题、来源和 URL。继续导入旧 v1/prototype-storage-v1，仅接受旧合成记录和 legacy v1 命令；v2 允许混合 v1/v2 历史动作，但任何 v1 动作都不能描述 manual。其他版本与 scope 交叉组合拒绝。导出不包含 diagnostics、backupImports、配置和凭据，不删掉手动记录来生成旧版文件。文件最多 10 MiB，其余数量和字段边界继承 RFC-01。

导出在一个只读事务内读取四表，事务外校验与排序。校验按 revision 纯计算每步命令、事件和回执，不通过 Store.handle 重放。摘要覆盖原始 source 和完整 envelope：对象键排序，四表按 ID 排序后计算 SHA-256；哈希与文件操作都不放进 IndexedDB 事务。

导入先校验并在转换前按原文件格式计算、核对预览摘要，再按每条历史动作对应的 v1/v2 解析器转换 extensionId；不改变协议版本、来源、标题、URL 或其他事实。一个读写事务覆盖四张学习表和 backupImports：先查已有导入回执，同摘要返回原结果，不同摘要拒绝；再严格核对目标同 ID 行，内容相同跳过，不同则整份冲突；最后只添加缺失行与成功回执。不删除、不 upsert、不合并同一会话的不同 revision。预览后其他页面继续写入也由同一事务复核。

同 ID 行比较之外，事务还核对受影响题目快照的现有所有者，以及会话中已有事件和动作的身份。两份文件各自合法，也不能借新 ID 共用快照或混入另一套历史；有一处关系冲突就整份拒绝，不能补入其他新会话。此检查不把目标数据库整体套入单份文件的大小或记录数上限。

只有工作台可发起 export/import/query；侧栏、子框架、内容脚本、普通网页和其他扩展均不能管理备份。学习命令仍允许原工作台与侧栏。导入的历史 action 只作为事实和幂等回执保存，不注册或执行新任务，也不增加权限。

备份客户端单次等待 30 秒，校验响应类型、actionId、backupId 和摘要。传输失败或非法响应视为结果未知，只自动查询一次持久回执，不自动重发导入。“核实并重试”先查询，确认没有回执才用原文件和摘要重试；刷新后可重新选择同一文件核实。成功回执与学习事实同事务保存，后台重启不会丢失；重导旧文件不能覆盖恢复后新写的草稿。

当前 read 返回整个原型快照，覆盖合成演示和手动记录；正式学习记录增长前需增加分页、索引与保留策略。当前备份不覆盖尚未实现的正式提交、帮助、FSRS、计划或模型实体，不能称为正式产品完整备份。任务 04 的版本兼容、手动记录和本轮 Chromium/稳定版文件闭环见[验收记录](verification/2026-10-25-manual-practice.md)；任务 02 的[历史验收](verification/2026-10-14-backup-restore.md)保留。集成状态见 STATUS。内容采集、模型和学习效果均未验收。

数据库回退不得删库重建或自动降库。旧代码若不兼容必须停止，不能当作空库；回退路径采用仍支持 v2 的修复版本，或在独立合成配置中验证过的导出/恢复流程。

旧架构只在 [退役记录](DEMO-RETIREMENT.md) 指向的历史版本中追溯。
