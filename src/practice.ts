import { db, type AlgoRhythmDB } from './db';
import { parseCoachReply, requestCoach } from './coach';
import { logger } from './logger';
import {
  PracticeError,
  type PracticeOptions,
  type RunOptions,
  type PracticeSession,
  type PracticeAttempt,
  type PracticeRequest,
  type PracticeView,
  type PracticeEvent,
  type PracticeRunResult,
  type PracticeSummary,
  type CoachContext,
  type CoachReply,
  type CoachFeedback,
  type CallErrorCode,
} from './practice-types';
import type { AIConfig } from './types';

const tables = (storage: AlgoRhythmDB) => [
  storage.practiceSessions,
  storage.practiceAttempts,
  storage.practiceRequests,
  storage.practiceFeedback,
];
const ordered = <T extends { createdAt: number; id: string }>(items: T[]) =>
  items.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
const validId = (id: unknown): id is string =>
  typeof id === 'string' && !!id.trim() && id.length <= 128;
const validText = (text: unknown): text is string =>
  typeof text === 'string' && text.length <= 12000;

async function readView(sessionId: string, storage: AlgoRhythmDB): Promise<PracticeView> {
  /*
   * ========================================================================
   * 步骤1：读取一致练习记录
   * ========================================================================
   * 数据源：四张练习表；操作：1) 校验会话 2) 读取关联记录
   */
  logger.info('开始读取练习记录');
  // 1.1 调用方在同一事务中读取，防止状态和记录分离
  const session = await storage.practiceSessions.get(sessionId);
  if (!session) throw new PracticeError('NOT_FOUND');
  const [attempts, requests, feedback] = await Promise.all([
    storage.practiceAttempts.where('sessionId').equals(sessionId).toArray(),
    storage.practiceRequests.where('sessionId').equals(sessionId).toArray(),
    storage.practiceFeedback.where('sessionId').equals(sessionId).toArray(),
  ]);
  logger.info('练习记录读取完成');
  return {
    session,
    attempts: ordered(attempts),
    requests: ordered(requests),
    feedback: ordered(feedback),
  };
}

export async function startPractice(
  problemId: string,
  options: PracticeOptions = {},
): Promise<PracticeSession> {
  /*
   * ========================================================================
   * 步骤1：建立独立练习会话
   * ========================================================================
   * 数据源：本地原题；操作：1) 仅保存题干快照 2) 初始化独立权限
   */
  logger.info('开始建立练习会话');
  const storage = options.storage ?? db;
  // 1.1 同事务读取原题与保存快照，不复制分析、卡片或旧权限
  const session = await storage.transaction(
    'rw',
    storage.problems,
    storage.practiceSessions,
    async () => {
      const problem = await storage.problems.get(problemId);
      if (!problem) throw new PracticeError('NOT_FOUND');
      const now = (options.now ?? Date.now)();
      const session: PracticeSession = {
        id: crypto.randomUUID(),
        problemId,
        problemSnapshot: {
          title: problem.title,
          description: problem.description,
          url: problem.url,
        },
        status: 'active',
        hintLevel: 0,
        createdAt: now,
        updatedAt: now,
      };
      await storage.practiceSessions.add(session);
      return session;
    },
  );
  logger.info('练习会话建立完成');
  return session;
}

export async function loadPractice(
  sessionId: string,
  options: PracticeOptions = {},
): Promise<PracticeView> {
  /*
   * ========================================================================
   * 步骤1：恢复可展示的会话快照
   * ========================================================================
   * 数据源：持久化练习；操作：1) 一致读取 2) 不发请求、不改进行中状态
   */
  logger.info('开始加载练习');
  const storage = options.storage ?? db;
  // 1.1 刷新只读取记录，不能重复付费调用
  const view = await storage.transaction('r', tables(storage), () => readView(sessionId, storage));
  logger.info('练习加载完成');
  return view;
}

