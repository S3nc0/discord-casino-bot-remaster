import { describe, expect, it } from 'vitest';
import { PRICE_SCALE } from '@casino/shared';
import { TEIAI_CONSTANTS, isTradableItem } from '@casino/domain/finance';
import { CATALOG, isAuctionListable } from '@casino/domain/shop';
import { GUILD, OTHER_USER, USER, createTestServer, type TestServer } from '../test-kit.ts';

function boot(): TestServer {
  const server = createTestServer();
  server.identity.ensureGuild(GUILD, 'approved', 'Test Guild');
  for (const userId of [USER, OTHER_USER]) {
    server.economy.credit({
      guildId: GUILD,
      userId,
      amount: 50_000,
      reason: 'admin_grant',
      idempotencyKey: `seed-${userId}`,
    });
  }
  return server;
}

const debtOf = (s: TestServer, userId = USER): number => s.finance.teiai.getDebt(GUILD, userId);
const reasonsOf = (s: TestServer, userId = USER): string[] =>
  s.economy.history(GUILD, userId, 100).map((r) => r.reason);

const horse = (s: TestServer, ownerId: string | null, retiredAt: number | null = null): number =>
  Number(
    s.store
      .stmt(
        `INSERT INTO horses (guild_id, owner_id, name, coat, silks, speed, stamina, power, guts, retired_at, created_at)
         VALUES (?, ?, 'Test', 'bay', 'red', 50, 50, 50, 50, ?, ?)`,
      )
      .run(GUILD, ownerId, retiredAt, s.clock.now()).lastInsertRowid,
  );

describe('Teiai port on the finance services', () => {
  it('a debtor daily claim pays the Teiai cut and the withholding into the finance tables', () => {
    const s = boot();
    s.finance.teiai.addDebtFromExcess(GUILD, USER, 5_000);
    const houseBefore = (
      s.store.stmt('SELECT COALESCE(SUM(balance), 0) AS b FROM house_account').get() as {
        b: number;
      }
    ).b;
    const claim = s.games.progression.claimDaily(GUILD, USER);
    expect(claim.ok).toBe(true);
    const rows = reasonsOf(s);
    expect(rows).toEqual(expect.arrayContaining(['daily_bonus', 'teiai_skim', 'debt_withholding']));
    expect(debtOf(s)).toBeLessThan(5_000);
    const house = (
      s.store.stmt('SELECT COALESCE(SUM(balance), 0) AS b FROM house_account').get() as {
        b: number;
      }
    ).b;
    expect(house).toBeGreaterThan(houseBefore);
    s.close();
  });

  it('paying the debt below the grace threshold ends the grace window', () => {
    const s = boot();
    s.finance.teiai.addDebtFromExcess(GUILD, USER, TEIAI_CONSTANTS.graceDebt + 100);
    expect(s.finance.teiai.isInGrace(GUILD, USER)).toBe(true);
    // The casino's debt port pays down through the same adapter.
    const withheld = s.casino.core.ports.debt.withhold(GUILD, USER, 1_000);
    expect(withheld).toBe(300);
    expect(debtOf(s)).toBe(TEIAI_CONSTANTS.graceDebt + 100 - 300);
    s.finance.teiai.addDebtFromExcess(GUILD, OTHER_USER, TEIAI_CONSTANTS.graceDebt);
    s.store
      .stmt('UPDATE bank_accounts SET debt = ? WHERE guild_id = ? AND user_id = ?')
      .run(TEIAI_CONSTANTS.graceDebt - 1 + 300, GUILD, OTHER_USER);
    expect(s.casino.core.ports.debt.withhold(GUILD, OTHER_USER, 1_000)).toBe(300);
    expect(s.finance.teiai.isInGrace(GUILD, OTHER_USER)).toBe(false);
    s.close();
  });

  it('prize top-ups draw from bank cash only, and the loss share adds to it', () => {
    const s = boot();
    const cash = (): number =>
      (
        s.store.stmt('SELECT cash_micros AS c FROM bank_reserve WHERE guild_id = ?').get(GUILD) as {
          c: number;
        }
      ).c / PRICE_SCALE;
    s.finance.teiai.ensureReserve(GUILD);
    const before = cash();
    s.casino.core.ports.bank.lossShare(GUILD, 300, 'slots');
    expect(cash()).toBe(before + 300);
    s.close();
  });
});

