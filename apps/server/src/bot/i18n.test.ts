import { describe, expect, it } from 'vitest';
import { botEn, botJa, tb } from './i18n.ts';

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]!).sort();
}

describe('bot i18n', () => {
  it('has identical keys and placeholders between EN and JA', () => {
    expect(Object.keys(botJa).sort()).toEqual(Object.keys(botEn).sort());

    for (const key of Object.keys(botEn) as (keyof typeof botEn)[]) {
      expect(botEn[key].length).toBeGreaterThan(0);
      expect(botJa[key].length).toBeGreaterThan(0);
      expect(placeholders(botJa[key]), `placeholder mismatch for ${key}`).toEqual(
        placeholders(botEn[key]),
      );
    }
  });

  it('delegates shared keys to t() and interpolates local keys', () => {
    expect(tb('en', 'launch.openInActivity')).toBe('Open in Activity');
    expect(tb('ja', 'launch.openInActivity')).toBe('アクティビティで開く');
    expect(tb('en', 'bot.balance.title', { name: 'Alice' })).toBe("Alice's Balance");
    expect(tb('ja', 'bot.balance.title', { name: 'アリス' })).toBe('アリス の残高');
  });
});
