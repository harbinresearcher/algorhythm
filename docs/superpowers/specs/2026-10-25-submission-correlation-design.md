# RFC-02：任务 03 接入边界与离线提交关联

日期：2026-10-25。状态：总架构任务定义；未实现、未验证真实采集。依据 S-02/S-03/S-07、D-01/D-02/D-03 与 AC-06。产品方向不变。

## C-01：本任务解决什么

确认将来采集需要哪些证据，并用离线实验验证“题目、提交代码和判题不能串”。交付官方来源记录、唯一运行时 schema、纯关联函数、原创合成测试、分层验收。不是可用的力扣连接器。

仅考虑 leetcode.cn、Python3。国际站只有条款对照，不实现适配。依照[初步核查](../../research/2026-10-25-leetcode-access-boundary.md)，真实采集准入未满足；本任务不包含自动启用的真实站点阶段。

不改 manifest、CSP、background、UI、原学习协议、DB v2 或 backup v1，不新增权限、依赖、账号、模型、FSRS、网络调用、网页注入或测试代码执行器。代码是未接入发布入口的纯模块，仍纳入类型检查。

## C-02：共享契约

新增一个 Zod schema 文件，类型一律 z.infer，不在测试和核心复制结构。下面所有对象 strict；拒绝未知字段、超限与错误类型，不自动转换数字/字符串。

输入为 `{ contexts, observations }`，每个数组最多 200 项。schemaVersion 固定 1，site 固定 leetcode.cn，provenance 固定 synthetic-fixture。这不是力扣真实响应格式。未来真实适配器须单独审查，不能只把该枚举改成 platform。

Context 表示测试宿主在提交发生时冻结的绑定：

- contextId、sessionId、attemptId、accountScopeId、captureEpoch：UUID；accountScopeId 为合成本地隔离标识，不是用户名或 Cookie。
- tabId：非负安全整数；documentId：1–128 字符；slug：1–200 个小写字母、数字或连字符。
- language：python3；codeSha256：64 位小写十六进制；submissionId：1–64 位数字字符串或 null。
- schemaVersion、site、provenance 如上。contextId 不得重复。submissionId 由提交绑定证据提供，不能由时间、当前编辑器或当前标签页猜出。

Observation 表示一份合成判题观察：

- observationId：UUID；accountScopeId：UUID 或 null；submissionId：数字字符串或 null。
- slug、language、codeSha256：各按 Context 对应约束或 null。缺少这些辅助字段不阻断已有强身份绑定；出现时必须一致。
- phase：pending、final、unavailable；verdict：AC、WA、TLE、MLE、RE、CE 或 null。仅 final 必须且允许非 null verdict。
- observedAt：非负安全整数，只用于追溯，不能作为身份依据或决定哪个矛盾结果覆盖另一个。
- schemaVersion、site、provenance 如上。重复 observationId 的完全相同对象去重；内容不同返回 invalid。

导出函数接口：

```ts
hashSubmittedCode(code: string): Promise<string>
correlateSubmissions(input: unknown): CorrelationReport
```

hashSubmittedCode 对提交时原字符串的 UTF-8 字节计算 SHA-256；不 trim、不改缩进、不改换行。不接受超过 32,000 UTF-16 code units 的字符串，越界抛 RangeError。这个限制与原型草稿限制一致，不声称覆盖所有平台代码。

CorrelationReport 也由 schema 推导：

- invalid：`{ status: 'invalid', reason: 'INVALID_INPUT' | 'DUPLICATE_OBSERVATION' }`，不返回部分匹配或原输入。
- ok：`{ status: 'ok', groups, unresolved }`。
- groups 按 `[site, accountScopeId, submissionId]` 元组分组（不是含歧义的字符串拼接）。每项包含 key 三元组、status、contextId（UUID 或 null）、verdict（上述枚举或 null）、reason（下节固定枚举或 null）、observationIds（排序去重 UUID 数组）。
- unresolved：缺失 accountScopeId 或 submissionId 的 observationId 列表，按字典序排序。不为它们补标识。

## C-03：关联算法与优先级

只处理含观察的组，contexts 无对应观察时不生成判题结果。先校验整个输入并处理重复 observationId，再按强身份分组，排序必须稳定，不依赖输入顺序。

