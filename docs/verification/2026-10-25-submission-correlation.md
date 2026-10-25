# 程序员任务 03：离线提交关联验收

日期：2026-10-25。依据[任务单](../superpowers/plans/2026-10-25-programmer-03-submission-correlation.md)与[RFC-02](../superpowers/specs/2026-10-25-submission-correlation-design.md) C-01 至 C-06。基准为任务定义提交 `c1423b343f5a30c8a5745f03c74e6f8059fadb77`，它包含已集成 main `605d619` 及文档交接。独立工作树 `submission-correlation`，分支 `codex/task-03-submission-correlation`。未覆盖总架构主目录或任务定义工作树。

## 结论与信任边界

离线合成关联实现完成。真实接入准入维持 **unresolved**，不代表 AC-06 真实采集验收通过。只交付独立 Zod 契约、两个纯函数及原创合成测试；没有生产入口引用，不增加权限、网络、数据库、备份或 UI 行为。

`correlateSubmissions(input: unknown)` 先整批严格校验，再按 observationId 去重；同 ID 不同内容返回整批 invalid。只按 site/accountScopeId/submissionId 元组关联。每组依次处理多 Context、无 Context、辅助身份冲突、final 矛盾、一致 final、unavailable、pending；不以到达顺序、时间、代码相似或当前选择推断身份。类型从同一份运行时 schema 推导。

`hashSubmittedCode(code: string)` 对原字符串的 UTF-8 字节计算 SHA-256，不改空白、缩进或换行；超过 32,000 UTF-16 code units 抛 RangeError。仅接受原创本地样本；合成 contextId、sessionId、attemptId 和账户域不表示正式数据库关系已验证。

## 实际 RED/GREEN

使用锁文件安装依赖，没有升级包。基线重新运行原 179 项测试及构建，均退出 0。日志在 `apps/extension/output/task03/baseline-tests-2026-10-25.log`、`baseline-build-2026-10-25.log`。

按任务单先建立 schema、工厂及类型正确的占位函数：关联返回空 ok，哈希返回空字符串。`npm run typecheck` 退出 0 后，运行 `npm test -- tests/submission-correlation.test.ts`：**88 项失败、5 项通过，退出 1**。失败来自行为断言，不是缺模块或编译错误；记录在 `behavior-red-2026-10-25.log`，类型检查记录在 `red-typecheck-2026-10-25.log`。

实现后同一命令 **93 项通过，退出 0**，见 `behavior-green-2026-10-25.log`。没有为了通过而放宽 schema、修改 provenance 或改变七级顺序。

## LC-01 至 LC-10

- LC-01：默认 Context 的 submissionId=`10001`、摘要为 64 个 a；观察 final/AC，同强身份返回原 contextId。pending 的 verdict=null；三个辅助字段均 null 仍可强身份匹配。结果通过。
- LC-02：强身份不变，观察摘要换成 64 个 b，返回 conflict/IDENTITY_CONFLICT，contextId/verdict 均 null；原 Context 不变。结果通过。
- LC-03：提供不同题目、标签、document、captureEpoch、session/attempt 的 A/B 上下文，B 排在前面；A 的迟到观察即使时间取最大安全整数仍只归 A。结果通过。
- LC-04：同题、同摘要的两次提交使用 `10001`/`10002`，分别返回原 Context 和 AC/WA，不按代码合并。结果通过。
- LC-05：同 observationId 的完全重复对象去重，属性排列变化不影响判断；同 ID 的 verdict、时间、账户或 slug 改变，整批 DUPLICATE_OBSERVATION，不返回部分匹配。结果通过。
- LC-06：pending/final/unavailable 六种排列及重复次数变化均保留一致 final；两种 final 加 pending/unavailable 的 24 种排列均 RESULT_CONFLICT；无 final 时 unavailable 优先。六种合法 verdict 的重复 final 均保留。observedAt 不决定胜者。结果通过。
- LC-07：两个合成账户的相同 submissionId 分组；缺账户或提交 ID 仅进入排序去重的 unresolved，不用时间/摘要补齐。数字字符串 `0002`、`10`、`2` 保留原表示，按字典序排列。结果通过。
- LC-08：同 key 两个不同 contextId 即使代码相同也 AMBIGUOUS_CONTEXT，优先于身份或判题矛盾；无 Context 即 NO_CONTEXT；唯一 Context 的 slug 矛盾先于判题矛盾。无观察的 Context、submissionId=null 的 Context 不产生结果组。结果通过。
- LC-09：根/行未知字段、非法类型、非 UUID、错误站点/来源/版本/语言、大小写摘要、phase/verdict 非法组合、重复 contextId、越界数字和字段长度均整批 INVALID_INPUT。两个数组 200 项允许、201 项拒绝，即使之后可去重也不放宽。合法 128 字符 documentId、200 字符 slug、64 位数字 submissionId 和最大安全整数通过。输出 schema 拒绝伪造成功与未知字段。结果通过。
- LC-10：深冻结输入后，对六种观察排列与重复观察运行而无修改；工厂每次分配新对象。空字符串/abc 使用已知 SHA-256，中文、缩进、换行、emoji 与 32,000 边界用独立 Node createHash 标准结果核对。LF/CRLF、首尾空白不同则摘要不同，32,001 拒绝。日志不含标识、slug、摘要或样本代码。发布包隔离和原回归见下节。结果通过。

