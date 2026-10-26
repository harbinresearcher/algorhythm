import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { correlateSubmissions, hashSubmittedCode } from '../src/core/submission-correlation';
import { correlationReportSchema, type CorrelationGroup, type SubmissionObservation } from '../src/shared/submission-evidence';
import { makeContext, makeObservation } from './helpers/submission-evidence';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const report = (input: unknown) => {
  const result = correlateSubmissions(input);
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error('expected valid report');
  expect(correlationReportSchema.safeParse(result).success).toBe(true);
  return result;
};
const first = (observations = [makeObservation()], contexts = [makeContext()]): CorrelationGroup => {
  const result = report({ contexts, observations }); expect(result.groups).toHaveLength(1); return result.groups[0];
};
function permutations<T>(items: T[]): T[][] {
  if (!items.length) return [[]];
  return items.flatMap((value, index) => permutations(items.filter((_, position) => position !== index)).map((rest) => [value, ...rest]));
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
afterEach(() => vi.restoreAllMocks());

/*
 * ========================================================================
 * 步骤1：固定提交身份与七级决策优先顺序
 * ========================================================================
 * 数据源：原创工厂创建的独立账号、提交和迟到观察。
 * 操作：1) 用字面量期望捕捉错绑。2) 全排列验证判题不受到达顺序影响。
 */
describe('LC-01 至 LC-08 离线提交关联', () => {
  it('LC-01 返回提交时冻结的contextId和强身份元组', () => {
    const context = makeContext();
    expect(first()).toEqual({ key: ['leetcode.cn', context.accountScopeId, '10001'], observationIds: [id(6)],
      status: 'matched', contextId: context.contextId, verdict: 'AC', reason: null });
  });
  it('LC-01 只有pending时不伪造判题', () => {
    expect(first([makeObservation({ phase: 'pending', verdict: null })])).toMatchObject({ status: 'pending', contextId: id(1), verdict: null, reason: null });
  });
  it('LC-01 辅助字段缺失不阻断唯一强身份', () => {
    expect(first([makeObservation({ slug: null, language: null, codeSha256: null })])).toMatchObject({ status: 'matched', contextId: id(1), verdict: 'AC' });
  });
  it('LC-02 同强身份下当前编辑代码B不能覆盖提交代码A', () => {
    const context = makeContext(); const before = structuredClone(context);
    expect(first([makeObservation({ codeSha256: 'b'.repeat(64) })], [context])).toMatchObject({ status: 'conflict', contextId: null, verdict: null, reason: 'IDENTITY_CONFLICT' });
    expect(context).toEqual(before);
  });
  it('LC-03 换题切标签后A的迟到结果仍归A', () => {
    const a = makeContext(); const b = makeContext({ contextId: id(20), sessionId: id(21), attemptId: id(22), captureEpoch: id(23), tabId: 2,
      documentId: 'fixture-document-beta', slug: 'fixture-beta', submissionId: '10002' });
    expect(first([makeObservation({ observedAt: Number.MAX_SAFE_INTEGER })], [b, a])).toMatchObject({ status: 'matched', contextId: a.contextId, verdict: 'AC' });
  });
  it('LC-04 同代码两次提交按submissionId分别绑定', () => {
    const result = report({ contexts: [makeContext({ contextId: id(20), submissionId: '10002' }), makeContext()],
      observations: [makeObservation({ observationId: id(7), submissionId: '10002', verdict: 'WA' }), makeObservation()] });
    expect(result.groups.map(({ key, contextId, verdict }) => ({ key, contextId, verdict }))).toEqual([
      { key: ['leetcode.cn', id(4), '10001'], contextId: id(1), verdict: 'AC' },
      { key: ['leetcode.cn', id(4), '10002'], contextId: id(20), verdict: 'WA' },
    ]);
  });
  it('LC-05 完全重复观察按ID去重，忽略对象字段排列差异', () => {
    const observation = makeObservation(); const reordered = Object.fromEntries(Object.entries(observation).reverse());
    expect(report({ contexts: [makeContext()], observations: [observation, reordered, observation] }).groups[0]).toEqual(first());
  });
  it.each([{ verdict: 'WA' }, { observedAt: 101 }, { accountScopeId: null }, { slug: 'fixture-beta' }])('LC-05 同ID不同内容整批invalid %j', (change) => {
    const observation = makeObservation();
    expect(correlateSubmissions({ contexts: [makeContext()], observations: [observation, { ...observation, ...change }] })).toEqual({ status: 'invalid', reason: 'DUPLICATE_OBSERVATION' });
  });
  it('LC-06 pending/final/unavailable的六个排列均保留final，忽略observedAt择新', () => {
    const observations = [makeObservation({ observationId: id(9), phase: 'pending', verdict: null, observedAt: 999 }),
      makeObservation({ observationId: id(7), observedAt: 0 }), makeObservation({ observationId: id(8), phase: 'unavailable', verdict: null, observedAt: 1000 })];
    const expected = { key: ['leetcode.cn', id(4), '10001'], observationIds: [id(7), id(8), id(9)],
      status: 'matched', contextId: id(1), verdict: 'AC', reason: null };
    for (const ordering of permutations(observations)) expect(first(ordering)).toEqual(expected);
    for (const ordering of permutations(observations)) expect(first([...ordering, ...ordering, ordering[0]])).toEqual(expected);
  });
  it('LC-06 冲突final的所有24个排列均冲突', () => {
    const observations = [makeObservation({ observationId: id(7), verdict: 'AC', observedAt: 100 }), makeObservation({ observationId: id(8), verdict: 'WA', observedAt: 0 }),
      makeObservation({ observationId: id(9), phase: 'pending', verdict: null }), makeObservation({ observationId: id(10), phase: 'unavailable', verdict: null })];
    for (const ordering of permutations(observations)) expect(first(ordering)).toEqual({ key: ['leetcode.cn', id(4), '10001'],
      status: 'conflict', contextId: null, verdict: null, reason: 'RESULT_CONFLICT', observationIds: [id(7), id(8), id(9), id(10)] });
  });
  it('LC-06 无final时unavailable优先于pending', () => {
    const observations = [makeObservation({ observationId: id(7), phase: 'pending', verdict: null }), makeObservation({ observationId: id(8), phase: 'unavailable', verdict: null })];
    for (const ordering of permutations(observations)) expect(first(ordering)).toMatchObject({ status: 'unavailable', contextId: id(1), verdict: null, reason: 'RESULT_UNAVAILABLE' });
  });
  it.each(['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE'] as const)('LC-06 重复一致final保留%s', (verdict) => {
    expect(first([makeObservation({ verdict }), makeObservation({ observationId: id(7), verdict })])).toMatchObject({ status: 'matched', verdict });
  });
  it('LC-07 两账号同submissionId分组且账户序优先于提交序', () => {
    const result = report({ contexts: [makeContext({ contextId: id(20), accountScopeId: id(30) }), makeContext()],
      observations: [makeObservation({ observationId: id(7), accountScopeId: id(30), verdict: 'WA' }), makeObservation()] });
    expect(result.groups.map(({ key, contextId, verdict }) => ({ key, contextId, verdict }))).toEqual([
      { key: ['leetcode.cn', id(4), '10001'], contextId: id(1), verdict: 'AC' },
      { key: ['leetcode.cn', id(30), '10001'], contextId: id(20), verdict: 'WA' },
    ]);
  });
  it('LC-07 缺失任一身份只入有序unresolved，不借时间代码或标签补齐', () => {
    const observations = [makeObservation({ observationId: id(9), accountScopeId: null }), makeObservation({ observationId: id(7), submissionId: null }),
      makeObservation({ observationId: id(8), accountScopeId: null, submissionId: null })];
    expect(report({ contexts: [makeContext()], observations: [...observations, observations[0]] })).toEqual({ status: 'ok', groups: [], unresolved: [id(7), id(8), id(9)] });
  });
  it('LC-07 数字字符串不做数值归一，元组按字典序排序', () => {
    const result = report({ contexts: [], observations: ['2', '10', '0002'].map((submissionId, index) => makeObservation({ observationId: id(10 + index), submissionId })) });
    expect(result.groups.map(({ key }) => key[2])).toEqual(['0002', '10', '2']);
  });
  it('LC-08 同key两个Context即使代码相同也不任选，且优先于辅助/结果矛盾', () => {
    expect(first([makeObservation({ slug: 'fixture-beta' }), makeObservation({ observationId: id(7), verdict: 'WA' })],
      [makeContext(), makeContext({ contextId: id(20), sessionId: id(21), attemptId: id(22) })])).toMatchObject({ status: 'conflict', contextId: null, verdict: null, reason: 'AMBIGUOUS_CONTEXT' });
  });
  it('LC-08 无Context先unlinked，不借两条一致观察建立绑定', () => {
    expect(first([makeObservation(), makeObservation({ observationId: id(7) })], [])).toMatchObject({ status: 'unlinked', contextId: null, verdict: null, reason: 'NO_CONTEXT' });
    expect(first([makeObservation(), makeObservation({ observationId: id(7), verdict: 'WA', slug: 'fixture-beta' })], [])).toMatchObject({ reason: 'NO_CONTEXT' });
  });
  it('LC-08 唯一Context的辅助矛盾先于final矛盾', () => {
    expect(first([makeObservation(), makeObservation({ observationId: id(7), verdict: 'WA', slug: 'fixture-beta' })])).toMatchObject({ status: 'conflict', contextId: null, verdict: null, reason: 'IDENTITY_CONFLICT' });
  });
  it('LC-08 无观察的Context不生成组，包括无submissionId的Context', () => {
    expect(report({ contexts: [makeContext({ submissionId: null })], observations: [] })).toEqual({ status: 'ok', groups: [], unresolved: [] });
  });
});

/*
 * ========================================================================
 * 步骤2：验证整批输入边界与无副作用
 * ========================================================================
 * 数据源：独立字段反例、冻结对象和标准 SHA-256 结果。
 * 操作：1) 非法输入只返回固定错误。2) 精确 UTF-8 内容和所有排列不得修改输入。
 */
describe('LC-09/10 严格边界与原字符串哈希', () => {
  it.each([
    null, [], 1, {}, { contexts: [], observations: [], extra: true },
    { contexts: [makeContext(), makeContext()], observations: [makeObservation()] },
    { contexts: [makeContext()], observations: [{ ...makeObservation(), phase: 'final', verdict: null }] },
    { contexts: [makeContext()], observations: [{ ...makeObservation(), phase: 'pending', verdict: 'AC' }] },
    { contexts: [makeContext()], observations: [{ ...makeObservation(), phase: 'unavailable', verdict: 'WA' }] },
    { contexts: [makeContext()], observations: [{ ...makeObservation(), phase: 'unknown' }] },
    { contexts: [makeContext()], observations: [{ ...makeObservation(), verdict: 'UNKNOWN' }] },
    { contexts: [makeContext()], observations: [{ ...makeObservation(), observedAt: Number.MAX_SAFE_INTEGER + 1 }] },
    { contexts: [makeContext()], observations: [{ ...makeObservation(), observedAt: -1 }] },
    { contexts: [makeContext()], observations: [{ ...makeObservation(), accountScopeId: 'account' }] },
    { contexts: [makeContext()], observations: [{ ...makeObservation(), unexpected: 'PRIVATE_SENTINEL' }] },
    { contexts: [makeContext()], observations: [{ ...makeObservation(), schemaVersion: 2 }] },
  ])('LC-09 整批schema失败不返回部分结果 %#', (input) => {
    expect(correlateSubmissions(input)).toEqual({ status: 'invalid', reason: 'INVALID_INPUT' });
  });
  it.each([
    ['contextId', 'bad'], ['sessionId', null], ['attemptId', 'bad'], ['captureEpoch', 'bad'], ['accountScopeId', null],
    ['tabId', -1], ['tabId', 0.5], ['tabId', Number.MAX_SAFE_INTEGER + 1], ['tabId', '1'],
    ['documentId', ''], ['documentId', 'x'.repeat(129)], ['slug', ''], ['slug', 'Upper'], ['slug', 'has space'], ['slug', 'a'.repeat(201)],
    ['language', 'python'], ['codeSha256', 'A'.repeat(64)], ['codeSha256', 'a'.repeat(63)], ['submissionId', 10001], ['submissionId', ''],
    ['submissionId', '1'.repeat(65)], ['submissionId', '-1'], ['site', 'leetcode.com'], ['provenance', 'platform'], ['schemaVersion', 2], ['unknown', true],
  ])('LC-09 Context字段%s拒绝越界或错误类型', (field, value) => {
    expect(correlateSubmissions({ contexts: [{ ...makeContext(), [field]: value }], observations: [makeObservation()] })).toEqual({ status: 'invalid', reason: 'INVALID_INPUT' });
  });
  it.each(['slug', 'language', 'codeSha256', 'submissionId', 'site', 'provenance'] as const)('LC-09 Observation的%s也复用严格约束', (field) => {
    expect(correlateSubmissions({ contexts: [makeContext()], observations: [{ ...makeObservation(), [field]: 'PRIVATE_SENTINEL' }] })).toEqual({ status: 'invalid', reason: 'INVALID_INPUT' });
  });
  it('LC-09 两个数组200边界允许，201即使会去重也拒绝', () => {
    const contexts = Array.from({ length: 200 }, (_, index) => makeContext({ contextId: id(100 + index), submissionId: String(20000 + index) }));
    const observations = Array.from({ length: 200 }, (_, index) => makeObservation({ observationId: id(500 + index) }));
    expect(report({ contexts, observations }).groups[0].observationIds).toHaveLength(200);
    expect(correlateSubmissions({ contexts: [...contexts, makeContext()], observations: [] })).toEqual({ status: 'invalid', reason: 'INVALID_INPUT' });
    expect(correlateSubmissions({ contexts: [], observations: [...observations, observations[0]] })).toEqual({ status: 'invalid', reason: 'INVALID_INPUT' });
  });
  it('LC-09 字符长度与安全整数上边界允许，不截断', () => {
    const context = makeContext({ slug: 'a'.repeat(200), documentId: 'x'.repeat(128), tabId: Number.MAX_SAFE_INTEGER, submissionId: '0'.repeat(64) });
    expect(first([makeObservation({ slug: context.slug, submissionId: context.submissionId, observedAt: Number.MAX_SAFE_INTEGER })], [context])).toMatchObject({ status: 'matched', contextId: id(1) });
  });
  it('LC-09 一条invalid优先于重复观察冲突，不返回先前匹配', () => {
    expect(correlateSubmissions({ contexts: [makeContext()], observations: [makeObservation(), makeObservation({ verdict: 'WA' }), { ...makeObservation(), extra: true }] })).toEqual({ status: 'invalid', reason: 'INVALID_INPUT' });
  });
  it('LC-09 schema本身拒绝伪造成功状态与未知输出字段', () => {
    expect(correlationReportSchema.safeParse({ status: 'ok', groups: [{ key: ['leetcode.cn', id(4), '10001'], status: 'matched', contextId: null, verdict: 'AC', reason: null, observationIds: [id(6)] }], unresolved: [] }).success).toBe(false);
    expect(correlationReportSchema.safeParse({ status: 'invalid', reason: 'INVALID_INPUT', payload: 'PRIVATE_SENTINEL' }).success).toBe(false);
  });
  it('LC-10 所有输入排列、重复观察和深冻结对象均不被修改', () => {
    const observations: SubmissionObservation[] = [makeObservation({ observationId: id(9), phase: 'pending', verdict: null }),
      makeObservation({ observationId: id(7) }), makeObservation({ observationId: id(8), phase: 'unavailable', verdict: null })];
    for (const ordering of permutations(observations)) {
      const input = freeze({ contexts: [makeContext()], observations: [...ordering, ordering[0]] }); const before = structuredClone(input);
      expect(report(input).groups[0]).toMatchObject({ status: 'matched', verdict: 'AC' }); expect(input).toEqual(before);
    }
  });
  it('LC-10 工厂返回独立对象而非共享快照', () => {
    const firstContext = makeContext(); firstContext.slug = 'fixture-beta';
    const firstObservation = makeObservation(); firstObservation.verdict = 'WA';
    expect(makeContext().slug).toBe('fixture-alpha'); expect(makeObservation().verdict).toBe('AC');
  });
  it('LC-10 日志仅含开始结束和条数，不含任何标识/内容', async () => {
    correlateSubmissions({ contexts: [makeContext()], observations: [makeObservation()] }); await hashSubmittedCode('fixture-secret-code');
    const log = JSON.stringify(vi.mocked(console.info).mock.calls);
    for (const marker of ['fixture-alpha', 'fixture-secret-code', '10001', id(1), id(4), id(6), 'a'.repeat(64)]) expect(log).not.toContain(marker);
  });
  it('LC-10 空输入是严格的空报告', () => { expect(report({ contexts: [], observations: [] })).toEqual({ status: 'ok', groups: [], unresolved: [] }); });
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ])('LC-10 已知SHA-256向量 %#', async (code, digest) => { expect(await hashSubmittedCode(code)).toBe(digest); });
  it.each(['中文\n', '    return 1\n', 'return 1\r\n', '😀'.repeat(16_000), 'x'.repeat(32_000)])('LC-10 精确UTF-8和32000边界 %#', async (code) => {
    expect(await hashSubmittedCode(code)).toBe(createHash('sha256').update(code, 'utf8').digest('hex'));
  });
  it('LC-10 不trim、不改缩进、不改换行', async () => {
    expect(await hashSubmittedCode('x\n')).not.toBe(await hashSubmittedCode('x\r\n'));
    expect(await hashSubmittedCode('x')).not.toBe(await hashSubmittedCode(' x'));
    expect(await hashSubmittedCode('x')).not.toBe(await hashSubmittedCode('x '));
  });
  it.each(['x'.repeat(32_001), '😀'.repeat(16_000) + 'x'])('LC-10 超过32000 UTF-16 units拒绝 %#', async (code) => {
    await expect(hashSubmittedCode(code)).rejects.toBeInstanceOf(RangeError);
  });
});
