import type { AlgoRhythmDB } from './db';
import type { AIConfig } from './types';

export type HintLevel = 0 | 1 | 2 | 3;
export type SessionStatus = 'active' | 'ended';
export type RequestStatus =
  'pending' | 'succeeded' | 'failed' | 'expired' | 'superseded' | 'cancelled';
export type AnswerExposure = 'none' | 'possible' | 'explicit';
export type CallErrorCode = 'INVALID_CONFIG' | 'NETWORK' | 'TIMEOUT' | 'HTTP' | 'INVALID_OUTPUT';
export type PracticeErrorCode =
  | CallErrorCode
  | 'NOT_FOUND'
  | 'SESSION_ENDED'
  | 'INVALID_EVENT'
  | 'REQUEST_CONFLICT'
  | 'BUSY'
  | 'STALE_ATTEMPT'
  | 'HINT_LIMIT'
  | 'RETRY_NOT_ALLOWED';

export class PracticeError extends Error {
  constructor(public readonly code: PracticeErrorCode) {
    super(`练习操作未完成（${code}）。`);
    this.name = 'PracticeError';
  }
}

export interface PracticeSummary {
  attemptCount: number;
  usedHintLevels: HintLevel[];
  answerExposure: AnswerExposure;
  exposureVerification: 'unverified';
  unverifiedItems: string[];
  endedAt: number;
}
export interface PracticeSession {
  id: string;
  problemId: string;
  problemSnapshot: { title: string; description: string; url: string };
  status: SessionStatus;
  hintLevel: HintLevel;
  latestAttemptId?: string;
  currentRequestId?: string;
  createdAt: number;
  updatedAt: number;
  summary?: PracticeSummary;
}
export interface PracticeAttempt {
  id: string;
  sessionId: string;
  thought: string;
  code: string;
  selfReportedTests?: { text: string; basis: 'user-report' };
  createdAt: number;
}
export interface PracticeRequest {
  id: string;
  sessionId: string;
  attemptId: string;
  action: 'submit' | 'hint';
  hintLevel: HintLevel;
  status: RequestStatus;
  createdAt: number;
  expiresAt: number;
  retryOf?: string;
  errorCode?: CallErrorCode;
}
export interface CoachReply {
  assessment: string;
  nextQuestion: string;
  hint: string;
  hintLevel: HintLevel;
  answerExposure: AnswerExposure;
}
export interface CoachFeedback extends CoachReply {
  id: string;
  sessionId: string;
  attemptId: string;
  requestId: string;
  basis: 'static-analysis';
  createdAt: number;
}
export type PracticeEvent =
  | {
      type: 'submit';
      requestId: string;
      attemptId: string;
      thought: string;
      code: string;
      selfReportedTests?: string;
    }
  | { type: 'hint'; requestId: string; attemptId: string }
  | { type: 'retry'; requestId: string; previousRequestId: string };
export interface PracticeOptions {
  storage?: AlgoRhythmDB;
  now?: () => number;
}
export interface CoachContext {
  session: PracticeSession;
  attempts: PracticeAttempt[];
  feedback: CoachFeedback[];
  request: PracticeRequest;
}
export type CoachTransport = (context: CoachContext, config: AIConfig) => Promise<CoachReply>;
export interface RunOptions extends PracticeOptions {
  transport?: CoachTransport;
}
export interface PracticeView {
  session: PracticeSession;
  attempts: PracticeAttempt[];
  requests: PracticeRequest[];
  feedback: CoachFeedback[];
}
export interface PracticeRunResult {
  disposition: 'completed' | 'failed' | 'duplicate' | 'stale';
  request: PracticeRequest;
  feedback?: CoachFeedback;
}
