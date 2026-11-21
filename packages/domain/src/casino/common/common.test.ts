import { readFileSync } from 'node:fs';
import { createSeededRng, type Rng } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { PACHINKO_PROFILE } from '../pachinko/index.ts';
import { rouletteProfile } from '../roulette/index.ts';
import { SLOTS_PROFILE } from '../slots/index.ts';
import { pyRandom } from '../testing/pyrandom.ts';
import { jackpotChance, jackpotContribution, drawJackpot } from './jackpot.ts';
import {
  BLACKJACK_PROFILE,
  CHINCHIRO_PROFILE,
  adjustPayout,
  approxRtp,
  rtpFactor,
  type RtpProfile,
} from './rtp.ts';
import { bestBoost, eventBonus, insuranceRefund, settle, winTier } from './settlement.ts';

interface Fixture {
  seed: number;
  jackpot: {
    formulas: { bet: number; pool: number; chance: number; contribution: number }[];
    draws: { trial: number; hit: boolean }[];
  };
  events: {
    bonuses: ({ bet: number; boost: number; payout: number; bonus: number } & Record<
      string,
      number
    >)[];
  };
  rtp_levels: {
    game: string;
    kind: string | null;
    base_stats: [number, number];
    levels: Record<
      string,
      {
        approx_rtp: number;
        factor: number;
        adjust_1000_loss_0: number;
        adjust_1000_push_1000: number;
        adjust_1000_win_2000: number;
      }
    >;
  }[];
}
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../../tests/fixtures/legacy/casino-common/formulas.json', import.meta.url),
    'utf8',
  ),
) as Fixture;

const PROFILES: Record<string, RtpProfile> = {
  チンチロ: CHINCHIRO_PROFILE,
  スロット: SLOTS_PROFILE,
  ブラックジャック: BLACKJACK_PROFILE,
  パチンコ: PACHINKO_PROFILE,
  'ルーレット:red': rouletteProfile('red'),
  'ルーレット:number': rouletteProfile('number'),
};

describe('casino-common parity with the legacy fixtures', () => {
  it('matches every RTP level of every game', () => {
    for (const row of fixture.rtp_levels) {
      const profile = PROFILES[row.kind ? `${row.game}:${row.kind}` : row.game] as RtpProfile;
      expect(profile.rtp).toBeCloseTo(row.base_stats[0], 9);
      expect(profile.w).toBeCloseTo(row.base_stats[1], 9);
      for (const [level, expected] of Object.entries(row.levels)) {
        const n = Number(level);
        expect(rtpFactor(profile, n)).toBeCloseTo(expected.factor, 9);
        expect(approxRtp(profile, n)).toBeCloseTo(expected.approx_rtp, 9);
        expect(adjustPayout(profile, n, 1000, 0)).toBe(expected.adjust_1000_loss_0);
        expect(adjustPayout(profile, n, 1000, 1000)).toBe(expected.adjust_1000_push_1000);
        expect(adjustPayout(profile, n, 1000, 2000)).toBe(expected.adjust_1000_win_2000);
      }
    }
  });

  it('matches the jackpot chance and contribution formulas', () => {
    for (const f of fixture.jackpot.formulas) {
      expect(jackpotChance(f.bet, f.pool)).toBeCloseTo(f.chance, 12);
      // The fixture lists the contribution of a loss equal to the bet.
      expect(jackpotContribution(f.bet)).toBe(f.contribution);
    }
  });

  it('replays the 25 jackpot draws', () => {
    const rng = pyRandom(fixture.seed);
    for (const d of fixture.jackpot.draws) {
      expect(drawJackpot(rng, 100, 10_000)).toBe(d.hit);
    }
  });

  it('matches the event bonus table and best-boost rule', () => {
    for (const b of fixture.events.bonuses) {
      if ('best_boost_manual_higher' in b) {
        expect(bestBoost(0.5, 0.3)).toBe(0.5);
        expect(bestBoost(0.2, 0.5)).toBe(b['best_boost_manual_higher']);
        expect(bestBoost(0.5, 0)).toBe(b['best_boost_scheduled_only']);
        continue;
      }
      expect(eventBonus(b.bet, b.payout, b.boost)).toBe(b.bonus);
    }
  });
});

