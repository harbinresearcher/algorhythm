# 程序员任务 02：原型备份与原子恢复

> 执行角色：主力编码会话。使用 `executing-plans` 分项推进。总架构只提供契约与验收，不代写应用实现。工程取舍已由用户授权总架构处理，无需重新询问是否认可本方向。

**目标：** 让现有合成练习能够下载为可校验备份，并在不覆盖已有学习记录的前提下原子恢复。

**架构：** 继续采用同一扩展来源 IndexedDB、后台主写入。新增共享备份 schema、备份核心和工作台管理入口；数据库仅新增导入回执表。

**技术栈：** 当前锁定的 React 18、TypeScript、Vite、Dexie、Zod、Vitest、Playwright；不引入新的运行时依赖。

## 先读与分支

1. 当前工作树的 AGENTS、CONTINUITY、STATUS。
2. [RFC-01](../specs/2026-10-14-prototype-backup-restore-design.md)是本任务文件格式、权限和行为的单一依据。
3. [ADR-0001](../../adr/0001-prototype-backup-restore.md)明确非覆盖策略、增加回执表及回退限制。
4. [任务 01 验收](../../verification/2026-10-14-task01-architect-review.md)说明上一阶段完成范围。

已核实基线：`feat/extension-storage-prototype` 的 `f2f3e3f1a4a999803a1ce1a67336628980a7ac68`。PR #14 未合并时不继续往该分支追加备份功能。按 `using-git-worktrees` 创建独立工作树和 `feat/prototype-backup-restore` 分支，从此提交开始；发现分支已存在先核查，不覆盖。

若 PR #14 尚未合并，任务 02 的 PR 暂以 `feat/extension-storage-prototype` 为 base，明确依赖 #14；若已合并，核实 main 包含相同实现后再选择 main。不得为了开工自行合并 #14、重写其历史或调整仓库设置。

架构文件目前位于 `D:/mydata/myproject/algorhythm`。将本任务单、RFC-01、ADR-0001 和任务 01 总架构验收原样纳入新分支。不要复制此主目录整份 STATUS/CONTINUITY，它们还保留 main 历史基线；在新分支现有入口上增量更新。

## 约束与交付边界

- 本次授权数据库 1→2 的加表迁移及三个 backup 消息；原学习协议 v1 和业务行为不变。
- 所有学习数据四表与成功导入回执同事务；同 ID 不同内容整份拒绝，无强制覆盖和删除。
- 不实现尚不存在的正式提交、提示、FSRS、计划或模型表；不接力扣、模型、云端或内容脚本。
- 不安装框架、不升级依赖、不改主题；沿用现有组件与 CSS。
- 不添加权限。只操作独立测试配置中的合成数据，不读个人浏览器资料或实际学习备份。
- 步骤注释与开始/结束日志沿用仓库规则，日志只含动作/备份 ID、错误码及计数，不记录文本或文件内容。
- 测试先写失败证据再实现。下方任务顺序为依赖关系；不得用最后的文档更新替代中间验证。

## 文件职责

- 新增 `apps/extension/src/shared/backup.ts`：文件与三个消息的运行时 schema、推导类型、限制和备份错误码。复用 protocol 的学习 schema，不反向制造循环依赖。
- 新增 `apps/extension/src/core/backup.ts`：纯验证、规范化、摘要、四表快照导出与原子导入。函数允许拆分，但不做通用插件框架。
- 修改 `apps/extension/src/core/store.ts`：数据库增加 backupImports；只做备份所必需的复用。backup 核心可依赖 Store/数据库，Store 不反向依赖 backup 核心。
- 必要时新增 `apps/extension/src/core/source.ts`：从 Store 抽出已有 sender 检查，供学习和备份入口共同使用。原允许列表不放宽；备份再限工作台。
- 修改 `apps/extension/src/background.ts`：分派备份消息与原学习消息，统一脱敏失败返回。
- 新增 `apps/extension/src/client/backup.ts`：运行时回执验证、30 秒等待、按 backupId 核实与手动重试。
- 新增 `apps/extension/src/ui/BackupPanel.tsx`，小幅修改 `ui/main.tsx` 和必要的 `style.css`：文件下载/读取、预览、确认、进度和恢复提示。
- 新增 `apps/extension/tests/backup.test.ts`、`tests/backup-client.test.ts`、`tests/backup-migration.test.ts`、`scripts/backup-browser-check.mjs`；按实际需要放合成 fixture 到 `tests/fixtures/backup-v1.json`。
- 修改 `apps/extension/package.json` 只增加 `check:backup-browser` 脚本；无需改依赖锁文件。
- 新增 `docs/verification/2026-10-14-backup-restore.md` 和脱敏结果 JSON；更新 README、ARCHITECTURE、STATUS、CONTINUITY、ROADMAP 中受本任务影响的条目。

