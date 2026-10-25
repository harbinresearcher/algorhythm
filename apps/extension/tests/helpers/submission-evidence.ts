import type { SubmissionContext, SubmissionObservation } from '../../src/shared/submission-evidence';

const logger = console;
export function makeContext(overrides: Partial<SubmissionContext> = {}): SubmissionContext {
  /*
   * ========================================================================
   * 步骤1：创建原创合成提交上下文
   * ========================================================================
   * 数据源：固定测试 UUID 与原创 slug，不读取平台或账号。
   * 操作：1) 返回 schema 推导类型。2) 每次分配新对象，允许用例覆写字段。
   */
  logger.info('开始创建合成上下文');
  try {
    // 1.1 这些隔离标识只用于离线实验，不是平台提交样本。
    return { schemaVersion: 1, site: 'leetcode.cn', provenance: 'synthetic-fixture',
      contextId: '00000000-0000-4000-8000-000000000001', sessionId: '00000000-0000-4000-8000-000000000002',
      attemptId: '00000000-0000-4000-8000-000000000003', accountScopeId: '00000000-0000-4000-8000-000000000004',
      captureEpoch: '00000000-0000-4000-8000-000000000005', tabId: 1, documentId: 'fixture-document-alpha', slug: 'fixture-alpha',
      language: 'python3', codeSha256: 'a'.repeat(64), submissionId: '10001', ...overrides };
  } finally { logger.info('合成上下文创建结束'); }
}
export function makeObservation(overrides: Partial<SubmissionObservation> = {}): SubmissionObservation {
  /*
   * ========================================================================
   * 步骤1：创建与默认上下文同身份的合成观察
   * ========================================================================
   * 数据源：原创上下文默认值，不模拟真实响应格式。
   * 操作：1) 默认 final/AC。2) 每次返回新对象，重复 ID 留给被测函数核对。
   */
  logger.info('开始创建合成观察');
  try {
    // 1.1 辅助字段和强身份都来自同一份合成默认值。
    const context = makeContext();
    return { schemaVersion: 1, site: 'leetcode.cn', provenance: 'synthetic-fixture',
      observationId: '00000000-0000-4000-8000-000000000006', accountScopeId: context.accountScopeId, submissionId: context.submissionId,
      slug: context.slug, language: context.language, codeSha256: context.codeSha256, phase: 'final', verdict: 'AC', observedAt: 100, ...overrides };
  } finally { logger.info('合成观察创建结束'); }
}
