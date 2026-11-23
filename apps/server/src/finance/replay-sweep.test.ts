import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRICE_SCALE, createSeededRng, manualClock } from '@casino/shared';
import { IdentityRepo } from '../db/identity.ts';
import type { Store } from '../db/store.ts';
import { EconomyService } from '../economy/economy-service.ts';
import { AppError } from '../runtime/errors.ts';
import { GUILD, memoryStore } from '../runtime/test-kit.ts';
import { InMemoryMarketplaceAssetAdapter, createFinanceServices } from './index.ts';
import type { ServiceResult } from './teiai-service.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const U1 = '200000000000000001';
const U2 = '200000000000000002';
const U3 = '200000000000000003';
const START = 1_736_121_600_000; // 2025-01-06T00:00:00Z
const KEY = 'sweep-key-0000000001';

function env() {
  const store = memoryStore();
  const clock = manualClock(START);
  const identity = new IdentityRepo(store, () => clock.now());
  const economy = new EconomyService({ store, identity, clock });
  const assets = new InMemoryMarketplaceAssetAdapter();
  const fin = createFinanceServices(
    { store, economy, identity, clock, rng: createSeededRng(7), utcOffsetHours: 9 },
    { marketplaceAssets: assets },
  );
  const seed = (userId: string, amount: number) => {
    economy.ensureMember(GUILD, userId, { initialGrant: false });
    if (amount > 0) economy.credit({ guildId: GUILD, userId, amount, reason: 'admin_grant' });
  };
  seed(U1, 1_000_000);
  seed(U2, 1_000_000);
  fin.stocks.ensureMarketInitialized();
  fin.stocks.setPrice('gold', 1_000 * PRICE_SCALE, START);
  return { store, clock, economy, assets, fin, seed };
}
type Env = ReturnType<typeof env>;

const data = <T>(res: ServiceResult<T>): T => {
  if (!res.ok) throw new Error(`fixture failed: ${res.reason}`);
  return res.data;
};

/** Every row of every table but the idempotency store, in a stable order. */
function snapshot(store: Store): string {
  const tables = store.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'idempotency_keys' ORDER BY name",
    )
    .all() as { name: string }[];
  return JSON.stringify(
    tables.map(({ name }) => [
      name,
      (store.db.prepare(`SELECT * FROM "${name}"`).all() as unknown[])
        .map((row) => JSON.stringify(row))
        .sort(),
    ]),
  );
}

/**
 * One case per finance write that takes an idempotency key: `setup` builds the state and returns
 * the call, which runs once with the key and then again with the same key.
 */