describe('casino ports', () => {
  it('borrowing for a blackjack double posts loan_borrow and adds Teiai debt, within the seed cap', () => {
    const s = boot();
    const { credit } = s.casino.core.ports;
    const before = s.economy.getBalance(GUILD, USER);
    expect(credit.borrowForDouble(GUILD, USER, TEIAI_CONSTANTS.seedLoanCap + 1)).toBe(false);
    expect(credit.borrowForDouble(GUILD, USER, 0)).toBe(false);
    expect(credit.borrowForDouble(GUILD, USER, 800)).toBe(true);
    expect(reasonsOf(s)).toContain('loan_borrow');
    expect(debtOf(s)).toBe(800);
    expect(s.economy.getBalance(GUILD, USER)).toBe(before + 800);
    // In the 24 h grace window the bank no longer lends.
    s.finance.teiai.addDebtFromExcess(GUILD, OTHER_USER, TEIAI_CONSTANTS.graceDebt);
    expect(credit.borrowForDouble(GUILD, OTHER_USER, 800)).toBe(false);
    s.close();
  });

  it('a chinchiro shortfall is a forced execution: assets first, then debt', () => {
    const s = boot();
    s.economy.debit({
      guildId: GUILD,
      userId: OTHER_USER,
      amount: s.economy.getBalance(GUILD, OTHER_USER),
      reason: 'admin_revoke',
      idempotencyKey: 'empty',
    });
    s.casino.core.ports.debt.owe(GUILD, OTHER_USER, 2_000, 'chinchiro');
    expect(debtOf(s, OTHER_USER)).toBeGreaterThanOrEqual(2_000);
    s.close();
  });

  it('insurance follows the shop inventory and is consumed once', () => {
    const s = boot();
    const { insurance } = s.casino.core.ports;
    expect(insurance.has(GUILD, USER)).toBe(false);
    s.store
      .stmt('INSERT INTO profiles (guild_id, user_id, insurance) VALUES (?, ?, 1)')
      .run(GUILD, USER);
    expect(insurance.has(GUILD, USER)).toBe(true);
    insurance.consume(GUILD, USER);
    expect(insurance.has(GUILD, USER)).toBe(false);
    s.close();
  });
});

describe('player market assets', () => {
  const tradable = CATALOG.find((item) => isTradableItem(item.id));

  it('lists, sells and delivers a shop item through the real inventory', () => {
    const s = boot();
    const item = tradable!;
    s.games.shop.inventory.add(GUILD, USER, item.id, 1);
    const listed = s.finance.playerMarket.listAsset({
      guildId: GUILD,
      sellerId: USER,
      kind: 'item',
      ref: item.id,
      mode: 'fixed',
      price: item.price,
    });
    expect(listed).toMatchObject({ ok: true });
    expect(s.games.shop.inventory.qty(GUILD, USER, item.id)).toBe(0);
    const id = listed.ok ? listed.data : 0;
    expect(s.finance.playerMarket.buyFixed(GUILD, OTHER_USER, id)).toMatchObject({ ok: true });
    expect(s.games.shop.inventory.qty(GUILD, OTHER_USER, item.id)).toBe(1);
    expect(reasonsOf(s, OTHER_USER)).toContain('marketplace_buy');
    expect(reasonsOf(s)).toContain('marketplace_sale');
    s.close();
  });

  it('escrows a horse (no owner, not retired), returns it on cancel, and refuses what is not owned', () => {
    const s = boot();
    const id = horse(s, USER);
    const owner = (): string | null =>
      (
        s.store.stmt('SELECT owner_id FROM horses WHERE id = ?').get(id) as {
          owner_id: string | null;
        }
      ).owner_id;
    const listed = s.finance.playerMarket.listAsset({
      guildId: GUILD,
      sellerId: USER,
      kind: 'horse',
      ref: String(id),
      mode: 'fixed',
      price: 5_000,
    });
    expect(listed).toMatchObject({ ok: true });
    expect(owner()).toBeNull();
    expect(
      s.finance.playerMarket.listAsset({
        guildId: GUILD,
        sellerId: USER,
        kind: 'horse',
        ref: String(id),
        mode: 'fixed',
        price: 5_000,
      }),
    ).toMatchObject({ ok: false });
    expect(
      s.finance.playerMarket.cancelListing(GUILD, USER, listed.ok ? listed.data : 0),
    ).toMatchObject({ ok: true });
    expect(owner()).toBe(USER);
    const retired = horse(s, null, s.clock.now());
    expect(
      s.finance.playerMarket.listAsset({
        guildId: GUILD,
        sellerId: USER,
        kind: 'horse',
        ref: String(retired),
        mode: 'fixed',
        price: 5_000,
      }),
    ).toMatchObject({ ok: false });
    s.close();
  });
});

describe('bankruptcy liquidation of game assets', () => {
  it('seizes shop items and horses into the pool and the seized-goods auction', () => {
    const s = boot();
    const item = CATALOG.find((i) => isAuctionListable(i) && i.price >= 1_000)!;
    s.games.shop.inventory.add(GUILD, OTHER_USER, item.id, 1);
    horse(s, OTHER_USER);
    s.finance.teiai.addDebtFromExcess(GUILD, OTHER_USER, 30_000);
    const report = s.finance.teiai.declareBankruptcy(GUILD, OTHER_USER);
    expect(report.ok).toBe(true);
    if (report.ok) expect(report.data.shopValue).toBeGreaterThan(0);
    expect(s.games.shop.inventory.qty(GUILD, OTHER_USER, item.id)).toBe(0);
    expect(
      (
        s.store
          .stmt('SELECT COUNT(*) AS n FROM horses WHERE guild_id = ? AND owner_id = ?')
          .get(GUILD, OTHER_USER) as { n: number }
      ).n,
    ).toBe(0);
    expect(s.games.shop.seizedLots(GUILD).length).toBeGreaterThan(0);
    s.close();
  });
});