以上是 93 个 Vitest 用例；排列循环在各自用例内部验证，不把循环次数虚增为测试数量。slug 为原创 `fixture-alpha` / `fixture-beta`；没有平台题干、题解、测试用例或个人提交。

## 四层证据与发布隔离

1. 离线 schema：严格输入、整批错误和输出类型，93 项新增测试包含这些行为，不与纯函数项重复计数。
2. 纯函数：上述 LC 全部基于原创合成输入，不是 DOM/接口录制回放，也不证明网页自报证据可信。
3. 原型回归：本轮 `npm test` 共 **8 个文件、272 项通过**，其中原有 179 项、新增 93 项；`npm run build` 含严格类型检查，退出 0，仍为 125 个构建模块。
4. 真实平台：**未运行**。未登录、抓取接口、读取 DOM 或账号数据、发送内容给模型、验证平台提交或执行用户代码。没有本轮浏览器结论；按任务单未例行重跑原型浏览器验收，也未继承其通过数。

最终日志为 `output/task03/final-tests-2026-10-25.log`、`final-build-2026-10-25.log`。构建前后 9 个文件的相对路径和 SHA-256 逐项相同，清单保存在 `baseline-dist-sha256.json`、`final-dist-sha256.json`；扫描 dist 未发现两条合成 slug、document 标记、样本代码标记或 synthetic-fixture。源码引用检查仅出现独立模块与对应测试，没有 UI、后台或其他生产入口引用。

本次 diff 限于任务允许的四个新增 TypeScript 文件、验收记录和来源/交接/路线文档。既有协议、store、backup、source、background、UI、manifest、CSP、依赖锁、构建和 CI 均未修改。日志及构建产物被忽略，不提交个人资料或原始请求。

## 官方来源核查与停止点

[本轮来源核查](../research/2026-10-25-leetcode-access-boundary.md)保留 2026-10-25 核查日期，重读中国站服务协议、国际站条款和 Chrome activeTab 官方文档。原条款摘要核对一致，只补充七类对象在读取、缓存、发模型、导出、分发五种操作上的未知边界。agent-reach Jina 路由连接超时，随后官网直接读取成功；没有因此尝试账号、接口或绕过。

许可事实、浏览器技术能力和工程准入判断分开记录。当前没有覆盖计划用途的适用授权材料，结论仍为 unresolved；没有把第三方插件存在当许可。实际接口、DOM、账号、平台样本与未来适配器证据可信度均未验证。合成实验通过不勾选 AC-06。

交回总架构审查独立 PR；不合并、不联系平台、不启用采集、不开始下一功能。下一步由总架构决定另发有明确准入材料的接入实验，或另定手动输入路线，本任务不实现降级 UI。

实现提交 `5f66e48` 已推送，[PR #23](https://github.com/harbinresearcher/algorhythm/pull/23) 暂以未合并的 `codex/task-03-definition` 为 base；最终交回元数据另存 docs 提交。代码与文档分别经独立只读复核，无阻断项；实时远端检查以 PR 最新 head 为准。
