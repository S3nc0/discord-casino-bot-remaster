import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { MS_PER_DAY, companyInvested, spotSellQuote } from '@casino/domain/finance';
import { PART_KEYS, emptyParts } from '@casino/domain/progression';
import { HORSE_VOUCHER_PRICE, horseWorth } from '@casino/domain/race';
import { dormSpent, relicValue, upgradeSpent } from '@casino/domain/work';
import { BALANCE_SHEET_PART_KEYS } from '@casino/shared';
import { GUILD, createTestServer, type TestServer } from '../runtime/test-kit.ts';
import { itemWorth } from './net-worth-service.ts';

const A = '300000000000000001';
const B = '300000000000000002';
const C = '300000000000000003';

let server: TestServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

function boot(): TestServer {
  server = createTestServer();
  return server;
}

function member(s: TestServer, userId: string, cash = 0): void {
  s.economy.ensureMember(GUILD, userId, { initialGrant: false });
  if (cash > 0) s.economy.credit({ guildId: GUILD, userId, amount: cash, reason: 'admin_grant' });
}

function setDebt(s: TestServer, userId: string, debt: number, interestAt = s.clock.now()): void {
  s.finance.teiai.ensureAccount(GUILD, userId);
  s.store
    .stmt(
      'UPDATE bank_accounts SET debt = ?, debt_interest_at = ? WHERE guild_id = ? AND user_id = ?',
    )
    .run(debt, interestAt, GUILD, userId);
}

function addHorse(
  s: TestServer,
  ownerId: string | null,
  races: number,
  wins: number,
  places: number,
): number {
  const res = s.store
    .stmt(
      `INSERT INTO horses (guild_id, owner_id, name, coat, silks, speed, stamina, power, guts, races, wins, places, created_at)
       VALUES (?, ?, 'H', 'bay', 'red', 50, 50, 50, 50, ?, ?, ?, ?)`,
    )
    .run(GUILD, ownerId, races, wins, places, s.clock.now());
  return Number(res.lastInsertRowid);
}

function sheetOf(s: TestServer, userId: string) {
  const sheet = s.finance.netWorth.sheets(GUILD).find((x) => x.userId === userId);
  if (!sheet) throw new Error(`no sheet for ${userId}`);
  return sheet;
}

