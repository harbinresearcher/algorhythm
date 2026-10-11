# 教练核心实施计划

总架构已批准规格与常规实现。当前会话按 executing-plans + TDD 顺序实施，不派发子代理。

**目标**：交付可恢复、可追踪、用户控制提示的单题练习核心，供独立前端接入。
**架构**：四张练习表保持职责分离；事务预留调用，外部请求后事务校验写入；复盘只读取记录。
**技术**：现有 TypeScript、Dexie、Vitest / fake-indexeddb，无新依赖。

## 全局约束

- 共享 API 与状态以 ../specs/2026-10-11-coach-core-design.md 为准。
- 不改 UI、原题分析、备份格式或 FSRS 排期；不调用用户付费 API。
- 请求不自动重试；90 秒有效期、60 秒 HTTP 超时；每动作最多一次调用。
- 主要逻辑保持步骤块、子步骤和开始/结束日志，不记录个人内容和密钥。

## 任务 1：持久化与流程

文件：新增 src/practice-types.ts、src/practice.ts、tests/practice.test.ts；修改 src/db.ts 新增 v2 表。

接口：消费 AlgoRhythmDB/Problem；产出 startPractice/loadPractice/recoverPractice/runPracticeEvent/finishPractice，精确签名见规格。

- [ ] 写独立行为测试。v1 用真实 Dexie 创建，写完整 Problem，关闭后用 AlgoRhythmDB 打开；期望原 Card 的 due 保持 Date 且新会话无旧权限。
- [ ] 用保存的 attempts/requests/feedback 断言正常两轮、提示与摘要；fetch 仅作为外部边界替身。
- [ ] 用延迟 promise 控制跨标签并发、刷新、结束和过期响应；断言无多余请求与反馈。
- [ ] npm test -- tests/practice.test.ts，记录未实现失败。
- [ ] 实现公开类型、v2 表与事务预留/完成流程。存储失败不得开始 HTTP。
- [ ] 重跑独立测试及旧核心测试，确保升级和原业务一致。

## 任务 2：真实 HTTP 边界

文件：新增 src/coach.ts、tests/coach.test.ts。
接口：消费 AIConfig 与 CoachContext；产出 requestCoach/parseCoachReply。

- [ ] 先写真实 requestCoach + fetch 替身测试，断言题干与用户观察进入上下文、原 aiAnalysis 不进入；401/非法输出/超时无重试。
- [ ] npm test -- tests/coach.test.ts，确认缺功能失败。
- [ ] 最小实现 OpenAI 兼容请求、脱敏错误、结构校验、等级约束、超时清理。
- [ ] 增补核心整合测试，模拟 HTTP 且记录尝试已先入库；不把模拟结果当教学验收。

## 任务 3：交付

- [ ] 新增 docs/handoffs/04-COACH-FRONTEND.md，提供直接可用调用示例、恢复/状态处理和备份边界；公共 STATUS 由总架构更新。
- [ ] 四项质量检查与 git diff --check。
- [ ] 仅提交本切片文件，推送 feature/coach-core，新建 PR，不合并。
- [ ] 核对对应提交 SHA 的 CI/CodeQL，报告实测结果与自然语言教学质量边界。
