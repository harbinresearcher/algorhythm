import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlgoRhythmDB } from '../src/db';
import { newCard } from '../src/fsrs';
import { buildBackup } from '../src/backup';
import {
  startPractice,
  loadPractice,
  recoverPractice,
  runPracticeEvent,
  finishPractice,
} from '../src/practice';
import type { CoachReply, CoachTransport, PracticeEvent } from '../src/practice-types';
import type { Problem } from '../src/types';

/*
 * ========================================================================
 * 步骤1：验证练习记录与事务边界
 * ========================================================================
 * 数据源：隔离 IndexedDB 与受控外部请求；操作：1) 验证状态 2) 保留原题数据
 */
console.info('开始练习核心测试');
// 1.1 每例创建独立数据库，外部调用只替换传输边界
const config = { apiKey: 'test-only', baseUrl: 'https://example.test', model: 'test' };
const reply = (level: 0 | 1 | 2 | 3 = 0): CoachReply => ({
  assessment: '当前思路可以继续检查边界。',
  nextQuestion: '两个相同的值如何处理？',
  hint: level ? '关注查找成本。' : '',
  hintLevel: level,
  answerExposure: 'none',
});
const problem: Problem = {
  id: 'two-sum',
  title: '两数之和',
  description: '返回两个数相加等于目标的不同下标。',
  url: '',
  difficulty: 'easy',
  primaryPatternId: 'hash-map',
  secondaryPatternIds: [],
  aiAnalysis: {
    coreInsight: '不应进入练习上下文',
    skeleton: 'SOLUTION_SECRET',
    prerequisites: [],
    warnings: [],
  },
  fsrsCard: newCard(new Date('2026-10-11T00:00:00Z')),
  createdAt: 1,
  updatedAt: 2,
};
let storage: AlgoRhythmDB;
let time: number;
let calls: number;
const options = () => ({ storage, now: () => time });
const transport: CoachTransport = async (context) => {
  calls++;
  return reply(context.request.hintLevel);
};
const runOptions = () => ({ ...options(), transport });
const submit = (
  requestId = 'r1',
  attemptId = 'a1',
): Extract<PracticeEvent, { type: 'submit' }> => ({
  type: 'submit',
  requestId,
  attemptId,
  thought: '先用双重循环',
  code: '',
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const pending = async (sessionId: string) => {
  for (let i = 0; i < 100; i++) {
    const view = await loadPractice(sessionId, options());
    if (view.requests.some((request) => request.status === 'pending')) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('request did not become pending');
};
beforeEach(async () => {
  storage = new AlgoRhythmDB(`practice-${crypto.randomUUID()}`);
  time = 100000;
  calls = 0;
  await storage.problems.add(problem);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await storage.delete();
});

describe('practice lifecycle', () => {
  it('persists multiple observations, distinct feedback links, and a deterministic user-ended summary', async () => {
    const session = await startPractice(problem.id, options());
    await runPracticeEvent(session.id, submit(), config, runOptions());
    time++;
    await runPracticeEvent(
      session.id,
      { ...submit('r2', 'a2'), code: 'return [0, 1]', selfReportedTests: '示例通过' },
      config,
      runOptions(),
    );
    const view = await loadPractice(session.id, options());
    expect(view.attempts.map((attempt) => attempt.id)).toEqual(['a1', 'a2']);
    expect(
      view.feedback.map((feedback) => [feedback.attemptId, feedback.requestId, feedback.basis]),
    ).toEqual([
      ['a1', 'r1', 'static-analysis'],
      ['a2', 'r2', 'static-analysis'],
    ]);
    expect(view.attempts[1].selfReportedTests).toEqual({ text: '示例通过', basis: 'user-report' });
    expect(view.session.hintLevel).toBe(0);
    const summary = await finishPractice(session.id, options());
    expect(summary.attemptCount).toBe(2);
    expect(summary.usedHintLevels).toEqual([]);
    expect(summary.exposureVerification).toBe('unverified');
    expect(summary.unverifiedItems).toContain('测试结果仅为用户自述');
    expect(summary).not.toHaveProperty('mastered');
    expect(await finishPractice(session.id, options())).toEqual(summary);
    expect(calls).toBe(2);
    expect(await storage.problems.get(problem.id)).toEqual(problem);
  });

  it('raises hint permission only on an explicit successful hint and resets permission in a new session', async () => {
    const session = await startPractice(problem.id, options());
    await expect(
      runPracticeEvent(
        session.id,
        { type: 'hint', requestId: 'h0', attemptId: 'a1' },
        config,
        runOptions(),
      ),
    ).rejects.toMatchObject({ code: 'STALE_ATTEMPT' });
    await runPracticeEvent(session.id, submit(), config, runOptions());
    for (const level of [1, 2, 3]) {
      const result = await runPracticeEvent(
        session.id,
        { type: 'hint', requestId: `h${level}`, attemptId: 'a1' },
        config,
        runOptions(),
      );
      expect(result.feedback?.hintLevel).toBe(level);
    }
    await expect(
      runPracticeEvent(
        session.id,
        { type: 'hint', requestId: 'h4', attemptId: 'a1' },
        config,
        runOptions(),
      ),
    ).rejects.toMatchObject({ code: 'HINT_LIMIT' });
    const next = await startPractice(problem.id, options());
    expect(next.hintLevel).toBe(0);
    expect(next.currentRequestId).toBeUndefined();
    expect((await finishPractice(session.id, options())).usedHintLevels).toEqual([1, 2, 3]);
  });

  it('rejects model-driven hint escalation and retains attempts after output validation failure', async () => {
    const session = await startPractice(problem.id, options());
    const result = await runPracticeEvent(session.id, submit(), config, {
      ...options(),
      transport: async () => reply(3),
    });
    expect(result.disposition).toBe('failed');
    expect(result.request.errorCode).toBe('INVALID_OUTPUT');
    const view = await loadPractice(session.id, options());
    expect(view.attempts).toHaveLength(1);
    expect(view.feedback).toHaveLength(0);
    expect(view.session.hintLevel).toBe(0);
  });

  it('stores the attempt before HTTP, preserves it on failure, and retries only after an explicit event', async () => {
    const session = await startPractice(problem.id, options());
    vi.stubGlobal('fetch', async () => {
      calls++;
      expect(await storage.practiceAttempts.get('a1')).toMatchObject({
        sessionId: session.id,
        thought: '先用双重循环',
      });
      throw new TypeError('secret network details');
    });
    const failed = await runPracticeEvent(session.id, submit(), config, options());
    expect(failed.request.errorCode).toBe('NETWORK');
    expect(calls).toBe(1);
    await loadPractice(session.id, options());
    expect(calls).toBe(1);
    const retried = await runPracticeEvent(
      session.id,
      { type: 'retry', requestId: 'r2', previousRequestId: 'r1' },
      config,
      runOptions(),
    );
    expect(retried.disposition).toBe('completed');
    expect(retried.request).toMatchObject({ retryOf: 'r1', attemptId: 'a1' });
    expect((await loadPractice(session.id, options())).attempts).toHaveLength(1);
    expect(calls).toBe(2);
    await expect(
      runPracticeEvent(
        session.id,
        { type: 'retry', requestId: 'r3', previousRequestId: 'r2' },
        config,
        runOptions(),
      ),
    ).rejects.toMatchObject({ code: 'RETRY_NOT_ALLOWED' });
  });

  it('does not advance a failed hint and retries with exactly the same permission', async () => {
    const session = await startPractice(problem.id, options());
    await runPracticeEvent(session.id, submit(), config, runOptions());
    await runPracticeEvent(session.id, { type: 'hint', requestId: 'h1', attemptId: 'a1' }, config, {
      ...options(),
      transport: async () => reply(2),
    });
    expect((await loadPractice(session.id, options())).session.hintLevel).toBe(0);
    const result = await runPracticeEvent(
      session.id,
      { type: 'retry', requestId: 'h2', previousRequestId: 'h1' },
      config,
      runOptions(),
    );
    expect(result.feedback?.hintLevel).toBe(1);
    await runPracticeEvent(session.id, submit('r3', 'a2'), config, runOptions());
    expect((await loadPractice(session.id, options())).session.hintLevel).toBe(1);
  });

  it('recovers active requests after reopening without assuming a still-running call failed', async () => {
    const session = await startPractice(problem.id, options());
    const wait = deferred<CoachReply>();
    const running = runPracticeEvent(session.id, submit(), config, {
      ...options(),
      transport: () => wait.promise,
    });
    await pending(session.id);
    storage.close();
    await storage.open();
    const recovered = await recoverPractice(session.id, options());
    expect(recovered.requests[0].status).toBe('pending');
    expect(recovered.attempts).toHaveLength(1);
    await expect(
      runPracticeEvent(
        session.id,
        { type: 'retry', requestId: 'r2', previousRequestId: 'r1' },
        config,
        runOptions(),
      ),
    ).rejects.toMatchObject({ code: 'RETRY_NOT_ALLOWED' });
    wait.resolve(reply());
    expect((await running).disposition).toBe('completed');
  });

  it('expires only after the deadline and fences the old response after manual retry', async () => {
    const session = await startPractice(problem.id, options());
    const wait = deferred<CoachReply>();
    const running = runPracticeEvent(session.id, submit(), config, {
      ...options(),
      transport: () => wait.promise,
    });
    await pending(session.id);
    time += 89999;
    expect((await recoverPractice(session.id, options())).requests[0].status).toBe('pending');
    time++;
    expect((await recoverPractice(session.id, options())).requests[0].status).toBe('expired');
    await runPracticeEvent(
      session.id,
      { type: 'retry', requestId: 'r2', previousRequestId: 'r1' },
      config,
      runOptions(),
    );
    wait.resolve(reply());
    expect((await running).disposition).toBe('stale');
    expect(
      (await loadPractice(session.id, options())).feedback.map((item) => item.requestId),
    ).toEqual(['r2']);
  });

  it('deduplicates a concurrent request across database connections', async () => {
    const session = await startPractice(problem.id, options());
    const other = new AlgoRhythmDB(storage.name);
    const wait = deferred<CoachReply>();
    try {
      const first = runPracticeEvent(session.id, submit(), config, {
        ...options(),
        transport: async () => {
          calls++;
          return wait.promise;
        },
      });
      await pending(session.id);
      const second = await runPracticeEvent(session.id, submit(), config, {
        ...runOptions(),
        storage: other,
      });
      expect(second.disposition).toBe('duplicate');
      expect(calls).toBe(1);
      wait.resolve(reply());
      await first;
      expect((await loadPractice(session.id, options())).attempts).toHaveLength(1);
      expect((await runPracticeEvent(session.id, submit(), config, runOptions())).disposition).toBe(
        'duplicate',
      );
      expect(calls).toBe(1);
    } finally {
      other.close();
    }
  });

  it('rejects reused IDs with changed input or association without another call', async () => {
    const session = await startPractice(problem.id, options());
    await runPracticeEvent(session.id, submit(), config, runOptions());
    await expect(
      runPracticeEvent(session.id, { ...submit(), thought: '不同输入' }, config, runOptions()),
    ).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
    await expect(
      runPracticeEvent(session.id, submit('r2'), config, runOptions()),
    ).rejects.toMatchObject({ code: 'INVALID_EVENT' });
    const other = await startPractice(problem.id, options());
    await expect(runPracticeEvent(other.id, submit(), config, runOptions())).rejects.toMatchObject({
      code: 'REQUEST_CONFLICT',
    });
    expect(calls).toBe(1);
  });

  it('supersedes old observations and blocks hints or retries for an old attempt', async () => {
    const session = await startPractice(problem.id, options());
    const wait = deferred<CoachReply>();
    const old = runPracticeEvent(session.id, submit(), config, {
      ...options(),
      transport: () => wait.promise,
    });
    await pending(session.id);
    await runPracticeEvent(session.id, submit('r2', 'a2'), config, runOptions());
    wait.resolve(reply());
    expect((await old).disposition).toBe('stale');
    const view = await loadPractice(session.id, options());
    expect(view.requests[0].status).toBe('superseded');
    expect(view.feedback.map((item) => item.attemptId)).toEqual(['a2']);
    await expect(
      runPracticeEvent(
        session.id,
        { type: 'hint', requestId: 'h1', attemptId: 'a1' },
        config,
        runOptions(),
      ),
    ).rejects.toMatchObject({ code: 'STALE_ATTEMPT' });
    await expect(
      runPracticeEvent(
        session.id,
        { type: 'retry', requestId: 'r3', previousRequestId: 'r1' },
        config,
        runOptions(),
      ),
    ).rejects.toMatchObject({ code: 'RETRY_NOT_ALLOWED' });
  });

  it('blocks duplicate hint applications while the permission decision is pending', async () => {
    const session = await startPractice(problem.id, options());
    await runPracticeEvent(session.id, submit(), config, runOptions());
    const wait = deferred<CoachReply>();
    const first = runPracticeEvent(
      session.id,
      { type: 'hint', requestId: 'h1', attemptId: 'a1' },
      config,
      { ...options(), transport: () => wait.promise },
    );
    await pending(session.id);
    await expect(
      runPracticeEvent(
        session.id,
        { type: 'hint', requestId: 'h2', attemptId: 'a1' },
        config,
        runOptions(),
      ),
    ).rejects.toMatchObject({ code: 'BUSY' });
    wait.resolve(reply(1));
    await first;
  });

  it('does not write late responses or late failures after the user ends practice', async () => {
    for (const fail of [false, true]) {
      const session = await startPractice(problem.id, options());
      const wait = deferred<CoachReply>();
      const running = runPracticeEvent(session.id, submit(`r-${fail}`, `a-${fail}`), config, {
        ...options(),
        transport: () => wait.promise,
      });
      await pending(session.id);
      const summary = await finishPractice(session.id, options());
      if (fail) wait.reject(new TypeError('late'));
      else wait.resolve(reply());
      expect((await running).disposition).toBe('stale');
      const view = await loadPractice(session.id, options());
      expect(view.feedback).toHaveLength(0);
      expect(view.requests[0].status).toBe('cancelled');
      expect(view.session.summary).toEqual(summary);
      await expect(
        runPracticeEvent(session.id, submit('new', 'new'), config, runOptions()),
      ).rejects.toMatchObject({ code: 'SESSION_ENDED' });
    }
  });

  it('keeps the snapshot after source deletion and leaves backup restricted to problems', async () => {
    const session = await startPractice(problem.id, options());
    await storage.problems.delete(problem.id);
    const result = await runPracticeEvent(session.id, submit(), config, runOptions());
    expect(result.disposition).toBe('completed');
    expect((await loadPractice(session.id, options())).session.problemSnapshot).toEqual({
      title: problem.title,
      description: problem.description,
      url: '',
    });
    expect(buildBackup([])).toEqual(
      expect.objectContaining({ schemaVersion: 1, count: 0, problems: [] }),
    );
    expect(buildBackup([])).not.toHaveProperty('practiceSessions');
  });

  it('does not call the model when storing the attempt fails, and rolls back the reservation', async () => {
    const session = await startPractice(problem.id, options());
    const hook = () => {
      throw new Error('storage failure');
    };
    storage.practiceAttempts.hook('creating', hook);
    try {
      await expect(runPracticeEvent(session.id, submit(), config, runOptions())).rejects.toThrow(
        'storage failure',
      );
    } finally {
      storage.practiceAttempts.hook('creating').unsubscribe(hook);
    }
    const view = await loadPractice(session.id, options());
    expect(view.attempts).toHaveLength(0);
    expect(view.requests).toHaveLength(0);
    expect(calls).toBe(0);
  });

  it('rejects empty, oversized and unknown events before persisting or calling', async () => {
    const session = await startPractice(problem.id, options());
    for (const event of [
      { ...submit(), thought: '' },
      { ...submit(), code: 'x'.repeat(12001) },
      { type: 'unknown', requestId: 'r1' },
      { ...submit(), requestId: '' },
    ]) {
      await expect(
        runPracticeEvent(session.id, event as PracticeEvent, config, runOptions()),
      ).rejects.toMatchObject({ code: 'INVALID_EVENT' });
    }
    expect((await loadPractice(session.id, options())).attempts).toHaveLength(0);
    expect(calls).toBe(0);
  });

  it('keeps expiry protection even if recovery was never called', async () => {
    const session = await startPractice(problem.id, options());
    const wait = deferred<CoachReply>();
    const running = runPracticeEvent(session.id, submit(), config, {
      ...options(),
      transport: () => wait.promise,
    });
    await pending(session.id);
    time += 90000;
    wait.resolve(reply());
    const result = await running;
    expect(result.disposition).toBe('stale');
    expect(result.request.status).toBe('expired');
    expect((await loadPractice(session.id, options())).feedback).toHaveLength(0);
  });

  it('checks expiry after waiting for another tab write transaction, not before queuing', async () => {
    const session = await startPractice(problem.id, options());
    const response = deferred<CoachReply>();
    const running = runPracticeEvent(session.id, submit(), config, {
      ...options(),
      transport: () => response.promise,
    });
    await pending(session.id);
    const locked = deferred<void>();
    const unlock = deferred<void>();
    const other = new AlgoRhythmDB(storage.name);
    const blocker = other.transaction('rw', other.practiceSessions, async () => {
      locked.resolve();
      await Dexie.waitFor(unlock.promise);
    });
    await locked.promise;
    Dexie.ignoreTransaction(() => response.resolve(reply()));
    await new Promise((resolve) => setTimeout(resolve, 10));
    time += 90000;
    unlock.resolve();
    await blocker;
    other.close();
    expect((await running).disposition).toBe('stale');
    expect((await loadPractice(session.id, options())).feedback).toHaveLength(0);
  });

  it('reports missing records without creating a phantom practice', async () => {
    await expect(startPractice('missing', options())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(loadPractice('missing', options())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('upgrades a real v1 database without changing any original problem or FSRS date', async () => {
    const name = `upgrade-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores({ problems: 'id, primaryPatternId, createdAt, fsrsCard.due' });
    await old.table('problems').add(problem);
    old.close();
    const upgraded = new AlgoRhythmDB(name);
    try {
      await upgraded.open();
      expect(await upgraded.problems.get(problem.id)).toEqual(problem);
      expect(
        await upgraded.problems
          .where('fsrsCard.due')
          .belowOrEqual(new Date('2026-10-11T00:00:00Z'))
          .count(),
      ).toBe(1);
      const session = await startPractice(problem.id, { storage: upgraded });
      expect((await loadPractice(session.id, { storage: upgraded })).attempts).toEqual([]);
      expect(await upgraded.problems.get(problem.id)).toEqual(problem);
    } finally {
      await upgraded.delete();
    }
  });
});
console.info('练习核心测试注册完成');