describe('NetWorthService: one line per source', () => {
  it('the wire contract lists the same lines as the domain, in the same order', () => {
    expect([...BALANCE_SHEET_PART_KEYS]).toEqual([...PART_KEYS]);
  });

  it('counts cash, deposit, debt, bonds, pot, tools, waiting relics, items and horses', () => {
    const s = boot();
    member(s, A, 50_000);
    s.store
      .stmt('INSERT INTO bank_deposits (guild_id, user_id, amount, updated_at) VALUES (?, ?, ?, ?)')
      .run(GUILD, A, 12_000, s.clock.now());
    setDebt(s, A, 4_000);
    s.store
      .stmt(
        `INSERT INTO bonds (guild_id, user_id, kind, principal, rate_bps, status, payout, created_at, due_at, checked_at)
         VALUES (?, ?, 'normal', 7000, 100, 'active', 0, ?, ?, ?), (?, ?, 'normal', 9000, 100, 'matured', 9100, ?, ?, ?)`,
      )
      .run(GUILD, A, 0, 1, 0, GUILD, A, 0, 1, 0);
    s.store
      .stmt(
        `INSERT INTO work_state (guild_id, user_id, pick, glove, dorm, pot, relics) VALUES (?, ?, 2, 1, 1, 640, ?)`,
      )
      .run(GUILD, A, JSON.stringify({ relic_bone: 2 }));
    s.games.shop.inventory.add(GUILD, A, 'title_rookie', 3);
    s.games.shop.inventory.add(GUILD, A, 'relic_fossil_s1', 1);
    addHorse(s, A, 10, 3, 5);
    const retired = addHorse(s, A, 1, 0, 0);
    s.store.stmt('UPDATE horses SET retired_at = 1 WHERE id = ?').run(retired);

    const { parts, groups } = sheetOf(s, A);
    expect(parts.cash).toBe(50_000);
    expect(parts.deposit).toBe(12_000);
    expect(parts.debt).toBe(-4_000);
    expect(parts.bonds).toBe(7_000);
    expect(parts.pot).toBe(640);
    expect(parts.tools).toBe(upgradeSpent(2) + upgradeSpent(1) + dormSpent(1));
    expect(parts.items).toBe(3 * 2_000);
    expect(parts.relics).toBe(2 * relicValue('relic_bone') + relicValue('relic_fossil_s1'));
    expect(parts.horses).toBe(horseWorth(10, 3, 5));
    expect(horseWorth(10, 3, 5)).toBeGreaterThan(0);
    expect(groups.liabilities).toBe(4_000);
    expect(groups.net).toBe(groups.liquid + groups.fixed - groups.liabilities);
  });

  it('values spot at the sell quote and margin at max(0, margin + P&L)', () => {
    const s = boot();
    member(s, A, 100_000);
    const bought = s.finance.stocks.buySpot(GUILD, A, 'teio', 20_000);
    expect(bought.ok).toBe(true);
    const prices = s.finance.stocks.getPricesMicros();
    const spot = s.finance.stocks.getSpotHoldings(GUILD, A)[0];
    if (!spot) throw new Error('no spot');
    s.store
      .stmt(
        `INSERT INTO positions_long (guild_id, user_id, symbol, units_milli, entry_value_micros, margin, opened_at, interest_at)
         VALUES (?, ?, 'teio', 1000, ?, 500, 0, 0)`,
      )
      .run(GUILD, A, prices.teio);
    // A short that has lost more than its margin counts 0, never below.
    s.store
      .stmt(
        `INSERT INTO positions_short (guild_id, user_id, symbol, units_milli, entry_value_micros, margin, opened_at, interest_at)
         VALUES (?, ?, 'teio', 1000, 1, 10, 0, 0)`,
      )
      .run(GUILD, A);
    const { parts } = sheetOf(s, A);
    expect(parts.crypto).toBe(spotSellQuote(spot.units_milli, prices.teio).proceeds + 500);
  });

  it('counts listed items and horses for the seller and a held bid for the bidder', () => {
    const s = boot();
    member(s, A);
    member(s, B, 10_000);
    const horse = addHorse(s, null, 0, 0, 0);
    s.store
      .stmt(
        `INSERT INTO marketplace_listings (guild_id, seller_id, kind, ref, qty, mode, price, bid, bidder_id, status, created_at, end_at)
         VALUES (?, ?, 'item', 'title_broke', 2, 'auction', 100, 700, ?, 'active', 0, 1),
                (?, ?, 'horse', ?, 1, 'fixed', 100, 0, NULL, 'active', 0, 1),
                (?, ?, 'item', 'title_broke', 1, 'fixed', 100, 0, NULL, 'sold', 0, 1)`,
      )
      .run(GUILD, A, B, GUILD, A, String(horse), GUILD, A);
    s.store
      .stmt(
        `INSERT INTO kyosai_auctions (guild_id, units, status, top_bid, top_bidder_id, ends_at, created_at)
         VALUES (?, 1, 'open', 300, ?, 1, 0)`,
      )
      .run(GUILD, B);
    expect(sheetOf(s, A).parts.items).toBe(2 * 3_000);
    expect(sheetOf(s, A).parts.horses).toBe(HORSE_VOUCHER_PRICE);
    expect(sheetOf(s, B).parts.escrow).toBe(1_000);
  });

  it('puts what is left of a P2P loan on both sides and splits a company with its investors', () => {
    const s = boot();
    member(s, A);
    member(s, B);
    const now = s.clock.now();
    s.store
      .stmt(
        `INSERT INTO loans (guild_id, lender_id, borrower_id, principal, rate_bps, term_days, status, paid, created_at, offer_expires_at, accepted_at, due_at)
         VALUES (?, ?, ?, 10000, 0, 7, 'active', 2500, ?, ?, ?, ?)`,
      )
      .run(GUILD, A, B, now, now, now, now + 7 * MS_PER_DAY);
    s.store
      .stmt(
        `INSERT INTO companies (guild_id, user_id, name, kind, level, funds, stock_at, upkeep_day, created_at)
         VALUES (?, ?, 'Co', 'farm', 1, 20000, 0, '2026-01-01', 0)`,
      )
      .run(GUILD, B);
    s.store
      .stmt(
        'INSERT INTO company_stakes (guild_id, owner_id, investor_id, amount, updated_at) VALUES (?, ?, ?, 5000, 0)',
      )
      .run(GUILD, B, A);
    const a = sheetOf(s, A).parts;
    const b = sheetOf(s, B).parts;
    expect(a.loans_lent).toBe(7_500);
    expect(b.loans_owed).toBe(-7_500);
    expect(a.company).toBe(5_000);
    expect(b.company).toBe(20_000 + companyInvested(1) - 5_000);
  });

  it('values an item without a price at 0 and a relic by its stars', () => {
    expect(itemWorth('title_weekly_king')).toEqual({ worth: 0, relic: false });
    expect(itemWorth('no_such_item')).toEqual({ worth: 0, relic: false });
    expect(itemWorth('relic_crown_s2')).toEqual({
      worth: relicValue('relic_crown_s2'),
      relic: true,
    });
  });
});

