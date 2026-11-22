import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import { en } from '../../i18n/en.ts';
import { ja } from '../../i18n/ja.ts';
import { LEDGER_REASONS } from '../ledger.ts';
import {
  CASINO_GAME_IDS,
  CASINO_ROUTES,
  DailyClaimRequest,
  HistoryQuery,
  ROULETTE_KINDS,
  SLOT_SYMBOLS,
} from './casino.ts';
import { API_ROUTES } from '../api.ts';
import { GAME_IDS } from '../ids.ts';

describe('casino slice contracts', () => {
  it('routes live under /api and do not collide with the shell routes', () => {
    const taken = new Set<string>(Object.values(API_ROUTES));
    for (const route of Object.values(CASINO_ROUTES)) {
      expect(route.startsWith('/api/')).toBe(true);
      expect(taken.has(route)).toBe(false);
    }
  });

  it('plays only games the shared GameId knows', () => {
    for (const game of CASINO_GAME_IDS) expect(GAME_IDS).toContain(game);
  });

  it('rejects unknown properties in the claim body and bad history queries', () => {
    expect(Value.Check(DailyClaimRequest, { idempotencyKey: 'a'.repeat(16) })).toBe(true);
    expect(Value.Check(DailyClaimRequest, { idempotencyKey: 'a'.repeat(16), userId: '1' })).toBe(
      false,
    );
    expect(Value.Check(HistoryQuery, { before: '12', limit: '50' })).toBe(true);
    expect(Value.Check(HistoryQuery, { limit: '51' })).toBe(false);
    expect(Value.Check(HistoryQuery, { before: '0' })).toBe(false);
  });
});

describe('casino slice i18n', () => {
  it('names every ledger reason in both languages', () => {
    for (const reason of LEDGER_REASONS) {
      const key = `screen.casino.history.reason.${reason}`;
      expect(en, key).toHaveProperty([key]);
      expect(ja, key).toHaveProperty([key]);
    }
  });

  it('labels every roulette bet kind, hand and slot outcome', () => {
    for (const kind of ROULETTE_KINDS)
      expect(en).toHaveProperty([`screen.casino.roulette.kind.${kind}`]);
    for (const symbol of SLOT_SYMBOLS) expect(symbol.length).toBeGreaterThan(0);
    for (const kind of ['pinzoro', 'arashi', 'shigoro', 'me', 'menashi', 'hifumi']) {
      expect(ja).toHaveProperty([`screen.casino.chinchiro.hand.${kind}`]);
    }
  });

  it('keeps the shared Games label on Home', () => {
    expect(en['home.games']).toBe('Games');
    expect(ja['home.games']).toBe('ゲーム');
  });
});