const CASES: Record<string, (e: Env) => (key: string) => ServiceResult<unknown>> = {
  'teiai.bankDeposit':
    ({ fin }) =>
    (k) =>
      fin.teiai.bankDeposit(GUILD, U1, 50_000, START, k),
  'teiai.bankWithdraw': ({ fin }) => {
    data(fin.teiai.bankDeposit(GUILD, U1, 50_000, START));
    return (k) => fin.teiai.bankWithdraw(GUILD, U1, 10_000, START, k);
  },
  'teiai.borrowSeed': ({ fin, seed }) => {
    seed(U3, 0);
    return (k) => fin.teiai.borrowSeed(GUILD, U3, START, k);
  },
  'teiai.repayDebt': ({ fin }) => {
    fin.teiai.adminSetDebt(GUILD, U1, 50_000);
    return (k) => fin.teiai.repayDebt(GUILD, U1, 1_000, START, k);
  },
  'teiai.creditWithWithholding':
    ({ fin }) =>
    (k) => ({
      ok: true,
      data: fin.teiai.creditWithWithholding(GUILD, U1, 1_000, 'bank_interest', {
        idempotencyKey: k,
        nowMs: START,
      }),
    }),
  'teiai.buyCds':
    ({ fin }) =>
    (k) =>
      fin.teiai.buyCds(GUILD, U1, U2, 10_000, START, k),
  'stocks.buySpot':
    ({ fin }) =>
    (k) =>
      fin.stocks.buySpot(GUILD, U1, 'gold', 10_000, START, { idempotencyKey: k }),
  'stocks.sellSpot': ({ fin }) => {
    const units = data(fin.stocks.buySpot(GUILD, U1, 'gold', 50_000, START)).unitsMilli;
    return (k) =>
      fin.stocks.sellSpot(GUILD, U1, 'gold', Math.floor(units / 4), START, { idempotencyKey: k });
  },
  'stocks.openMargin':
    ({ fin }) =>
    (k) =>
      fin.stocks.openMargin(GUILD, U1, 'long', 'gold', 10_000, 2, START, k),
  'stocks.closeMargin': ({ fin }) => {
    data(fin.stocks.openMargin(GUILD, U1, 'long', 'gold', 40_000, 2, START));
    return (k) =>
      fin.stocks.closeMargin(GUILD, U1, 'long', 'gold', START, { idempotencyKey: k, percent: 25 });
  },
  'stocks.buyOption':
    ({ fin }) =>
    (k) =>
      fin.stocks.buyOption({
        guildId: GUILD,
        userId: U1,
        kind: 'call',
        symbol: 'gold',
        premium: 1_000,
        hours: 6,
        nowMs: START,
        idempotencyKey: k,
      }),
  'stocks.writeOption':
    ({ fin }) =>
    (k) =>
      fin.stocks.writeOption({
        guildId: GUILD,
        userId: U1,
        kind: 'call',
        symbol: 'gold',
        unitsMilli: 5_000,
        hours: 6,
        nowMs: START,
        idempotencyKey: k,
      }),
  'stocks.sellOptionEarly': ({ fin }) => {
    const opt = data(
      fin.stocks.buyOption({
        guildId: GUILD,
        userId: U1,
        kind: 'call',
        symbol: 'gold',
        premium: 5_000,
        hours: 6,
        nowMs: START,
      }),
    );
    return (k) => fin.stocks.sellOptionEarly(GUILD, U1, opt.id, START, k);
  },
  'stocks.buybackOption': ({ fin }) => {
    const opt = data(
      fin.stocks.writeOption({
        guildId: GUILD,
        userId: U1,
        kind: 'call',
        symbol: 'gold',
        unitsMilli: 5_000,
        hours: 6,
        nowMs: START,
      }),
    );
    return (k) => fin.stocks.buybackOption(GUILD, U1, opt.id, START, k);
  },
  'stocks.buyBond':
    ({ fin }) =>
    (k) =>
      fin.stocks.buyBond(GUILD, U1, 'normal', 5_000, START, k),
  'stocks.sellBondEarly': ({ fin }) => {
    const bond = data(fin.stocks.buyBond(GUILD, U1, 'normal', 5_000, START));
    return (k) => fin.stocks.sellBondEarly(GUILD, U1, bond.id, START, k);
  },
  'stocks.buyEarningsMemo': ({ fin, store }) => {
    store.db
      .prepare(
        "INSERT INTO earnings (symbol, direction, size_bps, announce_at, release_at, status) VALUES ('gold', 1, 500, ?, ?, 'announced')",
      )
      .run(START, START + 3_600_000);
    return (k) => fin.stocks.buyEarningsMemo(GUILD, U1, START, undefined, k);
  },
  'kyosai.bidAuction': ({ fin }) => {
    fin.kyosai.tickAuctions(GUILD, START);
    return (k) => fin.kyosai.bidAuction(GUILD, U1, 5_000, START + 60_000, k);
  },
  'kyosai.acceptOffer': ({ fin }) => {
    fin.kyosai.tickAuctions(GUILD, START);
    data(fin.kyosai.bidAuction(GUILD, U2, 5_000, START + 60_000));
    const settleAt = START + 2 * 86_400_000;
    fin.kyosai.tickAuctions(GUILD, settleAt);
    const offerId = data(fin.kyosai.createOffer(GUILD, U2, U1, 1, 8_000, settleAt));
    return (k) => fin.kyosai.acceptOffer(GUILD, U1, offerId, settleAt, k);
  },
  'playerMarket.buyFixed': ({ fin, assets }) => {
    assets.grantItem(GUILD, U2, 'daily_double', 1);
    const id = data(
      fin.playerMarket.listAsset({
        guildId: GUILD,
        sellerId: U2,
        kind: 'item',
        ref: 'daily_double',
        qty: 1,
        mode: 'fixed',
        price: 3_000,
        nowMs: START,
      }),
    );
    return (k) => fin.playerMarket.buyFixed(GUILD, U1, id, START + 60_000, k);
  },
  'playerMarket.placeBid': ({ fin, assets }) => {
    assets.grantItem(GUILD, U2, 'daily_double', 1);
    const id = data(
      fin.playerMarket.listAsset({
        guildId: GUILD,
        sellerId: U2,
        kind: 'item',
        ref: 'daily_double',
        qty: 1,
        mode: 'auction',
        price: 3_000,
        hours: 6,
        nowMs: START,
      }),
    );
    return (k) => fin.playerMarket.placeBid(GUILD, U1, id, 3_000, START + 60_000, k);
  },
  'loans.acceptOffer': ({ fin }) => {
    const id = data(
      fin.loans.offerLoan({
        guildId: GUILD,
        lenderId: U2,
        borrowerId: U1,
        principal: 1_000,
        rateBps: 100,
        termDays: 5,
      }),
    );
    return (k) => fin.loans.acceptOffer(GUILD, id, U1, START, k);
  },
  'loans.lendToRequest': ({ fin }) => {
    const id = data(
      fin.loans.requestLoan({
        guildId: GUILD,
        borrowerId: U2,
        principal: 1_000,
        rateBps: 100,
        termDays: 5,
      }),
    );
    return (k) => fin.loans.lendToRequest(GUILD, id, U1, START, k);
  },
  'loans.repayLoan': ({ fin }) => {
    const id = data(
      fin.loans.offerLoan({
        guildId: GUILD,
        lenderId: U2,
        borrowerId: U1,
        principal: 10_000,
        rateBps: 100,
        termDays: 5,
      }),
    );
    data(fin.loans.acceptOffer(GUILD, id, U1, START));
    return (k) => fin.loans.repayLoan(GUILD, id, U1, 1_000, START, k);
  },
  'companies.foundCompany':
    ({ fin }) =>
    (k) =>
      fin.companies.foundCompany(GUILD, U1, 'Pixel Farm', 'farm', START, k),
  'companies.ownerInvest': ({ fin }) => {
    data(fin.companies.foundCompany(GUILD, U1, 'Pixel Farm', 'farm', START));
    return (k) => fin.companies.ownerInvest(GUILD, U1, 100_000, k);
  },
  'companies.ownerWithdraw': ({ fin }) => {
    data(fin.companies.foundCompany(GUILD, U1, 'Pixel Farm', 'farm', START));
    data(fin.companies.ownerInvest(GUILD, U1, 100_000));
    return (k) => fin.companies.ownerWithdraw(GUILD, U1, 10_000, k);
  },
  'companies.stakeInvest': ({ fin }) => {
    data(fin.companies.foundCompany(GUILD, U2, 'Pixel Farm', 'farm', START));
    return (k) => fin.companies.stakeInvest(GUILD, U1, U2, 1_500, START, k);
  },
};