每组按照下面顺序，首次适用即决定结果：

1. 同 key 对应多个 Context：conflict / AMBIGUOUS_CONTEXT，contextId 与 verdict 为 null。即使代码相同，也不能任选一个尝试。
2. 无 Context：unlinked / NO_CONTEXT，contextId 与 verdict 为 null。两个字段相同的观察不会自动建立会话。
3. 唯一 Context，但任一非 null 的 slug、language、codeSha256 与其不符：conflict / IDENTITY_CONFLICT，contextId 与 verdict 为 null。
4. 唯一 Context，有多个不同 final verdict：conflict / RESULT_CONFLICT，contextId 与 verdict 为 null，不让最后到达者覆盖事实。
5. 至少一个一致 final：matched，返回原 contextId 与 verdict，reason 为 null。pending/unavailable 迟到不能把它降回处理中或失败。
6. 无 final 且有 unavailable：unavailable，返回原 contextId，verdict 为 null，reason 为 RESULT_UNAVAILABLE。
7. 其余：pending，返回原 contextId，verdict 与 reason 为 null。

组顺序按 key 三个字段逐项字典序。任何状态都不写数据库、不切换当前会话、不修改输入。日志仅记录开始、结束及条数，不输出标识、代码、题目、完整 payload 或原始异常。

迟到结果属于原提交：调用者提供已冻结 Context 集合，不传“当前选中的会话”作为归属依据。相同代码提交两次仍是两个 submissionId；相同 submissionId 在两个账户隔离域中不是同一组。sessionId/attemptId 在本实验仅为合成关联引用，不声称已验证正式数据库引用关系。

## C-04：信任边界

page 消息自报 submissionId、contextId、代码摘要并不证明真实提交。此实验只能证明“给定证据时规则正确”，不能证明站点证据可信。正式后台原有来源校验保持不变；不得给内容脚本开放学习写命令或备份命令。

tabId、documentId、captureEpoch 是宿主冻结的审计上下文。关联函数不会根据这些字段给任意网页消息授信。真实适配器将来需要单独验证宿主绑定、页面切换、账号变化、来源校验和原始提交快照。缺乏可靠账户隔离信息时应产生待关联状态，不能用当前账号补齐旧观察。

## C-05：验收用例

- LC-01：完整匹配返回原 contextId；pending 不带 verdict。
- LC-02：提交 A 后编辑器改成 B，hash(A) 不被 hash(B) 替换；强 key 相同但摘要不同为冲突。
- LC-03：换题/切标签后 A 判题回来，仍归 A；不输入当前会话进行猜测。
- LC-04：同题同代码连续两次提交按不同 submissionId 分开。
- LC-05：完全重复观察去重；相同 observationId 不同内容整批 invalid。
- LC-06：final 后的 pending/unavailable 不降级；两种 final 冲突拒绝；各排列结果一致。
- LC-07：账户隔离；缺账号或提交 ID 进入 unresolved；只有时间和代码相同不能匹配。
- LC-08：同 key 多个 Context 拒绝，未知提交 unlinked，辅助字段矛盾拒绝。
- LC-09：非法 schema、超限、null/phase 非法组合、未知字段；错误不包含原内容。
- LC-10：深冻结输入后函数不改输入；哈希保留空白和换行；原创样本不进入发布包；原 179 项回归不减少。

LC-01 至 LC-10 均是离线合成证据，不覆盖 AC-06 真实采集验收。没有实际 DOM/接口样本，不编造选择器、请求格式或 fixture 来源。

## C-06：准入与停止点

许可核查交付逐项边界与出处；缺许可可明确交付 unresolved，不阻断本任务的离线实验，也不计为真实接入通过。

任务结束交回总架构：许可事实、合成测试结果、未测项、建议的下一步。真实采集另发任务：明确可用许可/授权、字段和方法，测试身份及 Chrome 稳定版独立配置，拒绝或无法建立可靠关联时允许 no-go。不要求用户为调研交出账号密码，不自动联系平台。

手动输入可作为后续产品降级路线，但用户自述不能升级成平台验证结果；本任务不顺带开发该 UI。
