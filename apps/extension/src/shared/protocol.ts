import { z } from 'zod';
import { manualProblemSchema } from './manual-problem';

export const PROTOCOL_VERSION = 2;
export const MAX_DRAFT_LENGTH = 32_000;
const id = z.uuid();
const revision = z.number().int().nonnegative();
export const syntheticProblemKeySchema = z.enum(['unique', 'pair']);
export const problemKeySchema = z.enum(['unique', 'pair', 'manual']);
export const envelope = z.strictObject({ protocolVersion: z.literal(PROTOCOL_VERSION), extensionId: z.string().min(1).max(64), actionId: id });
const scoped = envelope.extend({ sessionId: id, problemSnapshotId: id, expectedRevision: revision });
export const commandSchema = z.discriminatedUnion('type', [
  envelope.extend({ type: z.literal('start'), sessionId: id, problemSnapshotId: id, problemKey: syntheticProblemKeySchema }),
  envelope.extend({ type: z.literal('startManual'), sessionId: id, problemSnapshotId: id, title: manualProblemSchema.shape.title, url: manualProblemSchema.shape.url }),
  envelope.extend({ type: z.literal('read') }),
  envelope.extend({ type: z.literal('queryAction'), targetActionId: id }),
  scoped.extend({ type: z.literal('saveDraft'), text: z.string().max(MAX_DRAFT_LENGTH) }),
  scoped.extend({ type: z.literal('recordAttempt') }),
  scoped.extend({ type: z.literal('pause') }),
  scoped.extend({ type: z.literal('resume') }),
]);
export type Command = z.infer<typeof commandSchema>;
export type WriteCommand = Exclude<Command, { type: 'read' | 'queryAction' }>;
export const sessionSchema = z.strictObject({
  id, problemSnapshotId: id, problemKey: problemKeySchema,
  status: z.enum(['active', 'paused']), revision, draft: z.string().max(MAX_DRAFT_LENGTH),
  createdAt: z.number(), updatedAt: z.number(),
});
export type Session = z.infer<typeof sessionSchema>;
export const syntheticProblemSchema = z.strictObject({ id, key: syntheticProblemKeySchema, title: z.string(), statement: z.string(), source: z.literal('synthetic-v1') });
export const manualProblemSnapshotSchema = manualProblemSchema.extend({ id, key: z.literal('manual'), statement: z.literal(''), source: z.literal('manual-user-v1') });
export const problemSchema = z.discriminatedUnion('source', [syntheticProblemSchema, manualProblemSnapshotSchema]);
export type Problem = z.infer<typeof problemSchema>;
export const eventSchema = z.strictObject({
  id, actionId: id, sessionId: id, problemSnapshotId: id, revision, at: z.number(),
  kind: z.enum(['started', 'draft', 'attempt', 'paused', 'resumed']),
  source: z.enum(['synthetic-workspace', 'manual-workspace']), text: z.string().optional(),
});
export type LearningEvent = z.infer<typeof eventSchema>;
export const errorCodeSchema = z.enum([
  'FORBIDDEN', 'PROTOCOL_MISMATCH', 'INSTANCE_MISMATCH', 'INVALID_COMMAND',
  'NOT_FOUND', 'REFERENCE_MISMATCH', 'REVISION_CONFLICT', 'ACTION_COLLISION',
  'INVALID_STATE', 'STORAGE_FULL', 'STORAGE_DENIED', 'STORAGE_FAILED',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
const committedSchema = z.strictObject({ ok: z.literal(true), kind: z.literal('committed'), actionId: id, session: sessionSchema });
export type Committed = z.infer<typeof committedSchema>;
export const responseSchema = z.union([
  committedSchema,
  z.strictObject({ ok: z.literal(true), kind: z.literal('snapshot'), actionId: id, sessions: z.array(sessionSchema), problems: z.array(problemSchema), events: z.array(eventSchema) }),
  z.strictObject({ ok: z.literal(true), kind: z.literal('action'), actionId: id, result: committedSchema.nullable() }),
  z.strictObject({ ok: z.literal(false), actionId: id.nullable(), code: errorCodeSchema }),
]);
export type Response = z.infer<typeof responseSchema>;
export type Snapshot = Extract<Response, { kind: 'snapshot' }>;
export const actionRecordSchema = z.strictObject({ id, fingerprint: z.string(), result: committedSchema });
export type ActionRecord = z.infer<typeof actionRecordSchema>;
export const diagnosticSchema = z.strictObject({ id, actionId: id.nullable(), code: errorCodeSchema, at: z.number() });
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export const SYNTHETIC_PROBLEMS = {
  unique: { key: 'unique', title: '找出重复编号', statement: '给定一组整数编号，判断是否有编号出现超过一次。\n\n例：[8, 3, 5, 3] → True\n例：[8, 3, 5] → False\n\n先写下一个可行的办法，再考虑能否少做一些重复查找。', source: 'synthetic-v1' },
  pair: { key: 'pair', title: '寻找相邻差值', statement: '给定一个递增整数数组，返回所有相邻元素差值的最小值。数组至少有两个元素。\n\n例：[2, 6, 9, 15] → 3\n\n写出需要保留哪些信息，以及每次向后移动时怎样更新。', source: 'synthetic-v1' },
} satisfies Record<z.infer<typeof syntheticProblemKeySchema>, Omit<z.infer<typeof syntheticProblemSchema>, 'id'>>;