/** `service.method` for every finance service method with an `idempotencyKey` parameter. */
function keyedMethods(): string[] {
  const services: Record<string, string> = {
    'teiai-service.ts': 'teiai',
    'stocks-service.ts': 'stocks',
    'kyosai-service.ts': 'kyosai',
    'player-market-service.ts': 'playerMarket',
    'p2p-loan-service.ts': 'loans',
    'companies-service.ts': 'companies',
  };
  const found: string[] = [];
  for (const file of readdirSync(HERE)) {
    const service = services[file];
    if (!service) continue;
    const source = readFileSync(join(HERE, file), 'utf8');
    // a class member starts at two spaces of indent; its signature runs to the body's `{`
    const members = source.split(/\n(?= {2}(?:async )?[a-z]\w*\()/);
    for (const member of members.slice(1)) {
      const name = /^ {2}(?:async )?(\w+)\(/.exec(member)?.[1];
      // the signature ends at the line closing its parameters (`  ): …`) or opening the body
      const lines = member.split('\n');
      const end = lines.findIndex(
        (line, i) => /^ {2}\}?\)/.test(line) || (i === 0 && /\).*\{$/.test(line)),
      );
      const signature = lines.slice(0, end + 1).join('\n');
      if (name && /idempotencyKey\?: string/.test(signature)) found.push(`${service}.${name}`);
    }
  }
  return found.sort();
}

describe('R-1: finance writes never mutate on a replayed ledger key', () => {
  it('the sweep covers every finance write that takes an idempotency key', () => {
    expect(keyedMethods()).toEqual(Object.keys(CASES).sort());
  });

  for (const [name, setup] of Object.entries(CASES)) {
    it(`R-1: ${name} with a spent key is refused and changes nothing`, () => {
      const e = env();
      const call = setup(e);
      const first = call(KEY);
      expect(first.ok, JSON.stringify(first)).toBe(true);
      const before = snapshot(e.store);

      let second: ServiceResult<unknown> | AppError;
      try {
        second = call(KEY);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        second = error;
      }
      if (second instanceof AppError) expect(second.code).toBe('conflict');
      else expect(second.ok, `${name} ran again: ${JSON.stringify(second)}`).toBe(false);
      expect(snapshot(e.store)).toBe(before);
    });
  }

  it('R-1: every leg of a short option buyback carries a scoped key', () => {
    const e = env();
    const opt = data(
      e.fin.stocks.writeOption({
        guildId: GUILD,
        userId: U1,
        kind: 'call',
        symbol: 'gold',
        unitsMilli: 5_000,
        hours: 6,
        nowMs: START,
      }),
    );
    data(e.fin.stocks.buybackOption(GUILD, U1, opt.id, START, KEY));
    const rows = e.store.db
      .prepare(
        "SELECT reason, idempotency_key AS k FROM ledger WHERE user_id = ? AND reason IN ('margin_close', 'option_buyback') ORDER BY id",
      )
      .all(U1);
    expect(rows).toEqual([
      { reason: 'margin_close', k: `${KEY}:margin` },
      { reason: 'option_buyback', k: KEY },
    ]);
  });
});
