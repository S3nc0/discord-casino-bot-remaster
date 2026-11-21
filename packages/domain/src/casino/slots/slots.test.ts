import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pyRandom } from '../testing/pyrandom.ts';
import { labelOf, multiplier, slotPayout, spinReels, SLOTS_PROFILE, type Reels } from './index.ts';

interface Fixture {
  seed: number;
  rtp: number;
  explicit_combos: { label: string; multiplier: number; reels: Reels }[];
  seeded_spins: { label: string; multiplier: number; reels: Reels }[];
}
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../../tests/fixtures/legacy/slots/spins.json', import.meta.url),
    'utf8',
  ),
) as Fixture;

function jaLabel(reels: Reels): string {
  const l = labelOf(reels);
  switch (l.kind) {
    case 'jackpot':
      return '7️⃣ 大当たり！！';
    case 'triple':
      return `${l.symbol} 3つ揃い！`;
    case 'cherry2':
      return '🍒🍒 チェリー2つ';
    case 'cherry1':
      return '🍒 チェリー（少し戻り）';
    case 'miss':
      return 'ハズレ';
  }
}

describe('slots parity with the legacy fixtures', () => {
  it('pays and labels the explicit combos', () => {
    for (const c of fixture.explicit_combos) {
      expect(multiplier(c.reels)).toBe(c.multiplier);
      expect(jaLabel(c.reels)).toBe(c.label);
    }
  });

  it('replays the 40 seeded spins', () => {
    const rng = pyRandom(fixture.seed);
    fixture.seeded_spins.forEach((expected) => {
      const reels = spinReels(rng);
      expect(reels).toEqual(expected.reels);
      expect(multiplier(reels)).toBe(expected.multiplier);
      expect(jaLabel(reels)).toBe(expected.label);
    });
  });

  it('has the exact base RTP and win share', () => {
    expect(SLOTS_PROFILE.rtp).toBeCloseTo(fixture.rtp, 9);
    expect(SLOTS_PROFILE.rtp).toBeCloseTo(28975 / 29791, 12);
    // The spec text says 0.659461; the legacy code (fixture base_stats) gives 0.5674532577.
    expect(SLOTS_PROFILE.w).toBeCloseTo(0.5674532577, 9);
  });

  it('floors the payout in integers', () => {
    expect(slotPayout(10, ['🍒', '🔔', '🍋'])).toBe(3);
    expect(slotPayout(11, ['🍒', '🍒', '🍋'])).toBe(16);
    expect(slotPayout(1000, ['7️⃣', '7️⃣', '7️⃣'])).toBe(500_000);
    expect(slotPayout(1000, ['🔔', '🍇', '🍋'])).toBe(0);
  });
});
