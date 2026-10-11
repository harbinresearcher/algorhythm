# 教练练习工作区：前端接入

本切片核心、存储升级和独立测试已由主力编码实现，界面另行接入。共享契约见 `docs/superpowers/specs/2026-10-11-coach-core-design.md`；公开类型见 `src/practice-types.ts`，流程 API 见 `src/practice.ts`。总架构维护公共 STATUS。本交接不授权改动核心、仓库设置或合并 PR。

## 入口与调用

从题库 problemId 调用 `startPractice(problemId)`。返回 session.id，前端保存当前练习的 ID 指针（例如路由参数或 localStorage 的非敏感指针），刷新用 `loadPractice(sessionId)` 继续，不能在页面加载时调用 startPractice 或 runPracticeEvent。

示例仅说明调用顺序，不是已交付 UI。模型配置沿用 `loadAIConfig()`。默认第三个参数为真实模型配置；测试只能显式注入 transport。API 不自动读取或保存密钥。

```ts
import { loadAIConfig } from '../../src/ai';
import { logger } from '../../src/logger';
import { startPractice, runPracticeEvent, loadPractice } from '../../src/practice';

/*
 * ========================================================================
 * 步骤1：记录一次用户提交
 * ========================================================================
 * 数据源：题库选择与用户输入；操作：1) 开始会话 2) 提交观察后重新读记录
 */
logger.info('开始提交练习观察');
// 1.1 开始会话只在用户明确选择新练习时调用
const session = await startPractice(problemId);
// 1.2 每个新动作创建 ID，重复点击同一动作必须复用原 ID
const event = {
  type: 'submit' as const,
  requestId: crypto.randomUUID(),
  attemptId: crypto.randomUUID(),
  thought,
  code,
  ...(testReport ? { selfReportedTests: testReport } : {}),
};
const result = await runPracticeEvent(session.id, event, loadAIConfig());
// 1.3 用持久化视图渲染，duplicate 也重新读取，不追加临时反馈
const view = await loadPractice(session.id);
logger.info('练习观察提交完成');
```

新思路或代码使用 submit，不会增加提示权限。thought/code 至少一项非空，每项和测试自述最多 12000 字符。requestId/attemptId 非空，最多 128 字符。核心先存尝试和请求，再发一次模型请求；提交结果 failed 也保留用户输入。

用户点击“请求提示”时发送 `{ type: 'hint', requestId: 新ID, attemptId: view.session.latestAttemptId }`。当前允许等级见 session.hintLevel：0→1 方向、1→2 关系、2→3 局部步骤；3 级后核心返回 HINT_LIMIT。模型无权升级；同一会话的成功提示权限继续保留，新会话重置。完整题解、骨架和原题 aiAnalysis 不得在练习区自动展示；否则核心无法记录 UI 自行造成的答案暴露。

## 请求、刷新与失败

view.requests 中 currentRequestId 对应当前调用。`pending` 表示尚待结果，不是失败。页面关闭、刷新、切换标签不发起新请求。使用 `recoverPractice(sessionId)` 重新读取并只过期已到 expiresAt 的 pending；有效期内保留 pending。前端可监听 IndexedDB 更新或定时只读刷新状态，在 expiresAt 后调用 recoverPractice；不要轮询调用模型。

`expired` 表示本地不再接受该请求的结果，不证明服务端未计费或已经停下。展示“调用已中断或超时，可手动重试；重试可能产生额外费用”。只在用户明确点击后发送 `{ type: 'retry', requestId: 新ID, previousRequestId: 当前失败或过期请求ID }`。保留原 attemptId，不重建尝试。新的 submit 可以替代旧请求，旧响应返回 stale，不再进历史反馈。

同步按钮锁减少重复操作，核心事务负责真正去重。相同动作须复用 requestId；两个不同 ID 意味着两个明确用户动作，核心不能推断两次提交是否是误点。相同 attemptId 不能换 requestId 重复提交。提示进行中禁止再申请提示；复盘和新尝试仍由用户决定。

结果 disposition：completed（反馈已持久化）、failed（尝试保留，可手动重试）、duplicate（不发第二次请求，重新读）、stale（响应失效，重新读）。不要将 stale/duplicate 渲染为新增成功反馈。

前置条件错误会 reject `PracticeError`：NOT_FOUND（会话或原题不存在）、SESSION_ENDED（会话已结束）、INVALID_EVENT（输入或 ID 无效）、REQUEST_CONFLICT（ID 被不同动作使用）、BUSY（提示调用进行中）、STALE_ATTEMPT（操作不是最新尝试）、HINT_LIMIT（已用最高提示）、RETRY_NOT_ALLOWED（当前不可重试）。

模型失败作为 failed 返回，request.errorCode：INVALID_CONFIG（配置错误）、NETWORK、TIMEOUT、HTTP、INVALID_OUTPUT。不要自动重试。存储失败直接 reject，必须显示“未能保存/更新，请重新加载记录确认”，不能报告假成功；可能已保留尝试但反馈事务未成功，读取后按状态恢复。禁止把原异常、请求正文或密钥写到日志。

## 标签、结束与备份

反馈 basis 固定 `static-analysis`，界面显示“静态分析，未运行代码”。selfReportedTests.basis 固定 `user-report`，界面显示“用户自述”。均不能显示“测试已验证”或“已掌握”。

用户点击结束后调用 `finishPractice(sessionId)`，无需配置和额外模型请求。摘要含 attemptCount、usedHintLevels、answerExposure、exposureVerification、unverifiedItems、endedAt。answerExposure 是模型自评，exposureVerification 始终 unverified，即使 none 也不能显示“已验证无泄题”。usedHintLevels 只计已保存并实际给出的提示，不计失败请求。finish 幂等；结束取消 pending，迟到响应不改变摘要；不自动调整 FSRS。

**练习记录暂不包含在备份中。** 当前导出仅包含题库和 FSRS 卡片，清除站点数据会删除练习记录。此句必须在练习相关备份说明中展示，不能把现有文件宣传成完整学习备份。

## 验收边界

本轮仅交付核心与测试，未接 UI、未运行用户代码、未调用真实付费模型。前端用隔离数据库和模拟 HTTP 先验证一道题多轮、取消/结束、失败重试、刷新和移动端；总架构负责固定教学场景和真实练习效果验收。测试通过不等于真实模型不会泄题或指导质量合格。