export async function recoverPractice(
  sessionId: string,
  options: PracticeOptions = {},
): Promise<PracticeView> {
  /*
   * ========================================================================
   * 步骤1：恢复中断调用状态
   * ========================================================================
   * 数据源：保存的有效期；操作：1) 只过期已到期请求 2) 不宣称服务端失败
   */
  logger.info('开始恢复练习状态');
  const storage = options.storage ?? db;
  // 1.1 活跃有效请求原样保留，手动重试由用户决定
  const view = await storage.transaction('rw', tables(storage), async () => {
    const view = await readView(sessionId, storage);
    const now = (options.now ?? Date.now)();
    for (const request of view.requests) {
      if (request.status === 'pending' && now >= request.expiresAt) {
        request.status = 'expired';
        await storage.practiceRequests.put(request);
      }
    }
    return view;
  });
  logger.info('练习状态恢复完成');
  return view;
}

function validateEvent(event: PracticeEvent): void {
  /*
   * ========================================================================
   * 步骤1：校验用户动作
   * ========================================================================
   * 数据源：前端事件；操作：1) 校验关联 ID 2) 拒绝空尝试和超长文本
   */
  logger.info('开始校验练习动作');
  // 1.1 保留原始输入供记录，校验不改变内容
  if (!event || !validId(event.requestId)) throw new PracticeError('INVALID_EVENT');
  if (event.type === 'submit') {
    if (
      !validId(event.attemptId) ||
      !validText(event.thought) ||
      !validText(event.code) ||
      (!event.thought.trim() && !event.code.trim()) ||
      (event.selfReportedTests !== undefined && !validText(event.selfReportedTests))
    )
      throw new PracticeError('INVALID_EVENT');
  } else if (event.type === 'hint') {
    if (!validId(event.attemptId)) throw new PracticeError('INVALID_EVENT');
  } else if (event.type === 'retry') {
    if (!validId(event.previousRequestId) || event.previousRequestId === event.requestId)
      throw new PracticeError('INVALID_EVENT');
  } else throw new PracticeError('INVALID_EVENT');
  logger.info('练习动作校验完成');
}

async function reserve(
  sessionId: string,
  event: PracticeEvent,
  storage: AlgoRhythmDB,
  clock: () => number,
): Promise<{ duplicate: boolean; context: CoachContext }> {
  /*
   * ========================================================================
   * 步骤1：原子保存尝试并预留调用
   * ========================================================================
   * 目标表：练习记录；操作：1) 持久化去重 2) 校验权限与关联后预留一次请求
   */
  logger.info('开始预留教练调用');
  // 1.1 ID 去重在跨标签共享事务内，不依赖按钮禁用
  const result = await storage.transaction('rw', tables(storage), async () => {
    const view = await readView(sessionId, storage);
    const now = clock();
    const session = view.session;
    const existing = await storage.practiceRequests.get(event.requestId);
    if (existing) {
      const attempt = await storage.practiceAttempts.get(existing.attemptId);
      const same =
        existing.sessionId === sessionId &&
        (event.type === 'retry'
          ? existing.retryOf === event.previousRequestId
          : !existing.retryOf &&
            existing.action === event.type &&
            existing.attemptId === event.attemptId &&
            (event.type !== 'submit' ||
              (!!attempt &&
                attempt.thought === event.thought &&
                attempt.code === event.code &&
                attempt.selfReportedTests?.text === event.selfReportedTests)));
      if (!same) throw new PracticeError('REQUEST_CONFLICT');
      return {
        duplicate: true,
        context: { session, attempts: view.attempts, feedback: view.feedback, request: existing },
      };
    }
    if (session.status !== 'active') throw new PracticeError('SESSION_ENDED');
    const current = session.currentRequestId
      ? await storage.practiceRequests.get(session.currentRequestId)
      : undefined;
    if (current?.status === 'pending' && now >= current.expiresAt) {
      current.status = 'expired';
      await storage.practiceRequests.put(current);
    }
    let request: PracticeRequest;
    // 1.2 先保存新观察，再准备请求；任何存储失败使整笔事务回滚
    if (event.type === 'submit') {
      if (await storage.practiceAttempts.get(event.attemptId))
        throw new PracticeError('INVALID_EVENT');
      const attempt: PracticeAttempt = {
        id: event.attemptId,
        sessionId,
        thought: event.thought,
        code: event.code,
        createdAt: now,
        ...(event.selfReportedTests === undefined
          ? {}
          : {
              selfReportedTests: { text: event.selfReportedTests, basis: 'user-report' as const },
            }),
      };
      await storage.practiceAttempts.add(attempt);
      view.attempts.push(attempt);
      session.latestAttemptId = attempt.id;
      if (current?.status === 'pending') {
        current.status = 'superseded';
        await storage.practiceRequests.put(current);
      }
      request = {
        id: event.requestId,
        sessionId,
        attemptId: attempt.id,
        action: 'submit',
        hintLevel: 0,
        status: 'pending',
        createdAt: now,
        expiresAt: now + 90000,
      };
    } else if (event.type === 'hint') {
      if (!session.latestAttemptId || session.latestAttemptId !== event.attemptId)
        throw new PracticeError('STALE_ATTEMPT');
      if (current?.status === 'pending') throw new PracticeError('BUSY');
      if (session.hintLevel >= 3) throw new PracticeError('HINT_LIMIT');
      request = {
        id: event.requestId,
        sessionId,
        attemptId: event.attemptId,
        action: 'hint',
        hintLevel: session.hintLevel === 0 ? 1 : session.hintLevel === 1 ? 2 : 3,
        status: 'pending',
        createdAt: now,
        expiresAt: now + 90000,
      };
    } else {
      if (
        !current ||
        current.id !== event.previousRequestId ||
        !['failed', 'expired'].includes(current.status) ||
        current.attemptId !== session.latestAttemptId
      )
        throw new PracticeError('RETRY_NOT_ALLOWED');
      request = {
        id: event.requestId,
        sessionId,
        attemptId: current.attemptId,
        action: current.action,
        hintLevel: current.hintLevel,
        status: 'pending',
        createdAt: now,
        expiresAt: now + 90000,
        retryOf: current.id,
      };
    }
    // 1.3 请求必须绑定最新观察，提示权限等有效反馈写入后才提升
    await storage.practiceRequests.add(request);
    session.currentRequestId = request.id;
    session.updatedAt = now;
    await storage.practiceSessions.put(session);
    return {
      duplicate: false,
      context: { session, attempts: ordered(view.attempts), feedback: view.feedback, request },
    };
  });
  logger.info('教练调用预留完成');
  return result;
}

