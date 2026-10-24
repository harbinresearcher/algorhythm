# RFC-01：合成存储原型的备份与恢复契约

日期：2026-10-14。状态：总架构已确定，待程序员实现与验收。基线 `f2f3e3f`；对应 D-03、S-04、S-05、AC-07/08。[决策理由](../../adr/0001-prototype-backup-restore.md)。不扩大现有产品范围，不将本切片称为正式产品完整备份。

## B-01：用户行为

完整工作台增加“备份与恢复”区域。侧栏只提供打开工作台的入口。

导出时先等待当前工作台草稿确认；失败则停止完整备份，保留现有“导出草稿”。后台导出一个一致的已提交快照。其他窗口尚未确认的输入不在备份内，界面必须说明。生成文件后提示“备份已生成，请确认文件已下载”，不声称浏览器已经写到用户磁盘。

导入顺序：选择文件 → 本地验证 → 显示来源版本、导出时间、各类记录数和导入规则 → 用户点击“确认导入” → 后台重新验证并原子提交 → 重新读取工作台。选择文件不写库。更换文件作废旧预览；请求未确定时不允许改换文件或启动另一笔导入。

确认文案说明：“仅补入缺失记录。相同记录跳过；发现同 ID 内容不同，则整份不导入。不会覆盖已有学习记录。”不提供隐藏的强制覆盖或清空库按钮。

导入前同样等待当前工作台草稿确认。其他页面可以继续写；事务必须处理预览后的变化。成功后其他页面通过已有“更新记录”读取，不自动切题、不覆盖内存草稿。冲突恢复仍可复制或导出未保存文本。

## B-02：文件格式与覆盖范围

文件为 UTF-8 JSON，无压缩、无加密，不自动上传。扩展名 `.json`，建议文件名 `algorhythm-prototype-backup-<UTC时间>.json`。界面说明文件含思路和代码，需要自行保管；不称为匿名数据。

顶层严格字段：

- `format`：固定 `algorhythm-backup`。
- `formatVersion`：整数 1。
- `scope`：固定 `prototype-storage-v1`。
- `backupId`：UUID，每次生成导出新建；同一文件重试保留。
- `exportedAt`：非负安全整数，UTC epoch 毫秒。
- `source`：严格对象，只有 `appVersion`（非空，最多 64 字符）和 `extensionId`（32 位小写 a–p）；只作来源信息，不能授权。
- `data`：严格对象，只有 `problems`、`sessions`、`events`、`actions` 四个数组。

各数组复用现有 protocol 中的记录 schema，收紧备份边界所需的长度与数值限制，不复制 UI 专用类型。actions 保留现有 `{id, fingerprint, result}`；fingerprint 必须能解析为当前五种学习写命令之一，不能是 read、queryAction 或备份命令。不可把任意字符串或未知字段默默带入文件。

覆盖已保存草稿、active/paused 会话、尝试和其他原始事件、题目快照、学习动作成功回执。不含 diagnostics、backupImports、Key、配置、浏览器资料、未确认草稿和失败请求的内存状态。未实现的提交、帮助、FSRS、计划、模型判断不存在于本版本，不造空表冒充支持。

大小上限：文件 10 MiB（10 × 1024 × 1024 字节），在读取文本前检查 File.size；后台检查序列化 JSON 的 UTF-8 字节数，不信任页面报数。每份最多 1,000 个 problems、1,000 个 sessions、10,000 个 events、10,000 个 actions。题目标题最多 200 字符，题干最多 32,000 字符，事件文本和每个草稿最多 32,000 字符；fingerprint 最多 256,000 字符。所有时间戳、revision 必须为非负安全整数。空备份允许。

导出使用显式白名单构造，随后校验；遇未知版本或损坏数据失败，不截断、不“修好”原始记录、不输出半份文件。导入遇未知字段拒绝。白名单防止系统凭据字段混入，不扫描或篡改用户自己写在学习文本中的内容。

## B-03：一致性验证

文件、后台消息和数据库都是独立边界。后台必须重新进行 schema 与关系检查；页面预览通过不是授权凭证。校验应使用索引 Map，避免全数组两两遍历。

