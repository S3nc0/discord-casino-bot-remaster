import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FIXED_KEYS,
  LIABILITY_KEYS,
  LIQUID_KEYS,
  PART_KEYS,
  assetGroups,
  balanceSheet,
  emptyParts,
  rankBalanceSheets,
  type AssetParts,
} from './economy-core.ts';

const amount = fc.integer({ min: 0, max: 1_000_000_000 });

/** Assets are zero or more, liabilities zero or less, as the collector stores them. */
const partsArb: fc.Arbitrary<AssetParts> = fc
  .tuple(
    fc.array(amount, { minLength: LIQUID_KEYS.length, maxLength: LIQUID_KEYS.length }),
    fc.array(amount, { minLength: FIXED_KEYS.length, maxLength: FIXED_KEYS.length }),
    fc.array(amount, { minLength: LIABILITY_KEYS.length, maxLength: LIABILITY_KEYS.length }),
  )
  .map(([liquid, fixed, owed]) => {
    const parts = emptyParts();
    LIQUID_KEYS.forEach((k, i) => (parts[k] = liquid[i] as number));
    FIXED_KEYS.forEach((k, i) => (parts[k] = fixed[i] as number));
    LIABILITY_KEYS.forEach((k, i) => (parts[k] = -(owed[i] as number)));
    return parts;
  });

describe('balance sheet', () => {
  it('lists every line once, current assets first and liabilities last', () => {
    expect(PART_KEYS).toEqual([...LIQUID_KEYS, ...FIXED_KEYS, ...LIABILITY_KEYS]);
    expect(new Set(PART_KEYS).size).toBe(PART_KEYS.length);
    expect(PART_KEYS).toHaveLength(15);
  });

  it('liquid + fixed - liabilities = net = the sum of the parts', () => {
    fc.assert(
      fc.property(partsArb, (parts) => {
        const g = assetGroups(parts);
        const sum = PART_KEYS.reduce((acc, k) => acc + parts[k], 0);
        expect(g.gross).toBe(g.liquid + g.fixed);
        expect(g.liquid + g.fixed - g.liabilities).toBe(g.net);
        expect(g.net).toBe(sum);
        expect(g.liabilities).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 500 },
    );
  });

  it('ranks by the chosen view, high to low, ties by user id as a number', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.bigInt({ min: 1n, max: 10n ** 19n }), partsArb), { maxLength: 30 }),
        fc.constantFrom('net' as const, 'liquid' as const, 'gross' as const),
        (rows, view) => {
          const sheets = rows.map(([id, parts]) => balanceSheet(String(id), parts));
          const ranked = rankBalanceSheets(sheets, view);
          expect(ranked).toHaveLength(sheets.length);
          for (let i = 1; i < ranked.length; i++) {
            const a = ranked[i - 1] as (typeof ranked)[number];
            const b = ranked[i] as (typeof ranked)[number];
            expect(a.groups[view]).toBeGreaterThanOrEqual(b.groups[view]);
            if (a.groups[view] === b.groups[view]) {
              expect(BigInt(a.userId) <= BigInt(b.userId)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('breaks a tie on the numeric id, not the text', () => {
    const p = emptyParts();
    p.cash = 100;
    const ranked = rankBalanceSheets([balanceSheet('100', p), balanceSheet('99', p)]);
    expect(ranked.map((s) => s.userId)).toEqual(['99', '100']);
  });

  it('liquid view can reorder players whom net worth ties', () => {
    const horses = emptyParts();
    horses.horses = 30_000;
    const cash = emptyParts();
    cash.cash = 20_000;
    cash.debt = -1;
    const net = rankBalanceSheets([balanceSheet('1', horses), balanceSheet('2', cash)], 'net');
    const liquid = rankBalanceSheets(
      [balanceSheet('1', horses), balanceSheet('2', cash)],
      'liquid',
    );
    expect(net.map((s) => s.userId)).toEqual(['1', '2']);
    expect(liquid.map((s) => s.userId)).toEqual(['2', '1']);
  });
});