async function complete(
  context: CoachContext,
  reply: CoachReply | undefined,
  errorCode: CallErrorCode | undefined,
  storage: AlgoRhythmDB,
  clock: () => number,
): Promise<PracticeRunResult> {
  /*
   * ========================================================================
   * 步骤1：校验调用有效性后保存反馈
   * ========================================================================
   * 目标表：练习会话与反馈；操作：1) 拒绝过期或迟到结果 2) 原子写入实际提示
   */
  logger.info('开始保存教练调用结果');
  // 1.1 网络调用结束后重新读取，不能依赖发起前的会话快照
  const result = await storage.transaction(
    'rw',
    tables(storage),
    async (): Promise<PracticeRunResult> => {
      const session = await storage.practiceSessions.get(context.session.id);
      const request = await storage.practiceRequests.get(context.request.id);
      const now = clock();
      if (!session || !request) throw new PracticeError('NOT_FOUND');
      if (request.status === 'pending' && now >= request.expiresAt) {
        request.status = 'expired';
        await storage.practiceRequests.put(request);
      }
      if (
        session.status !== 'active' ||
        session.currentRequestId !== request.id ||
        session.latestAttemptId !== request.attemptId ||
        request.status !== 'pending'
      )
        return { disposition: 'stale', request };
      if (errorCode) {
        request.status = 'failed';
        request.errorCode = errorCode;
        await storage.practiceRequests.put(request);
        return { disposition: 'failed', request };
      }
      if (!reply) throw new PracticeError('INVALID_OUTPUT');
      // 1.2 只有仍有效的反馈可写入；用户观察和原题卡片保持原样
      const feedback: CoachFeedback = {
        ...reply,
        id: crypto.randomUUID(),
        sessionId: session.id,
        attemptId: request.attemptId,
        requestId: request.id,
        basis: 'static-analysis',
        createdAt: now,
      };
      await storage.practiceFeedback.add(feedback);
      request.status = 'succeeded';
      await storage.practiceRequests.put(request);
      if (request.action === 'hint') session.hintLevel = request.hintLevel;
      session.updatedAt = now;
      await storage.practiceSessions.put(session);
      return { disposition: 'completed', request, feedback };
    },
  );
  logger.info('教练调用结果保存完成');
  return result;
}