describe('jackpot', () => {
  it('cannot hit under the minimum pool and is capped at 2 %', () => {
    expect(jackpotChance(1_000_000, 9_999)).toBe(0);
    expect(jackpotChance(0, 50_000)).toBe(0);
    expect(jackpotChance(40_000, 10_000)).toBeCloseTo(0.02, 12);
    expect(jackpotChance(10_000_000, 10_000)).toBe(0.02);
  });

  it('draws only when there is a chance', () => {
    const calls: number[] = [];
    const rng: Rng = { int: () => 0, float: () => (calls.push(1), 0) };
    expect(drawJackpot(rng, 100, 9_999)).toBe(false);
    expect(calls).toHaveLength(0);
    expect(drawJackpot(rng, 100, 10_000)).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('settlement pipeline', () => {
  const base = {
    amount: 1000,
    rtpLevel: 3,
    rtpProfile: SLOTS_PROFILE,
    boost: 0,
    hasInsurance: false,
    penalty: 0,
    jackpotPool: 0,
  };
  const never = createSeededRng(1);

  it('pays a plain win and a plain loss', () => {
    const win = settle({ ...base, payout: 2000 }, never);
    expect(win).toMatchObject({
      total: 2000,
      net: 1000,
      lost: 0,
      withholdable: 1000,
      bankShare: 0,
    });
    const loss = settle({ ...base, payout: 0, jackpotPool: 1000 }, never);
    expect(loss).toMatchObject({
      total: 0,
      net: -1000,
      lost: 1000,
      bankShare: 30,
      jackpotContribution: 50,
      jackpotPoolAfter: 1050,
    });
  });

  it('applies the RTP level, then the event bonus, on the profit only', () => {
    const s = settle({ ...base, payout: 2000, rtpLevel: 6, boost: 0.5 }, never);
    expect(s.payout).toBe(2211);
    expect(s.rtpShift).toBe(211);
    expect(s.eventBonus).toBe(605);
    expect(s.total).toBe(2816);
    expect(settle({ ...base, payout: 500, boost: 0.5 }, never).eventBonus).toBe(0);
    expect(eventBonus(1_000_000, 3_000_000, 0.5)).toBe(10_000);
  });

  it('skips the adjustment when the game already did it (pachinko)', () => {
    const s = settle({ ...base, payout: 2000, rtpLevel: 6, rtpDone: true }, never);
    expect(s.payout).toBe(2000);
    expect(s.rtpShift).toBe(0);
  });

  it('refunds half the stake, capped, on a total loss with a ticket', () => {
    expect(insuranceRefund(1500)).toBe(750);
    expect(insuranceRefund(100_000)).toBe(1000);
    const s = settle({ ...base, payout: 0, hasInsurance: true }, never);
    expect(s.insured).toBe(500);
    expect(s.total).toBe(500);
    expect(s.lost).toBe(500);
    expect(settle({ ...base, payout: 300, hasInsurance: true }, never).insured).toBe(0);
  });

  it('keeps the chinchiro penalty out of the insurance and counts it in net', () => {
    const s = settle({ ...base, payout: 0, penalty: 2000, hasInsurance: true }, never);
    expect(s.insured).toBe(500);
    expect(s.net).toBe(500 - 1000 - 2000);
    expect(s.penalty).toBe(2000);
  });

  it('pays the whole pool (contribution included) on a jackpot hit', () => {
    const hit: Rng = { int: () => 0, float: () => 0 };
    const s = settle({ ...base, payout: 0, jackpotPool: 20_000 }, hit);
    expect(s.jackpotHit).toBe(true);
    expect(s.jackpotAmount).toBe(20_050);
    expect(s.jackpotPoolAfter).toBe(0);
  });

  it('tiers a win by net / bet', () => {
    expect(winTier(2000, 1000)).toBeNull();
    expect(winTier(3000, 1000)).toBe('big');
    expect(winTier(10_000, 1000)).toBe('super');
    expect(winTier(50_000, 1000)).toBe('jackpot');
    expect(winTier(-1, 10)).toBeNull();
  });
});
