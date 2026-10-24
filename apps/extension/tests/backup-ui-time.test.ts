import { describe, expect, it } from 'vitest';
import { formatTime, timeDateTime } from '../src/ui/time';

describe('备份合法时间的界面显示', () => {
  it('超出Date范围的合法安全整数仍显示原epoch毫秒', () => {
    expect(formatTime(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991（UTC毫秒）');
  });

  it('无法用Date表示的时间不写入time.dateTime', () => {
    expect(timeDateTime(Number.MAX_SAFE_INTEGER)).toBeUndefined();
  });

  it('有效日期继续提供ISO语义时间', () => {
    expect(timeDateTime(0)).toBe('1970-01-01T00:00:00.000Z');
    expect(timeDateTime(8_640_000_000_000_000)).toBe('+275760-09-13T00:00:00.000Z');
  });
});