export async function runPracticeEvent(
  sessionId: string,
  event: PracticeEvent,
  config: AIConfig,
  options: RunOptions = {},
): Promise<PracticeRunResult> {
  /*
   * ========================================================================
   * 步骤1：处理一次用户练习动作
   * ========================================================================
   * 数据源：用户事件；操作：1) 先落库 2) 单次调用 3) 事务校验迟到结果
   */
  logger.info('开始处理练习动作');
  // 1.1 重复动作返回保存状态，不重新调用模型
  validateEvent(event);
  const storage = options.storage ?? db;
  const now = options.now ?? Date.now;
  const reserved = await reserve(sessionId, event, storage, now);
  if (reserved.duplicate) {
    logger.info('重复练习动作已忽略');
    return { disposition: 'duplicate', request: reserved.context.request };
  }
  let reply: CoachReply | undefined;
  let errorCode: CallErrorCode | undefined;
  // 1.2 事务外请求，调用失败不丢尝试，存储异常不得被转换成网络错误
  try {
    reply = parseCoachReply(
      await (options.transport ?? requestCoach)(reserved.context, config),
      reserved.context.request.hintLevel,
    );
  } catch (error) {
    const callCodes: CallErrorCode[] = [
      'INVALID_CONFIG',
      'NETWORK',
      'TIMEOUT',
      'HTTP',
      'INVALID_OUTPUT',
    ];
    errorCode =
      error instanceof PracticeError && callCodes.includes(error.code as CallErrorCode)
        ? (error.code as CallErrorCode)
        : 'NETWORK';
  }
  const result = await complete(reserved.context, reply, errorCode, storage, now);
  logger.info('练习动作处理完成');
  return result;
}

export async function finishPractice(
  sessionId: string,
  options: PracticeOptions = {},
): Promise<PracticeSummary> {
  /*
   * ========================================================================
   * 步骤1：按用户决定结束并复盘
   * ========================================================================
   * 数据源：已保存尝试与反馈；操作：1) 幂等结束 2) 无模型调用生成证据摘要
   */
  logger.info('开始结束练习');
  const storage = options.storage ?? db;
  // 1.1 摘要不生成掌握判断，模型暴露自评始终未经验证
  const summary = await storage.transaction('rw', tables(storage), async () => {
    const view = await readView(sessionId, storage);
    if (view.session.summary) return view.session.summary;
    const now = (options.now ?? Date.now)();
    const summary: PracticeSummary = {
      attemptCount: view.attempts.length,
      usedHintLevels: [
        ...new Set(
          view.feedback
            .filter((feedback) => !!feedback.hint && feedback.hintLevel > 0)
            .map((feedback) => feedback.hintLevel),
        ),
      ].sort(),
      answerExposure: view.feedback.some((feedback) => feedback.answerExposure === 'explicit')
        ? 'explicit'
        : view.feedback.some((feedback) => feedback.answerExposure === 'possible')
          ? 'possible'
          : 'none',
      exposureVerification: 'unverified',
      unverifiedItems: [
        '代码未由系统运行验证',
        '教学质量与答案暴露未经人工验证',
        ...(view.attempts.some((attempt) => !!attempt.selfReportedTests)
          ? ['测试结果仅为用户自述']
          : []),
      ],
      endedAt: now,
    };
    // 1.2 同一事务取消所有未完成调用，迟到响应不能修改摘要或提示权限
    for (const request of view.requests) {
      if (request.status === 'pending') {
        request.status = 'cancelled';
        await storage.practiceRequests.put(request);
      }
    }
    await storage.practiceSessions.put({
      ...view.session,
      status: 'ended',
      updatedAt: now,
      summary,
    });
    return summary;
  });
  logger.info('练习结束与复盘完成');
  return summary;
}