上述文件结构是职责建议。若发现必须改学习协议版本、原表结构或覆盖策略，停止相关改动并给出具体证据；不要自行猜测。

## 任务一：文件契约与纯校验（BK-01/04/07/08）

- [ ] 记录干净基线，先运行既有单测和构建。保存本轮日志，不继承任务 01 的数量。
- [ ] 用实际 Store 创建两个会话：一个 active，一个 paused；包含中文、Python、多次尝试及未形成尝试的已保存草稿。固化为合成 fixture，保留原动作 ID。
- [ ] 新增失败用例：10 MiB/记录数边界、非法 JSON、未知版本/字段、重复 ID、悬空引用、revision 缺号、错误状态转换、伪造回执、不同 extensionId。每例单独断言错误类别，不能只断言 throws。
- [ ] 定义 shared/backup 的严格 schema 与推导类型，明确学习 WriteCommand 与管理消息不混用。
- [ ] 完成 B-03 关系/回执链校验，以及 B-04 排序、摘要和目标扩展指纹规范化。校验不调 Store.handle，不修改数据库。
- [ ] 对同对象键顺序和 data 数组排列变化断言摘要相同；学习文本改变断言摘要不同。时钟回拨但 revision 合法应通过。

验证：`npm test -- tests/backup.test.ts`。重点证明“JSON 格式合法但事实关系错误”仍会拒绝。没有教学效果或真实平台数据结论。

## 任务二：一致快照、加表迁移与事务恢复（BK-01/02/03/05/06/07/08/09）

- [ ] 在 backup-migration.test.ts 用旧 v1 stores 定义建立真实布局的测试库，写入四表及 diagnostics，关闭后由新 Store 打开。先验证尚无 v2 回执表的失败，再实现仅加表升级。
- [ ] 为原子导入建立失败用例：在最后写回执时注入 AbortError 和 QuotaExceededError，比较事务前后四表和 backupImports，必须全部不变。
- [ ] 实现导出一致只读事务；白名单构造、验证、序列化放在正确阶段。模拟并发保存，断言只能得到完整前态或后态。
- [ ] 实现导入前验证、extensionId 规范化、摘要核对；在一个五表读写事务中先查回执、再核对冲突、插入缺失行和回执。事务内不等待文件、WebCrypto 或网络。
- [ ] 测试首次导入后继续写新草稿，再导同文件，回执相同且新草稿保留；修改同 backupId 文件拒绝。不同 backupId 但同数据应只新增导入回执，不重复学习事实。
- [ ] 测试无关会话补入；同 ID 同内容跳过；一处冲突连同其他新会话全部不写。预览后模拟另一 Store 写入同数据库，结果仍完整。
- [ ] 重开数据库后查询已导入回执；模拟首次响应丢失，再试不重复。验证跨扩展 ID 导入后原动作 queryAction、同命令重发与冲突命令的行为。
- [ ] 测试 v1→v2 内容不变、升级失败不清库，以及旧 v1 代码访问 v2 的不兼容路径。任何 VersionError 均不得走删除/重建兜底。

验证：全部单测与 `npm run build`。fake-indexeddb 结果标为模拟；BK-09 还需浏览器真实 IndexedDB 证据，不能到此勾选全部通过。

## 任务三：消息与失败恢复（BK-06/11）

