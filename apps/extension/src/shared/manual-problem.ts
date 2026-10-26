import { z } from 'zod';

export class ManualProblemError extends Error {
  constructor(readonly code: 'INVALID_TITLE' | 'INVALID_URL') { super(code); }
}
const logger = console;

function normalizeUrl(input: string): string | null {
  if (typeof input !== 'string') throw new ManualProblemError('INVALID_URL');
  const value = input.trim();
  if (!value) return null;
  // 1.1 先查原始 authority 和路径，防止 URL 解析掩盖编码点段、控制字符和反斜线。
  if (/[\\\u0000-\u0020\u007f]/.test(value)) throw new ManualProblemError('INVALID_URL');
  const parts = /^https:\/\/([^/?#]+)(\/[^?#]*)(?:[?#].*)?$/i.exec(value);
  if (!parts || !/^leetcode\.cn(?::443)?$/i.test(parts[1])) throw new ManualProblemError('INVALID_URL');
  const path = /^\/problems\/([a-z0-9-]{1,200})(?:\/(?:description|submissions|solutions))?\/?$/.exec(parts[2]);
  if (!path) throw new ManualProblemError('INVALID_URL');
  try {
    // 1.2 仅解析本地字符串；query/hash 丢弃，不发送请求。
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'leetcode.cn' || parsed.port || parsed.username || parsed.password) throw new ManualProblemError('INVALID_URL');
    return `https://leetcode.cn/problems/${path[1]}/`;
  } catch { throw new ManualProblemError('INVALID_URL'); }
}

export const manualProblemSchema = z.strictObject({
  title: z.string().refine((value) => value.length >= 1 && value.length <= 200 && value === value.trim()),
  url: z.string().refine((value) => { try { return normalizeUrl(value) === value; } catch { return false; } }).nullable(),
});

export function normalizeManualProblem(input: { title: string; url: string }): { title: string; url: string | null } {
  /*
   * ========================================================================
   * 步骤1：规范化用户填写的标题与原题链接
   * ========================================================================
   * 数据源：表单原字符串，与在线命令复用的严格字段 schema。
   * 操作：1) 去标题首尾空白并校验长度。2) 只将允许的链接归根，不访问网站。
   */
  logger.info('开始规范手动题目');
  try {
    // 1.3 在线 schema 只接受此规范结果，不静默改变后台命令指纹。
    if (typeof input.title !== 'string') throw new ManualProblemError('INVALID_TITLE');
    const title = input.title.trim();
    if (!manualProblemSchema.shape.title.safeParse(title).success) throw new ManualProblemError('INVALID_TITLE');
    return { title, url: normalizeUrl(input.url) };
  } finally { logger.info('手动题目规范结束'); }
}