1. 每张表 ID 唯一；允许同一 UUID 按当前约定同时作为 event.id、event.actionId、action.id。重复行即使内容相同也拒绝输入文件。
2. 每个 session 指向存在的 problem，problemKey 与 problem.key 相符；当前切片每个快照只属于一个 session，不接受悬空快照。
3. event 的会话和题目引用一致；每个事件有且只有一个 action，二者 actionId/id 一致。每个会话 revision 从 0 连续到 session.revision，不缺号、不重复。
4. 按 revision 验证动作及回执链：start 对应 started 和 revision 0；后续命令 expectedRevision 对应前一条；saveDraft、recordAttempt、pause、resume 对应各自事件与 active/paused 转换。每份回执 session 等于该步动作得到的快照；末条等于导出的当前 session。
5. recordAttempt 文本等于该步已保存草稿且非空；draft 事件文本等于 saveDraft.text；其他事件不携带 text。题目、会话 ID、problemKey、createdAt 在链中不变；updatedAt 与对应事件 at 一致。系统时钟可回拨，不能要求时间戳严格递增，事件顺序只用 revision。
6. fingerprint 解析后用共享命令 schema 验证，其 extensionId 必须等于 source.extensionId，协议版本为 1，ID 与事件/回执相符。备份不能夹带新的可执行任务。验证链仅作纯计算，不通过 Store.handle 重放，不调用模型或生成新事实。

单份文件可以被人编辑；关系校验和摘要不能证明作者身份或平台真实性。导入只恢复已声明为 synthetic 的记录，不赋予正式判题或掌握证据。

## B-04：导出与导入事务

导出在一个只读事务中读取四张学习表，事务外进行关系检查、排序、序列化和摘要。输出对应同一时点；允许同时发生的写入排在快照之前或之后，不混合两版。大于上限返回明确错误，不删记录来适配上限。

导入准备阶段：完整验证文件，再把学习动作 fingerprint 中的 extensionId 转换为目标扩展 ID，用现有命令 schema 解析输出的固定字段顺序重新 JSON.stringify。其余协议字段、所有 ID、时间和学习内容不改。这是本地路由元数据转换，不是改写原始学习事实；直接发送的旧 extensionId 命令仍返回 INSTANCE_MISMATCH。

一个读写事务覆盖 problems、sessions、events、actions、backupImports：

1. 先查 backupId 导入回执。同摘要返回原结果，不重做；不同摘要返回 BACKUP_ID_COLLISION。
2. 逐表比较目标同 ID 记录与准备后的记录。规范化对象键顺序、忽略对象属性排列差异；字符串内容和数组语义不得模糊比较。同内容跳过；有一条不同则整份 BACKUP_CONFLICT。
3. 只插入缺失记录，并同时插入成功回执。事务结束后才回复成功。不删除、不 upsert 覆盖现有事实，不尝试合并同一会话的不同 revision。

历史 actions 在目标库的 fingerprint 同样用解析后规范表示比较。目标记录自身不合法时返回失败，不能通过导入掩盖损坏。

导入回执为严格对象：`backupId`、`digest`、`sourceExtensionId`、`exportedAt`、`importedAt`、`added`、`skipped`。backupImports 主键为 backupId；digest 是 64 位小写十六进制；两个时间为非负安全整数；added/skipped 各为 `{problems, sessions, events, actions}` 四个非负安全整数计数。回执是操作元数据，不导出，不记录学习文本。即使后来继续练习，再次确认同 backupId 和摘要也只返回原导入结果，不能恢复旧草稿。

回执存在性是重试依据；摘要是规范 JSON 的 SHA-256（对象键按字符排序，四个 data 数组按 id 排序），涵盖完整顶层数据，不依赖文件空白或属性顺序。数组内部重复 ID 先拒绝。哈希计算与文件解析在事务外；不在事务里等待 WebCrypto、文件或网络。

预览后其他页面写入也必须安全：复核冲突和写入位于同一事务；仅页面锁不算保护。事务失败时四表与成功回执全部回滚。允许另行记录脱敏错误，但 diagnostics 写失败不能循环重试。

## B-05：共享消息与权限

保留学习命令协议 v1。新增独立、同源的 backup schema 和以下三个消息，沿用 protocolVersion、extensionId、actionId 信封：

- `type=backup.export`：无额外参数；响应为 `{ok:true, kind:'backup.exported', actionId, backup}`。
- `type=backup.import`：携带 backup 对象和预览确认的 `expectedDigest`（64 位小写十六进制）；响应为 `{ok:true, kind:'backup.imported', actionId, receipt}`。后台自己计算并核对摘要。
- `type=backup.query`：携带 backupId 和 expectedDigest；响应为 `{ok:true, kind:'backup.status', actionId, backupId, digest, receipt}`，digest 回显验证后的 expectedDigest，receipt 可为 null；存在同 backupId 不同摘要时返回碰撞错误。

失败响应为 `{ok:false, actionId, code}`；无法解析合法请求 actionId 时该字段为 null。上述所有对象用严格 schema 定义，成功与失败类型均由 schema 推导。

所有响应带原 actionId；客户端检查类型、actionId、backupId 和摘要。备份允许整个工作台页面发起；侧栏、内容脚本、普通网页、其他扩展、子框架均不得导出或导入。后台复用原来源检查，进一步限定 workspace.html；不相信消息自报角色。不得新增 host_permissions、downloads、storage、externally_connectable 或网络权限。