- [ ] 先写 backup-client.test.ts：错 actionId、错 backupId、错摘要、非法 schema、超时及 send 拒绝均不能显示成功。
- [ ] 新增后台备份分派；只允许通过浏览器 sender 验证的顶层 workspace.html。测试侧栏、普通网页、其他扩展、子框架和伪造消息角色均拒绝。
- [ ] 新增备份客户端。首次 import 传输异常只查询，不自动重发；手动恢复先查，null 后才重发。计数断言区分 import 调用与 query 调用。
- [ ] 不把 backup 消息混入现有 learning commandSchema 或 committedSchema，避免破坏19项原测试的语义；必要的公共信封可导出复用。
- [ ] 状态未知时保留已确认的文件与摘要；重新选择相同文件可恢复；查询不到不等于之前必然失败。

验证：`npm test -- tests/backup-client.test.ts`，再跑完整单测与构建。权限单测不冒充真实网页攻击测试。

## 任务四：工作台最小界面与浏览器闭环（BK-01/02/03/09/10/11）

- [ ] 在现有工作台加入 BackupPanel，备份动作复用/协调当前 guarded 锁和 DraftController.flush。操作期间防止当前页面换题及重复确认；不能以 UI 锁替代数据库事务。
- [ ] 下载用现有 Blob/对象 URL 模式，完成后释放 URL；读取用文件选择器。侧栏不加载管理功能，只提供工作台入口。不添加扩展权限。
- [ ] 预览显示来源、版本、时间、记录数、非覆盖规则和“仅已保存数据”；取消或换文件不写库。输出文件名和来源字段仅作文本展示。
- [ ] 新增独立浏览器脚本与 `npm run check:backup-browser`。使用临时配置完成：建数据、实际下载、空库恢复、继续练习、重复导入、冲突整份拒绝、非法文件、取消、刷新和重启恢复。空库由另一临时配置提供，不在正常产品里加清库入口。
- [ ] 同脚本补真实 IndexedDB 的 v1→v2 升级结果及来源限制。测试专用页面或夹具不能进入发布 manifest/dist；不能为了制造攻击面给正式扩展新增权限。
- [ ] Chrome 稳定版使用官方加载方式和临时配置，至少实测下载→另一个测试配置导入→刷新续练及冲突提示；记录版本和原生侧栏仍可用。可沿用任务 01 的手工步骤，不使用个人登录档案。
- [ ] 查看截图，确认键盘可完成文件选择后预览/确认/取消，状态与报错可读；只修本任务引入的问题，不重做视觉。

浏览器每个断言都要说明具体覆盖 BK 编号；留存实际下载的合成文件用于 round-trip 比较。真实配额耗尽、中途杀进程等未做则明确记录，不耗尽宿主磁盘。

## 任务五：交付与停止点

- [ ] 在 apps/extension 运行 `npm test`、`npm run build`、`npm run check:browser`、`npm run check:backup-browser`。在根目录运行 `node scripts/check-docs.mjs`、`git diff --check`，逐项核对退出码。
- [ ] 验收记录逐项列 BK-01 至 BK-11 的单元、模拟、真实浏览器证据和未验证边界。包含数据库/备份版本、基准提交、升级和回退演练、来源限制与重试行为。
- [ ] STATUS、CONTINUITY 说明本切片仅覆盖合成原型四表，不宣称模型、FSRS 或正式学习记录已有完整备份。保留 SC-04/08/09 等旧缺口。
- [ ] 发布前检查 diff 没有新权限、秘密、个人备份、浏览器配置或测试入口进入生产包。新增表只为持久化导入结果，不夹带领域扩张。
- [ ] 使用 `feat:`/`test:`/`docs:` 提交可验证工作，推送新分支并建立独立 PR；遵守上文 base 规则，不合并 #14 或本 PR。
- [ ] 提供提交、PR、实际验证、未测项。稳定版闭环受阻或任一必须项失败时保持 Draft，写清阻碍，不删断言或改称通过。

任务完成即交回总架构，不自行开始真实力扣、教练、FSRS 或扩展权限工作。若实际代码证明契约互相矛盾，只报告具体条款与复现，不用扩大范围绕过去。
