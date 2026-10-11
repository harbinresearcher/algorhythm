# 一道题的教练核心：共享契约

日期：2026-10-11。总架构已批准核心、独立测试及新增练习表。前端另行接入。本规格的状态和 API 是本切片共享边界，不沿用旧备份交接的文件限制。

## 范围与数据

纯前端，无新依赖、框架、后端、代码执行器或自动 FSRS 评分。沿用 `AIConfig` / `validateConfig`，不改变题目分析调用。

Dexie 从 v1 升级到 v2，原 `problems` schema 保持不变，新增四张表：

- `practiceSessions`：id、problemId、题干快照（title/description/url）、status、hintLevel、latestAttemptId、currentRequestId、createdAt/updatedAt、可选 summary。新会话 hintLevel=0，无尝试和请求状态；不保存原题分析和骨架。
- `practiceAttempts`：id、sessionId、thought、code、可选 selfReportedTests（固定来源 `user-report`）、createdAt。id 由用户动作生成；同一 ID 不能新增第二次，也不能跨会话复用。
- `practiceRequests`：id 即 requestId、sessionId、attemptId、action（submit/hint）、hintLevel、status、createdAt、expiresAt、可选 retryOf/errorCode。每次重试新 ID，关联原请求；不存 Key、完整 HTTP 请求或原始响应。
- `practiceFeedback`：id、sessionId、attemptId、requestId、assessment、nextQuestion、hint、hintLevel、answerExposure、basis=`static-analysis`、createdAt。只保存通过校验且仍有效的结果。

当前备份仍只覆盖题库，schemaVersion 与格式不变。**练习记录暂不包含在备份中。** 删除原题不会删除练习快照；本切片不增加练习记录清理 UI。

## 公开类型与函数

完整类型在 `src/practice-types.ts`，存储/流程 API 在 `src/practice.ts`，HTTP 与输出校验在 `src/coach.ts`。类型字段按上述列表，时间为毫秒数字，列表按 createdAt 再按 id 排序。

```ts
type HintLevel = 0 | 1 | 2 | 3;
type SessionStatus = 'active' | 'ended';
type RequestStatus = 'pending' | 'succeeded' | 'failed' | 'expired' | 'superseded' | 'cancelled';
type PracticeEvent =
  | { type: 'submit'; requestId: string; attemptId: string; thought: string; code: string; selfReportedTests?: string }
  | { type: 'hint'; requestId: string; attemptId: string }
  | { type: 'retry'; requestId: string; previousRequestId: string };
interface PracticeOptions { storage?: AlgoRhythmDB; now?: () => number }
interface CoachContext { session: PracticeSession; attempts: PracticeAttempt[]; feedback: CoachFeedback[]; request: PracticeRequest }
interface CoachReply { assessment: string; nextQuestion: string; hint: string; hintLevel: HintLevel; answerExposure: 'none' | 'possible' | 'explicit' }
type CoachTransport = (context: CoachContext, config: AIConfig) => Promise<CoachReply>;
interface RunOptions extends PracticeOptions { transport?: CoachTransport }
interface PracticeView { session: PracticeSession; attempts: PracticeAttempt[]; requests: PracticeRequest[]; feedback: CoachFeedback[] }
interface PracticeRunResult { disposition: 'completed' | 'failed' | 'duplicate' | 'stale'; request: PracticeRequest; feedback?: CoachFeedback }

startPractice(problemId: string, options?: PracticeOptions): Promise<PracticeSession>;
loadPractice(sessionId: string, options?: PracticeOptions): Promise<PracticeView>;
recoverPractice(sessionId: string, options?: PracticeOptions): Promise<PracticeView>;
runPracticeEvent(sessionId: string, event: PracticeEvent, config: AIConfig, options?: RunOptions): Promise<PracticeRunResult>;
finishPractice(sessionId: string, options?: PracticeOptions): Promise<PracticeSummary>;
requestCoach(context: CoachContext, config: AIConfig): Promise<CoachReply>;
parseCoachReply(value: unknown, allowedLevel: HintLevel): CoachReply;
```

`PracticeSummary`：attemptCount、usedHintLevels（只统计实际保存的非空提示）、answerExposure（模型报告的最高暴露等级）、exposureVerification=`unverified`、unverifiedItems、endedAt。不包含 mastered 等掌握结论。未验证项始终含“代码未由系统运行验证”和“教学质量与答案暴露未经人工验证”；有测试自述时加“测试结果仅为用户自述”。结束幂等，摘要由持久化记录生成，无模型请求。

