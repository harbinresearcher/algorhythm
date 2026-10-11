import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCoachReply, requestCoach } from '../src/coach';
import type { CoachContext, CoachReply } from '../src/practice-types';

/*
 * ========================================================================
 * 步骤1：验证教练外部接口
 * ========================================================================
 * 数据源：受控 HTTP 响应；操作：1) 检查真实请求 2) 检查权限与错误恢复
 */
console.info('开始教练接口测试');
// 1.1 测试不访问真实模型；只有 HTTP 边界使用替身
const config = { apiKey: 'test-key', baseUrl: 'https://example.test/v1/', model: 'test-model' };
const value: CoachReply = {
  assessment: '双重循环思路可以继续验证。',
  nextQuestion: '重复值如何处理？',
  hint: '',
  hintLevel: 0,
  answerExposure: 'none',
};
const context: CoachContext = {
  session: {
    id: 's',
    problemId: 'p',
    problemSnapshot: { title: '两数之和', description: '题干', url: '' },
    status: 'active',
    hintLevel: 0,
    createdAt: 1,
    updatedAt: 1,
    latestAttemptId: 'a',
    currentRequestId: 'r',
  },
  attempts: [
    {
      id: 'a',
      sessionId: 's',
      thought: '双重循环',
      code: '',
      selfReportedTests: { text: '通过示例', basis: 'user-report' },
      createdAt: 1,
    },
  ],
  feedback: [],
  request: {
    id: 'r',
    sessionId: 's',
    attemptId: 'a',
    action: 'submit',
    hintLevel: 0,
    status: 'pending',
    createdAt: 1,
    expiresAt: 90001,
  },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('coach transport and output boundary', () => {
  it('sends saved user observations as untrusted data without solution fields and parses the actual response', async () => {
    const dirty = {
      ...context,
      session: { ...context.session, aiAnalysis: { skeleton: 'DO_NOT_SEND' } },
    };
    let observed = false;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toBe('https://example.test/v1/chat/completions');
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe('test-model');
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');
      const data = JSON.parse(body.messages[1].content);
      expect(data.attempts[0]).toMatchObject({
        thought: '双重循环',
        selfReportedTests: { text: '通过示例', basis: 'user-report' },
      });
      expect(body.messages[1].content).not.toContain('DO_NOT_SEND');
      expect(body.messages[1].content).not.toContain('test-key');
      expect(data.allowedHintLevel).toBe(0);
      observed = true;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }),
      );
    });
    expect(await requestCoach(dirty, config)).toEqual(value);
    expect(observed).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    { ...value, hintLevel: 1 },
    { ...value, hint: '新提示' },
    { ...value, assessment: '' },
    { ...value, mastered: true },
    { ...value, verified: true },
    { ...value, answerExposure: 'verified' },
    { ...value, answerExposure: ['none'] },
    { ...value, nextQuestion: 'x'.repeat(4001) },
  ])('rejects invalid or unauthorized model output %#', (output) => {
    expect(() => parseCoachReply(output, 0)).toThrow(
      expect.objectContaining({ code: 'INVALID_OUTPUT' }),
    );
  });

  it('requires actual hint content at exactly the authorized level', () => {
    expect(() => parseCoachReply({ ...value, hintLevel: 1 }, 1)).toThrow(
      expect.objectContaining({ code: 'INVALID_OUTPUT' }),
    );
    expect(
      parseCoachReply(
        { ...value, hintLevel: 1, hint: '关注查找的成本', answerExposure: 'possible' },
        1,
      ),
    ).toMatchObject({ hintLevel: 1, hint: '关注查找的成本' });
  });

  it.each([
    { status: 401, text: 'secret-provider-content', code: 'HTTP' },
    { status: 200, text: 'not json', code: 'INVALID_OUTPUT' },
    { status: 200, text: JSON.stringify({ choices: [] }), code: 'INVALID_OUTPUT' },
    {
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: '{broken' } }] }),
      code: 'INVALID_OUTPUT',
    },
  ])(
    'fails once and does not expose provider content: $code / $status',
    async ({ status, text, code }) => {
      let count = 0;
      vi.stubGlobal('fetch', async () => {
        count++;
        return new Response(text, { status });
      });
      await expect(requestCoach(context, config)).rejects.toMatchObject({ code });
      expect(count).toBe(1);
    },
  );

  it('rejects invalid configuration before making a request', async () => {
    let count = 0;
    vi.stubGlobal('fetch', async () => {
      count++;
      return new Response();
    });
    await expect(requestCoach(context, { ...config, apiKey: '' })).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
    });
    expect(count).toBe(0);
  });

  it('aborts at 60 seconds and never retries', async () => {
    vi.useFakeTimers();
    let count = 0;
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      count++;
      return new Promise((_resolve, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        ),
      );
    });
    const result = requestCoach(context, config).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(60000);
    expect(await result).toMatchObject({ code: 'TIMEOUT' });
    expect(count).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('limits transmitted history while preserving the latest user observation', async () => {
    const large: CoachContext = {
      ...context,
      request: { ...context.request, attemptId: 'a14' },
      attempts: Array.from({ length: 15 }, (_, index) => ({
        ...context.attempts[0],
        id: `a${index}`,
        thought: `${index}-` + 'x'.repeat(13000),
      })),
    };
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const data = JSON.parse(JSON.parse(String(init.body)).messages[1].content);
      expect(data.attempts).toHaveLength(10);
      expect(data.attempts.at(-1).thought.startsWith('14-')).toBe(true);
      expect(data.attempts.at(-1).thought).toHaveLength(12000);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }),
      );
    });
    await requestCoach(large, config);
    expect(large.attempts.at(-1)?.thought).toHaveLength(13003);
  });

  it('always includes and identifies the bound attempt even when clock or ID ordering puts it first', async () => {
    const reordered: CoachContext = {
      ...context,
      attempts: [
        context.attempts[0],
        ...Array.from({ length: 15 }, (_, index) => ({
          ...context.attempts[0],
          id: `old${index}`,
          thought: '旧观察',
        })),
      ],
      feedback: [
        {
          ...value,
          id: 'f',
          sessionId: 's',
          attemptId: 'old0',
          requestId: 'old-r',
          basis: 'static-analysis',
          createdAt: 1,
        },
      ],
    };
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const data = JSON.parse(JSON.parse(String(init.body)).messages[1].content);
      expect(data.currentAttemptId).toBe('a');
      expect(data.attempts).toHaveLength(10);
      expect(data.attempts.at(-1)).toMatchObject({ id: 'a', thought: '双重循环' });
      expect(data.feedback[0].attemptId).toBe('old0');
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }),
      );
    });
    await requestCoach(reordered, config);
  });
});
console.info('教练接口测试注册完成');
