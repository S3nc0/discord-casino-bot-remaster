/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures are untyped JSON */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBulk } from './bulk.ts';
import { parseDuration, formatMinutes } from './duration.ts';
import { accuracyFactor, authorPayout, rewardScale, validateChoices } from './pay.ts';

const fx = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/legacy/quiz/rewards.json', import.meta.url),
    'utf8',
  ),
);

describe('quiz (legacy parity)', () => {
  it.each(fx.reward_cases as any[])(
    'author payout for $participants answered, $correct right at $reward',
    (c) => {
      expect(accuracyFactor(c.participants, c.correct)).toBeCloseTo(c.factor, 9);
      expect(rewardScale(c.reward)).toBeCloseTo(c.scale, 9);
      const p = authorPayout(c.participants, c.correct, c.reward);
      expect([p.base, p.bonus, p.participation]).toEqual(c.author_payout);
    },
  );

  it('bulk import reports every missing part and still returns the draft', () => {
    const { questions, errors } = parseBulk('これは見出しなし\nもう一行');
    expect(errors).toEqual(fx.bulk_import_sample[1]);
    expect(questions).toEqual(fx.bulk_import_sample[0]);
  });

  it('bulk import accepts a full block, skips comments and splits on ---', () => {
    const text = [
      '# comment',
      '問題: 日本の首都は？',
      '正解: 東京',
      '不正解: 大阪',
      '不正解: 京都',
      '不正解: 名古屋',
      '解説: 1869年から。',
      '報酬: 300',
      '期限: 2日',
      '---',
      '問題: 1+1は？',
      '正解: 2',
      '不正解: 3',
      '不正解: 4',
      '不正解: 5',
    ].join('\n');
    const { questions, errors } = parseBulk(text);
    expect(errors).toEqual([]);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({
      choices: ['東京', '大阪', '京都', '名古屋'],
      reward: 300,
      minutes: 2880,
      explanation: '1869年から。',
    });
    expect(questions[1]).toMatchObject({ reward: 100, minutes: null });
    expect(
      parseBulk(`${text}\n---\n問題: 1+1は？\n正解: 2\n不正解: 3\n不正解: 4\n不正解: 5`).errors
        .length,
    ).toBeGreaterThan(0);
  });

  it('durations', () => {
    expect(parseDuration('3日')).toBe(4320);
    expect(parseDuration('2時間30分')).toBe(150);
    expect(parseDuration('90m')).toBe(90);
    expect(parseDuration('５')).toBe(300);
    expect(parseDuration('1日1日')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(formatMinutes(1500)).toBe('1日1時間');
  });

  it('choices', () => {
    expect(validateChoices(['a', 'b', 'c', 'd'])).toBeNull();
    expect(validateChoices(['a', 'a', 'c', 'd'])).toBe('choice_duplicate');
    expect(validateChoices(['a', 'b', 'c'])).toBe('choices_need_four');
  });
});