`PracticeError extends Error` 有 `code: PracticeErrorCode`。前置条件错误 reject：`NOT_FOUND`、`SESSION_ENDED`、`INVALID_EVENT`、`REQUEST_CONFLICT`、`BUSY`、`STALE_ATTEMPT`、`HINT_LIMIT`、`RETRY_NOT_ALLOWED`。调用失败保存 `failed`，返回 disposition=`failed`，errorCode 为 `INVALID_CONFIG`、`NETWORK`、`TIMEOUT`、`HTTP` 或 `INVALID_OUTPUT`。存储故障直接 reject 原异常；不报告伪成功。错误与日志不包含题干、Key 或服务端响应正文。

## 状态与权限

```text
[会话 active] ──┬── submit ── 保存尝试和请求 → 模型一次 → 等待用户
                ├── hint ─── 申请下一级 → 模型一次 → 保存实际提示
                ├── retry ── 新 requestId → 模型一次
                └── finish ─ 保存摘要 → ended

[请求 pending] ─┬── 有效响应 → succeeded
                ├── 调用失败 → failed
                ├── 超过有效期 → expired
                ├── 新尝试替代 → superseded
                └── 用户结束 → cancelled
```

提交不提升提示等级，允许新提示等级分别为 1（方向）、2（关键关系）、3（局部步骤），仍禁止完整答案。普通提交反馈允许等级固定为 0，hint 必须非空且等级与请求一致；提交 hint 必须为空。成功 hint 才提升 session.hintLevel，失败或无效输出不会提升。模型不得修改权限或状态，不允许额外输出字段如 mastered/verified。

会话必须先有尝试才能申请提示。提示绑定最新尝试；hint 期间有效 pending 请求阻止再次 hint。新 submit 可替代旧 pending 请求（标记 superseded），因为这是用户的新观察。retry 仅允许 currentRequestId 指向的 failed/expired 请求，绑定仍为最新尝试，继承原 action 和权限；成功、有效 pending、旧尝试和 ended 都不能重试。

## 原子性、去重和恢复

先在一个数据库事务中保存尝试、预留唯一 requestId、更新会话，再离开事务调用模型。每个获预留权的用户动作最多一次 HTTP 请求，永不自动重试。相同 requestId 与相同事件重复进入（跨标签页也适用）返回 duplicate，不发请求；不同事件复用该 ID 报 REQUEST_CONFLICT。相同 attemptId 换 requestId 提交报 INVALID_EVENT，不会再次计数。判断基于保存的事件字段，不存额外全量事件副本。

请求有效期 90 秒，HTTP 超时 60 秒。刷新后 loadPractice 仅读取，不调用模型，不将 pending 改成失败。recoverPractice 只将已过 expiresAt 的 pending 改成 expired；调用中或页面关闭无法证明请求失败。到期只释放本地提交权限，不宣称服务端已停止或未计费。用户显式重试可能产生额外费用；核心不自动触发。

保存结果或错误之前再次在事务中验证：会话 active、currentRequestId 匹配、latestAttemptId 匹配、请求 pending、当前时间严格小于 expiresAt。否则返回 stale，不新增反馈、不更新提示权限。过期响应把尚 pending 的请求记 expired；已 superseded/cancelled 状态原样保留。结束在同一事务取消 pending 并生成摘要，迟到响应不能写入。

模型上下文只用题干快照及已保存尝试/反馈，不包含 aiAnalysis、骨架、API Key；最多 10 条尝试，明确标识 currentAttemptId，并保证本次请求绑定的观察在最后，其余最多 9 条历史。历史反馈最多 10 条且携带 attemptId。即使时钟回拨或同毫秒 ID 倒序，本次观察也不会被截断。文本字段限 12000 字符，本地记录仍完整。输入空尝试或超长字段在调用前拒绝。输出结构校验能限制等级和字段，不能证明自然语言绝不泄题；answerExposure 是模型报告，始终注明 unverified，真实教学质量另行验收。

预留与结果保存均在写事务内读取当前时间，不能使用进入事务队列之前的时间。API 应从用户事件调用，不嵌套在 UI 自行创建的数据库事务中。

## 验收

独立测试覆盖：多轮练习、提示主动申请、会话权限隔离、输入和输出边界、401/网络/非法输出、失败保留尝试、显式重试、重开数据库恢复、有效 pending 不重发、到期重试、相同 requestId 并发、ID 冲突、旧尝试/过期/结束后迟到结果、事务失败零调用、v1 真实升级保留原题和 Date/FSRS、备份格式保持题库范围。

本轮不接 UI、不运行用户代码、不调用付费模型、不合并 PR。提交前 lint、format:check、test、build；推送后核对对应 SHA 的 CI。前端以 persisted view 显示静态分析/用户自述、进行中/过期状态和备份边界。
