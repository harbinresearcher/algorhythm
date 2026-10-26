import { correlationInputSchema, type CorrelationGroup, type CorrelationReport, type SubmissionContext, type SubmissionObservation } from '../shared/submission-evidence';

const logger = console;

export async function hashSubmittedCode(code: string): Promise<string> {
  /*
   * ========================================================================
   * 步骤1：计算提交原字符串的摘要
   * ========================================================================
   * 数据源：调用者冻结的原创提交代码，不读取编辑器或平台。
   * 操作：1) 按 UTF-16 长度检查边界。2) 对原 UTF-8 字节计算 SHA-256，不规范化空白。
   */
  logger.info('开始计算提交摘要');
  try {
    // 1.1 拒绝隐式字符串转换，错误不携带原代码。
    if (typeof code !== 'string') throw new TypeError('INVALID_CODE');
    if (code.length > 32_000) throw new RangeError('CODE_TOO_LARGE');
    // 1.2 TextEncoder 保留原始缩进及换行，不记录摘要或内容。
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  } finally { logger.info('提交摘要计算结束'); }
}

export function correlateSubmissions(input: unknown): CorrelationReport {
  /*
   * ========================================================================
   * 步骤1：整批校验并按强身份关联观察
   * ========================================================================
   * 数据源：独立 schema 校验的冻结 Context 和合成 Observation。
   * 操作：1) 先拒绝非法批次和观察 ID 碰撞。2) 元组分组并按七级优先顺序决策。
   */
  logger.info('开始关联合成提交');
  let contextCount = 0; let observationCount = 0;
  try {
    // 1.1 无效批次不泄露原输入或部分匹配，包括非 JSON 对象的读取异常。
    let parsed: ReturnType<typeof correlationInputSchema.safeParse>;
    try { parsed = correlationInputSchema.safeParse(input); }
    catch { return { status: 'invalid', reason: 'INVALID_INPUT' }; }
    if (!parsed.success) return { status: 'invalid', reason: 'INVALID_INPUT' };
    const { contexts, observations } = parsed.data;
    contextCount = contexts.length; observationCount = observations.length;
    // 1.2 schema 输出固定字段顺序，字段排列不同的同一观察仍可去重。
    const unique = new Map<string, SubmissionObservation>();
    for (const observation of observations) {
      const previous = unique.get(observation.observationId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(observation)) return { status: 'invalid', reason: 'DUPLICATE_OBSERVATION' };
      unique.set(observation.observationId, observation);
    }
    // 1.3 使用序列化元组作 Map 键，不借时间、标签或代码猜强身份。
    const contextIndex = new Map<string, SubmissionContext[]>();
    for (const context of contexts) {
      if (context.submissionId === null) continue;
      const key = JSON.stringify([context.site, context.accountScopeId, context.submissionId]);
      const matching = contextIndex.get(key) ?? []; matching.push(context); contextIndex.set(key, matching);
    }
    const grouped = new Map<string, { key: CorrelationGroup['key']; rows: SubmissionObservation[] }>();
    const unresolved: string[] = [];
    for (const observation of unique.values()) {
      const { site, accountScopeId, submissionId } = observation;
      if (accountScopeId === null || submissionId === null) { unresolved.push(observation.observationId); continue; }
      const key: CorrelationGroup['key'] = [site, accountScopeId, submissionId]; const encoded = JSON.stringify(key);
      const group = grouped.get(encoded) ?? { key, rows: [] }; group.rows.push(observation); grouped.set(encoded, group);
    }
    // 1.4 首个适用规则决定结果，重复次数和 observedAt 不参与择新。
    const groups: CorrelationGroup[] = [];
    for (const [encoded, { key, rows }] of grouped) {
      const matching = contextIndex.get(encoded) ?? []; const context = matching[0];
      const base = { key, observationIds: rows.map((row) => row.observationId).sort() };
      if (matching.length > 1) groups.push({ ...base, status: 'conflict', contextId: null, verdict: null, reason: 'AMBIGUOUS_CONTEXT' });
      else if (!context) groups.push({ ...base, status: 'unlinked', contextId: null, verdict: null, reason: 'NO_CONTEXT' });
      else if (rows.some((row) => (row.slug !== null && row.slug !== context.slug) ||
        (row.language !== null && row.language !== context.language) || (row.codeSha256 !== null && row.codeSha256 !== context.codeSha256))) {
        groups.push({ ...base, status: 'conflict', contextId: null, verdict: null, reason: 'IDENTITY_CONFLICT' });
      } else {
        const finals = new Set<NonNullable<SubmissionObservation['verdict']>>();
        for (const row of rows) if (row.phase === 'final' && row.verdict !== null) finals.add(row.verdict);
        const verdict = finals.values().next().value;
        if (finals.size > 1) groups.push({ ...base, status: 'conflict', contextId: null, verdict: null, reason: 'RESULT_CONFLICT' });
        else if (verdict !== undefined) groups.push({ ...base, status: 'matched', contextId: context.contextId, verdict, reason: null });
        else if (rows.some((row) => row.phase === 'unavailable')) groups.push({ ...base, status: 'unavailable', contextId: context.contextId, verdict: null, reason: 'RESULT_UNAVAILABLE' });
        else groups.push({ ...base, status: 'pending', contextId: context.contextId, verdict: null, reason: null });
      }
    }
    // 1.5 逐字段字典序，返回新数组；不修改调用者的会话、观察或排序。
    groups.sort((a, b) => {
      for (let index = 0; index < 3; index++) { if (a.key[index] < b.key[index]) return -1; if (a.key[index] > b.key[index]) return 1; }
      return 0;
    });
    return { status: 'ok', groups, unresolved: unresolved.sort() };
  } finally { logger.info('合成提交关联结束', { contexts: contextCount, observations: observationCount }); }
}
