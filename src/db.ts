import Dexie, { type Table } from 'dexie';
import type { Problem } from './types';
import { review, type Grade } from './fsrs';
import { logger } from './logger';
import type {
  PracticeSession,
  PracticeAttempt,
  PracticeRequest,
  CoachFeedback,
} from './practice-types';

export class AlgoRhythmDB extends Dexie {
  problems!: Table<Problem, string>;
  practiceSessions!: Table<PracticeSession, string>;
  practiceAttempts!: Table<PracticeAttempt, string>;
  practiceRequests!: Table<PracticeRequest, string>;
  practiceFeedback!: Table<CoachFeedback, string>;
  constructor(name = 'algorhythm') {
    super(name);
    this.version(1).stores({ problems: 'id, primaryPatternId, createdAt, fsrsCard.due' });
    /*
     * ========================================================================
     * 步骤1：声明练习存储升级
     * ========================================================================
     * 目标表：四张练习表；操作：1) 保留原题索引 2) 只新增表，不改旧数据
     */
    logger.info('开始声明练习存储');
    // 1.1 Dexie 自动增加空表，保留 v1 题库与 Date/FSRS 原值
    this.version(2).stores({
      problems: 'id, primaryPatternId, createdAt, fsrsCard.due',
      practiceSessions: 'id, problemId, status, updatedAt',
      practiceAttempts: 'id, sessionId',
      practiceRequests: 'id, sessionId',
      practiceFeedback: 'id, sessionId, &requestId',
    });
    logger.info('练习存储声明完成');
  }
}
export const db = new AlgoRhythmDB();
export const getAllProblems = () => db.problems.orderBy('createdAt').reverse().toArray();
export const getDueProblems = (now = new Date()) =>
  db.problems.where('fsrsCard.due').belowOrEqual(now).toArray();

export async function saveProblem(problem: Problem): Promise<void> {
  /*
   * ========================================================================
   * 步骤1：保存导入题目
   * ========================================================================
   * 目标表：problems；操作：1) 新增而非覆盖 2) 等待持久化完成
   */
  logger.info('开始保存题目');
  // 1.1 只有 add 成功才向 UI 报告成功
  await db.problems.add(problem);
  logger.info('题目保存完成');
}

export async function deleteProblem(id: string): Promise<void> {
  /*
   * ========================================================================
   * 步骤1：删除用户确认的题目
   * ========================================================================
   * 目标表：problems；操作：1) 按 ID 删除 2) 触发响应式列表更新
   */
  logger.info('开始删除题目');
  // 1.1 删除题目与其内嵌复习卡片
  await db.problems.delete(id);
  logger.info('题目删除完成');
}

export async function saveReview(
  snapshot: Problem,
  rating: Grade,
  now = new Date(),
  storage = db,
): Promise<void> {
  /*
   * ========================================================================
   * 步骤1：原子保存评分
   * ========================================================================
   * 目标表：problems；操作：1) 核对快照 2) 同一事务更新卡片
   */
  logger.info('开始保存复习评分');
  // 1.1 跨 Tab 和重复点击都不能使用过期快照评分
  await storage.transaction('rw', storage.problems, async () => {
    const current = await storage.problems.get(snapshot.id);
    if (
      !current ||
      current.updatedAt !== snapshot.updatedAt ||
      current.fsrsCard.reps !== snapshot.fsrsCard.reps
    ) {
      throw new Error('这道题已在其他页面更新或删除，请重新加载队列。');
    }
    // 1.2 根据当前持久化卡片排期，日期始终为 Date
    await storage.problems.put({
      ...current,
      fsrsCard: review(current.fsrsCard, rating, now),
      updatedAt: now.getTime(),
    });
  });
  logger.info('复习评分保存完成');
}
