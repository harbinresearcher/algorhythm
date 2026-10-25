# 程序员任务 03：接入边界与离线提交关联

> **For agentic workers:** 使用 executing-plans 逐项完成；不派发并行实现。用户已授权总架构处理既定方向内的工程取舍，不重复确认产品方向。

**Goal:** 用原创合成输入证明提交关联规则不会串题，交付真实接入准入结论，不开发采集器。

**Architecture:** 单源 Zod 契约 + 无副作用的关联函数。模块暂不被 UI、后台或生产入口导入；现有数据库、权限及备份完全保持。

**Tech Stack:** 现有 TypeScript、Zod、Vitest、Web Crypto；不增加依赖。

## 入口与分支

先读 AGENTS、CONTINUITY、STATUS，再读 [RFC-02](../specs/2026-10-25-submission-correlation-design.md)和[来源核查](../../research/2026-10-25-leetcode-access-boundary.md)。规格 C-01 至 C-06 为本任务唯一契约。

实现使用独立工作树、分支 `codex/task-03-submission-correlation`。若任务定义 PR 尚未合并，基于该定义分支创建，PR 暂以它为 base；若已合并则从最新 main 创建。不要从旧 main `caac0c1` 或退役 demo 创建，不更改他人工作树。

## 文件边界

新增：

- `apps/extension/src/shared/submission-evidence.ts`：全部输入、输出运行时 schema 和推导类型。
- `apps/extension/src/core/submission-correlation.ts`：`hashSubmittedCode` 与 `correlateSubmissions`，签名及语义严格按 C-02/C-03。
- `apps/extension/tests/submission-correlation.test.ts`：LC-01 至 LC-10 行为测试。
- `apps/extension/tests/helpers/submission-evidence.ts`：原创工厂 `makeContext()`、`makeObservation()`；返回 schema 推导类型，不复制接口定义。
- `docs/verification/2026-10-25-submission-correlation.md`：实际 RED/GREEN 与证据边界。

更新：来源核查、STATUS、CONTINUITY、ROADMAP。只有核查发现原来源记录错误时才改其事实，保留核查日期。

不改现有协议、store、backup、source、background、UI、manifest、CSP、依赖、构建配置或 CI。既有 tsconfig 包含 src/tests，既有 Vitest 自动发现新测试，无需增加 npm 脚本。

## 任务一：核查准入事实

- [ ] 阅读官方链接；分别记录读取、缓存、发送模型、导出、分发的边界和依据，不用开源插件存在作为许可证明。
- [ ] 保留当前结论 unresolved；若找到不同证据，写出处、适用范围与冲突，交总架构复核，不自行开启在线实验。
- [ ] 明确真实接口、DOM、账号及平台样本均未验证。只允许原创合成输入，不提交题干、题解、测试用例、Cookie、令牌、个人提交或原始 HAR。

验收：报告能区分条款事实、工程判断及未知项。无法取得授权也可完成离线任务，不虚报已接入。

## 任务二：先固定契约和反例

- [ ] 建 schema 与最小类型正确的函数占位：关联函数暂返回空 ok，哈希函数暂返回空字符串；先让下列行为测试失败，保留失败输出后再实现。不把缺模块/编译失败当行为 RED。
- [ ] 工厂使用固定 UUID、不同账户域与两个原创 slug；Context submissionId 为 `10001`，codeSha256 为 64 个 `a`，所有来源为 synthetic-fixture。Observation 默认与该 Context 同 key，phase final、verdict AC，辅助字段相同。工厂每次返回新对象。
- [ ] 把以下示例纳入测试，然后逐项展开 LC-01 至 LC-10 的输入与期望。

```ts
import { expect, it } from 'vitest';
import { correlateSubmissions, hashSubmittedCode } from '../src/core/submission-correlation';
import { makeContext, makeObservation } from './helpers/submission-evidence';

it('LC-01: returns the frozen submission context', () => {
  const context = makeContext();
  const result = correlateSubmissions({ contexts: [context], observations: [makeObservation()] });
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error('expected valid report');
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0]).toMatchObject({ status: 'matched', contextId: context.contextId, verdict: 'AC' });
});

it('LC-02: refuses a different submitted-code hash', () => {
  const result = correlateSubmissions({ contexts: [makeContext()], observations: [{ ...makeObservation(), codeSha256: 'b'.repeat(64) }] });
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error('expected valid report');
  expect(result.groups[0]).toMatchObject({ status: 'conflict', contextId: null, verdict: null, reason: 'IDENTITY_CONFLICT' });
});

it('LC-10: hashes exact UTF-8 content', async () => {
  expect(await hashSubmittedCode('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(await hashSubmittedCode('x\n')).not.toBe(await hashSubmittedCode('x\r\n'));
});
```

- [ ] 执行 `npm test -- tests/submission-correlation.test.ts`，确认行为断言失败，记录命令、退出码及失败条目。

## 任务三：实现纯关联并验证顺序

- [ ] 按 C-03 的七级优先顺序实现，先完整 schema 校验，再 observationId 去重，再按强身份分组。未知身份不得使用 tab、时间、代码相似度或当前会话补齐。
- [ ] Context 重复 key 和重复 contextId 分开处理：前者是 AMBIGUOUS_CONTEXT，后者是 schema invalid。
- [ ] 补齐逐项用例：两账号同 submissionId、同代码两 submissionId、无身份、无 Context、两个 Context、辅助字段冲突、判题顺序反转与 verdict 冲突。
- [ ] pending/final/unavailable 的全排列必须产生相同报告；重复次数变化不得改变最终判题。深冻结输入验证无修改，不只比较一个 happy path。
- [ ] 验证哈希空字符串、中文、缩进、换行差异、32,000 边界及超限拒绝；用已知摘要或独立标准结果断言，不调用待测函数生成期望值。
- [ ] 按仓库约束添加步骤块及开始/结束日志，只允许条数，不记录用户内容或标识。错误分类使用固定枚举。
- [ ] 重新运行定向测试并确认通过。不得为了测试通过放宽 schema 或把来源标为 platform。

## 任务四：回归、发布包隔离与交付

- [ ] apps/extension 下 `npm test`、`npm run build`，原 179 项必须仍通过，新用例另外统计。根目录 `node scripts/check-docs.mjs`、`git diff --check`。
- [ ] 检查 diff：无上述禁止文件变化；检查生成 dist 不含合成 slug、样本代码和测试入口。纯模块无生产 import，不增加发布行为。
- [ ] 在验收记录按 LC 编号列实际输入、预期、结果、失败到通过证据。分别列离线 schema、纯函数、原型回归、真实平台四层；最后一层写未运行，不继承原型浏览器通过数。
- [ ] 本任务未变 UI、权限或跨端行为，无需例行重复浏览器测试；如果发现必须改这些才能完成，停在范围冲突并交回总架构。
- [ ] 更新 STATUS、CONTINUITY、ROADMAP：任务 03 合成实验完成不等于 AC-06 通过，真实准入未满足时仍写 unresolved。
- [ ] `feat:`/`test:`/`docs:` 提交并推送独立 PR，等远端适用检查结束，交回提交、PR、验证和未测项。不合并 PR、不联络平台、不启用采集、不自行开始下一功能。

## 验收与停止点

完成 C-01 至 C-06 与 LC-01 至 LC-10 的限定交付即可交回，真实平台不可用不要求无限等待。交付若只有报告、缺少合成行为验证则未完成；若有真实采集但没有证据链和许可依据也不验收。总架构随后决定独立接入实验或手动记录路线。