成功导入备份里的 action 不能注册成可执行消息。旧学习 WriteCommand、queryAction 与 committed 响应语义保持不变；不得因增加 backup 消息而让原先 Exclude 类型误把管理命令归入学习写命令。

备份客户端单次等待 30 秒。传输失败或响应非法视为结果未知；只查一次 backup.query，不自动重发 import。查到成功显示原结果，查不到或查询失败仍保留未知状态。用户点“核实并重试”先查询，确认没有回执后才用原 backupId、同一文件和摘要重发。页面刷新只丢内存预览；重新选择原文件可核实和重试，不依赖 worker 内存会话。

## B-06：错误、兼容与回退

备份错误码：BACKUP_INVALID、BACKUP_UNSUPPORTED_VERSION（包括 format/scope 不支持）、BACKUP_TOO_LARGE（字节或记录数上限）、BACKUP_CONFLICT、BACKUP_ID_COLLISION、BACKUP_DIGEST_MISMATCH。来源/信封错误沿用现有 FORBIDDEN、PROTOCOL_MISMATCH、INSTANCE_MISMATCH、INVALID_COMMAND；存储错误沿用 STORAGE_FULL/DENIED/FAILED。传输错误 OUTCOME_UNKNOWN 只由客户端表示。错误详情最多暴露表名、记录 ID 和错误路径，不返回文本、原始异常或 fingerprint。

兼容矩阵：仅接收 formatVersion=1 + scope=prototype-storage-v1。旧 demo 备份、其他产品文件和未知未来版本全部拒绝，不尝试猜格式。普通导入不负责应用降级。

数据库升级 1→2 仅增加 backupImports。测试升级前后四张学习表和 diagnostics 内容不变；升级失败不删除或重建数据库。旧代码打开 v2 不兼容时明确停止，不能把 VersionError 当空库。正式回退使用仍支持 v2 的修复版本，或在独立配置中验证过的导出/恢复流程；不自动降库。

初次实现只处理合成测试库。升级后并不授权用个人学习数据试验。未来新增任一学习实体时，必须扩展文件版本和 round-trip 验收；不得继续把本 scope 宣称为正式软件的完整备份。

## B-07：验收编号

- BK-01：多会话、active/paused、中文和 Python 文本、草稿与多次尝试导出→空库导入→重导出。忽略新导出 envelope 的 backupId/exportedAt/source，只对目标 extensionId 规范化 actions；四表内容与原动作查询结果一致。
- BK-02：重复同文件不增加事实；第一次导入后继续写新草稿，再导同文件仍返回原回执且新草稿不变；同 backupId 改内容拒绝。
- BK-03：目标有独立会话时只添加缺失数据；有一条同 ID 内容冲突时，原数据、其他待添加行和成功回执全部不变。预览后并发写入也受此约束。
- BK-04：错误 JSON、未知版本/字段、超限、重复 ID、悬空引用、revision 缺号、错误状态链、命令/事件/回执不符、摘要不符分别拒绝；不触发学习动作。
- BK-05：导入事务最后一步注入 AbortError/QuotaExceededError，所有学习写入及回执回滚；诊断失败不循环；同文件可手动恢复。
- BK-06：导入提交后丢回执、关闭并重开后台，按 backupId 查得原结果；未提交查不到，重试无重复。区分模拟丢回执与真实连接中断。
- BK-07：导出期间并发写入只能得到完整旧快照或新快照；schema 与引用链均成立。文件和日志不含植入的系统配置/诊断哨兵；文件中合法学习文本保持原样。
- BK-08：不同扩展 ID 恢复后，新页面可继续保存，旧 actionId 查询与规范化同动作重发返回历史结果；篡改同 ID 命令仍拒绝，直接旧实例消息仍拒绝。
- BK-09：真实版本 1 库升级到 2 保留数据，升级失败不清库，旧代码打开新库不自动重置。只测试合成数据，不继承旧 demo 迁移结论。
- BK-10：工作台文件下载、选择、预览、取消、确认、错误提示、再次导入及刷新后续练的浏览器闭环；侧栏仍能保存。预览与文件不一致、尚未确认草稿时不得假称完整备份成功。
- BK-11：工作台、侧栏、子框架及不可信来源的权限测试；未知响应不得显示成功。新增管理消息不能扩大原学习权限。

本任务不负责补齐所有 SC-04/08/09 的真实故障。上述 BK 模拟、真实 IndexedDB、Chromium、Chrome 稳定版结果分别报告；未测项不得以单元测试代替。归档使用合成内容和确定版本，不提交个人备份或浏览器配置。
