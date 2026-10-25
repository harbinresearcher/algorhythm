import { z } from 'zod';

const uuid = z.uuid();
const submissionId = z.string().regex(/^[0-9]{1,64}$/);
const slug = z.string().regex(/^[a-z0-9-]{1,200}$/);
const language = z.literal('python3');
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const source = z.strictObject({ schemaVersion: z.literal(1), site: z.literal('leetcode.cn'), provenance: z.literal('synthetic-fixture') });
export const submissionContextSchema = source.extend({
  contextId: uuid, sessionId: uuid, attemptId: uuid, accountScopeId: uuid, captureEpoch: uuid,
  tabId: safeInteger, documentId: z.string().min(1).max(128), slug, language, codeSha256: digest, submissionId: submissionId.nullable(),
});
export type SubmissionContext = z.infer<typeof submissionContextSchema>;
export const submissionObservationSchema = source.extend({
  observationId: uuid, accountScopeId: uuid.nullable(), submissionId: submissionId.nullable(),
  slug: slug.nullable(), language: language.nullable(), codeSha256: digest.nullable(),
  phase: z.enum(['pending', 'final', 'unavailable']), verdict: z.enum(['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE']).nullable(), observedAt: safeInteger,
}).refine((row) => (row.phase === 'final') === (row.verdict !== null));
export type SubmissionObservation = z.infer<typeof submissionObservationSchema>;
export const correlationInputSchema = z.strictObject({
  contexts: z.array(submissionContextSchema).max(200), observations: z.array(submissionObservationSchema).max(200),
}).refine(({ contexts }) => new Set(contexts.map((row) => row.contextId)).size === contexts.length);
export type CorrelationInput = z.infer<typeof correlationInputSchema>;
const group = z.strictObject({
  key: z.tuple([z.literal('leetcode.cn'), uuid, submissionId]), observationIds: z.array(uuid).max(200),
});
const verdict = z.enum(['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE']);
export const correlationGroupSchema = z.discriminatedUnion('status', [
  group.extend({ status: z.literal('matched'), contextId: uuid, verdict, reason: z.null() }),
  group.extend({ status: z.literal('pending'), contextId: uuid, verdict: z.null(), reason: z.null() }),
  group.extend({ status: z.literal('unavailable'), contextId: uuid, verdict: z.null(), reason: z.literal('RESULT_UNAVAILABLE') }),
  group.extend({ status: z.literal('unlinked'), contextId: z.null(), verdict: z.null(), reason: z.literal('NO_CONTEXT') }),
  group.extend({ status: z.literal('conflict'), contextId: z.null(), verdict: z.null(), reason: z.enum(['AMBIGUOUS_CONTEXT', 'IDENTITY_CONFLICT', 'RESULT_CONFLICT']) }),
]);
export type CorrelationGroup = z.infer<typeof correlationGroupSchema>;
export const correlationReportSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('invalid'), reason: z.enum(['INVALID_INPUT', 'DUPLICATE_OBSERVATION']) }),
  z.strictObject({ status: z.literal('ok'), groups: z.array(correlationGroupSchema).max(200), unresolved: z.array(uuid).max(200) }),
]);
export type CorrelationReport = z.infer<typeof correlationReportSchema>;
