import { z } from 'zod';
import { actionRecordSchema, envelope, errorCodeSchema, eventSchema, manualProblemSnapshotSchema, sessionSchema, syntheticProblemSchema } from './protocol';
import { actionRecordSchema as legacyActionRecordSchema, eventSchema as legacyEventSchema, problemSchema as legacyProblemSchema, sessionSchema as legacySessionSchema } from './legacy-protocol';

export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
export const MAX_BACKUP_RECORDS = { problems: 1_000, sessions: 1_000, events: 10_000, actions: 10_000 } as const;
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const extensionId = z.string().regex(/^[a-p]{32}$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const id = z.uuid();
const backupSyntheticProblemSchema = syntheticProblemSchema.extend({ title: z.string().max(200), statement: z.string().max(32_000) });
export const backupProblemSchema = z.discriminatedUnion('source', [backupSyntheticProblemSchema, manualProblemSnapshotSchema]);
export const backupSessionSchema = sessionSchema.extend({ revision: safeInteger, createdAt: safeInteger, updatedAt: safeInteger });
export const backupEventSchema = eventSchema.extend({ revision: safeInteger, at: safeInteger, text: z.string().max(32_000).optional() });
export const backupActionSchema = actionRecordSchema.extend({
  fingerprint: z.string().max(256_000),
  result: actionRecordSchema.shape.result.extend({ session: backupSessionSchema }),
});
export const backupSourceSchema = z.strictObject({ appVersion: z.string().min(1).max(64), extensionId });
const legacyBackupSessionSchema = legacySessionSchema.extend({ revision: safeInteger, createdAt: safeInteger, updatedAt: safeInteger });
const legacyBackupActionSchema = legacyActionRecordSchema.extend({
  fingerprint: z.string().max(256_000),
  result: legacyActionRecordSchema.shape.result.extend({ session: legacyBackupSessionSchema }),
});
const backupV1Schema = z.strictObject({
  format: z.literal('algorhythm-backup'), formatVersion: z.literal(1), scope: z.literal('prototype-storage-v1'),
  backupId: id, exportedAt: safeInteger,
  source: backupSourceSchema,
  data: z.strictObject({
    problems: z.array(legacyProblemSchema.extend({ title: z.string().max(200), statement: z.string().max(32_000) })).max(MAX_BACKUP_RECORDS.problems),
    sessions: z.array(legacyBackupSessionSchema).max(MAX_BACKUP_RECORDS.sessions),
    events: z.array(legacyEventSchema.extend({ revision: safeInteger, at: safeInteger, text: z.string().max(32_000).optional() })).max(MAX_BACKUP_RECORDS.events),
    actions: z.array(legacyBackupActionSchema).max(MAX_BACKUP_RECORDS.actions),
  }),
});
const backupV2Schema = z.strictObject({
  format: z.literal('algorhythm-backup'), formatVersion: z.literal(2), scope: z.literal('practice-records-v2'),
  backupId: id, exportedAt: safeInteger,
  source: backupSourceSchema,
  data: z.strictObject({
    problems: z.array(backupProblemSchema).max(MAX_BACKUP_RECORDS.problems),
    sessions: z.array(backupSessionSchema).max(MAX_BACKUP_RECORDS.sessions),
    events: z.array(backupEventSchema).max(MAX_BACKUP_RECORDS.events),
    actions: z.array(backupActionSchema).max(MAX_BACKUP_RECORDS.actions),
  }),
});
export const backupSchema = z.discriminatedUnion('formatVersion', [backupV1Schema, backupV2Schema]);
export type Backup = z.infer<typeof backupSchema>;
const counts = z.strictObject({ problems: safeInteger, sessions: safeInteger, events: safeInteger, actions: safeInteger });
export const backupImportReceiptSchema = z.strictObject({
  backupId: id, digest, sourceExtensionId: extensionId, exportedAt: safeInteger, importedAt: safeInteger,
  added: counts, skipped: counts,
});
export type BackupImportReceipt = z.infer<typeof backupImportReceiptSchema>;
export const backupErrorCodeSchema = z.union([errorCodeSchema, z.enum([
  'BACKUP_INVALID', 'BACKUP_UNSUPPORTED_VERSION', 'BACKUP_TOO_LARGE', 'BACKUP_CONFLICT',
  'BACKUP_ID_COLLISION', 'BACKUP_DIGEST_MISMATCH',
])]);
export type BackupErrorCode = z.infer<typeof backupErrorCodeSchema>;
export const backupCommandSchema = z.discriminatedUnion('type', [
  envelope.extend({ type: z.literal('backup.export') }),
  envelope.extend({ type: z.literal('backup.import'), backup: backupSchema, expectedDigest: digest }),
  envelope.extend({ type: z.literal('backup.query'), backupId: id, expectedDigest: digest }),
]);
export type BackupCommand = z.infer<typeof backupCommandSchema>;
export const backupResponseSchema = z.union([
  z.strictObject({ ok: z.literal(true), kind: z.literal('backup.exported'), actionId: id, backup: backupSchema }),
  z.strictObject({ ok: z.literal(true), kind: z.literal('backup.imported'), actionId: id, receipt: backupImportReceiptSchema }),
  z.strictObject({ ok: z.literal(true), kind: z.literal('backup.status'), actionId: id, backupId: id, digest, receipt: backupImportReceiptSchema.nullable() }),
  z.strictObject({ ok: z.literal(false), actionId: id.nullable(), code: backupErrorCodeSchema }),
]);
export type BackupResponse = z.infer<typeof backupResponseSchema>;