describe('NetWorthService: ranking', () => {
  it('accrues Toichi interest before it ranks, and writes it', () => {
    const s = boot();
    member(s, A, 10_000);
    member(s, B, 9_000);
    setDebt(s, A, 1_000);
    s.clock.advance(3 * MS_PER_DAY);
    const standings = s.finance.netWorth.standings(GUILD, 'net');
    const debt = (
      s.store
        .stmt('SELECT debt FROM bank_accounts WHERE guild_id = ? AND user_id = ?')
        .get(GUILD, A) as { debt: number }
    ).debt;
    expect(debt).toBeGreaterThan(1_000);
    const a = standings.rows.find((r) => r.sheet.userId === A);
    expect(a?.sheet.parts.debt).toBe(-debt);
    expect(a?.value).toBe(10_000 - debt);
    // B (9,000) now outranks A (10,000 - accrued debt < 9,000).
    expect(standings.rows.map((r) => r.sheet.userId)).toEqual([B, A]);
  });

  it('sorts (-value, user id), ranks every member, and finds the caller outside the top', () => {
    const s = boot();
    member(s, C, 5_000);
    member(s, B, 5_000);
    member(s, A, 1_000);
    const top = s.finance.netWorth.standingsWithSelf(GUILD, A, 'net', 2);
    expect(top.rows.map((r) => [r.rank, r.sheet.userId])).toEqual([
      [1, B],
      [2, C],
    ]);
    expect(top.total).toBe(3);
    expect(top.self?.rank).toBe(3);
    expect(s.finance.netWorth.standingsWithSelf(GUILD, '999', 'net').self).toBeNull();
  });

  it('liquid view leaves fixed assets out', () => {
    const s = boot();
    member(s, A, 1_000);
    member(s, B, 2_000);
    addHorse(s, A, 0, 0, 0);
    expect(s.finance.netWorth.standings(GUILD, 'net').rows[0]?.sheet.userId).toBe(A);
    const liquid = s.finance.netWorth.standings(GUILD, 'liquid');
    expect(liquid.rows.map((r) => [r.sheet.userId, r.value])).toEqual([
      [B, 2_000],
      [A, 1_000],
    ]);
  });

  it('liquid + fixed - liabilities = net = the sum of the parts, for any guild', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            cash: fc.integer({ min: 0, max: 1_000_000 }),
            deposit: fc.integer({ min: 0, max: 1_000_000 }),
            debt: fc.integer({ min: 0, max: 14_999 }),
            titles: fc.integer({ min: 0, max: 5 }),
            pot: fc.integer({ min: 0, max: 50_000 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (players) => {
          const s = createTestServer();
          try {
            players.forEach((p, i) => {
              const id = String(400_000_000_000_000_000n + BigInt(i));
              member(s, id, p.cash);
              if (p.deposit > 0) {
                s.store
                  .stmt(
                    'INSERT INTO bank_deposits (guild_id, user_id, amount, updated_at) VALUES (?, ?, ?, 0)',
                  )
                  .run(GUILD, id, p.deposit);
              }
              if (p.debt > 0) setDebt(s, id, p.debt);
              if (p.titles > 0) s.games.shop.inventory.add(GUILD, id, 'title_regular', p.titles);
              s.store
                .stmt('INSERT INTO work_state (guild_id, user_id, pot) VALUES (?, ?, ?)')
                .run(GUILD, id, p.pot);
            });
            const sheets = s.finance.netWorth.sheets(GUILD);
            expect(sheets).toHaveLength(players.length);
            for (const { parts, groups } of sheets) {
              const sum = PART_KEYS.reduce((acc, k) => acc + parts[k], 0);
              expect(groups.liquid + groups.fixed - groups.liabilities).toBe(groups.net);
              expect(groups.net).toBe(sum);
            }
            players.forEach((p, i) => {
              const id = String(400_000_000_000_000_000n + BigInt(i));
              const sheet = sheets.find((x) => x.userId === id);
              const want = emptyParts();
              want.cash = p.cash;
              want.deposit = p.deposit;
              want.debt = 0 - p.debt || 0;
              want.items = p.titles * itemWorth('title_regular').worth;
              want.pot = p.pot;
              expect(sheet?.parts).toEqual(want);
            });
          } finally {
            void s.close();
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  it('ranks 1,000 seeded players within the Pi budget', () => {
    const s = boot();
    const ids: string[] = [];
    s.store.transaction(() => {
      for (let i = 0; i < 1_000; i++) {
        const id = String(500_000_000_000_000_000n + BigInt(i));
        ids.push(id);
        member(s, id, 1_000 + i * 37);
        s.store
          .stmt(
            'INSERT INTO bank_deposits (guild_id, user_id, amount, updated_at) VALUES (?, ?, ?, 0)',
          )
          .run(GUILD, id, i * 11);
        s.store
          .stmt(
            'INSERT INTO work_state (guild_id, user_id, pick, glove, dorm, pot, relics) VALUES (?, ?, 1, 1, 0, ?, ?)',
          )
          .run(GUILD, id, i, JSON.stringify({ relic_fossil: 1 }));
        s.games.shop.inventory.add(GUILD, id, 'title_rookie', 1 + (i % 3));
        s.store
          .stmt(
            `INSERT INTO positions_spot (guild_id, user_id, symbol, units_milli, cost) VALUES (?, ?, 'teio', ?, 100)`,
          )
          .run(GUILD, id, 1_000 + i);
        if (i % 4 === 0) addHorse(s, id, i % 20, i % 5, i % 9);
        if (i % 10 === 0) setDebt(s, id, 500 + i, s.clock.now() - 2 * MS_PER_DAY);
        if (i % 25 === 0) {
          s.store
            .stmt(
              `INSERT INTO bonds (guild_id, user_id, kind, principal, rate_bps, status, payout, created_at, due_at, checked_at)
               VALUES (?, ?, 'normal', 5000, 100, 'active', 0, 0, 1, 0)`,
            )
            .run(GUILD, id);
        }
      }
    });
    s.finance.netWorth.standings(GUILD, 'net'); // warm the statement cache
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const res = s.finance.netWorth.standingsWithSelf(GUILD, ids[500] as string, 'net', 10);
      runs.push(performance.now() - t0);
      expect(res.total).toBe(1_000);
      expect(res.self?.sheet.userId).toBe(ids[500]);
    }
    runs.sort((a, b) => a - b);
    const median = runs[2] as number;
    console.info(`net worth ranking, 1,000 players: median ${median.toFixed(1)} ms`);
    // The board refreshes once a minute; even 10x slower on a Pi this stays far below that.
    expect(median).toBeLessThan(250);
  });
});
