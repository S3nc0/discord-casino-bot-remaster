// A whole casino economy in memory (the real services, a scripted clock and RNG) and the
// checks every property runs after every step. Nothing here talks HTTP: commands go straight to
// the services, the way the chat bot and the socket handlers call them.
import {
  LEDGER_REASONS,
  LEDGER_REASON_FLOW,
  createSeededRng,
  isDeltaAllowed,
  manualClock,
  type DomainEvent,
  type LedgerReason,
} from '../../packages/shared/src/index.ts';
import type { EconomyService } from '../../apps/server/src/economy/economy-service.ts';
import { manualScheduler } from '../../apps/server/src/games/casino/test-kit.ts';
import { AppError } from '../../apps/server/src/runtime/errors.ts';
import { createLogger } from '../../apps/server/src/runtime/logger.ts';
import { createServer, type CasinoServices } from '../../apps/server/src/runtime/server.ts';
import {
  START_MS,
  makeProxyKeys,
  memoryStore,
  testConfig,
} from '../../apps/server/src/runtime/test-kit.ts';

export const GUILDS = ['234567890123456789', '234567890123456780'] as const;
export const USERS = ['123456789012345601', '123456789012345602', '123456789012345603'] as const;
export const INSTANCE = 'i-invariants-gc-1';
/** Game-day offset of the server config (UTC+9). */
export const OFFSET_HOURS = 9;
export const DAY_MS = 86_400_000;

export interface LedgerRow {
  id: number;
  guild_id: string;
  user_id: string;
  delta: number;
  balance_after: number;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
  idempotency_key: string | null;
  created_at: number;
}

export interface World {
  /** Relics Teiai may list per guild per UTC day in this world (0 = off). */
  relicAuctionPerDay: number;
  server: CasinoServices;
  economy: EconomyService;
  clock: ReturnType<typeof manualClock>;
  timers: ReturnType<typeof manualScheduler>;
  /** Finished games per guild:user, counted from `GameSettled` (the arena excepted). */
  gamesPlayed: Map<string, number>;
  /** Highest ledger id already examined. */
  seenLedgerId: number;
  /** Ledger rows added by the last step. */
  newRows: LedgerRow[];
  /** Successful transfers: guild, sender, game day, principal. */
  transfers: { guildId: string; sender: string; day: number; amount: number }[];
  /** Idempotency keys of game intents that went through: account + key → what they asked for. */
  intentKeys: Map<string, string>;
  /** Idempotency keys of transfers that went through: key → "guild:sender:receiver:amount". */
  transferKeys: Map<string, string>;
  close(): Promise<void>;
}

/**
 * Games each user has already played when a sequence starts (guild-major order). The 3-game
 * minimum for transfers needs players on both sides of it.
 */
export function warmUp(w: World, played: readonly number[]): void {
  let n = 0;
  for (const [gi, guildId] of GUILDS.entries()) {
    for (const [ui, userId] of USERS.entries()) {
      for (let i = 0; i < (played[gi * USERS.length + ui] ?? 0); i++) {
        w.timers.advance(10_000); // past the cooldown between two rounds of a player
        w.server.casino.slots.play(
          { guildId, userId, source: 'chat' },
          { stake: 10, idempotencyKey: `warm-${++n}`.padEnd(16, '_') },
        );
      }
    }
  }
  checkInvariantsAfterWarmUp(w);
}

function checkInvariantsAfterWarmUp(w: World): void {
  checkInvariants(w);
}

export interface WorldOptions {
  /** Teiai's daily relic auction; off unless a test turns it on. */
  relicAuctionPerDay?: number;
}

export function createWorld(seed: number, options: WorldOptions = {}): World {
  const keys = makeProxyKeys();
  const clock = manualClock(START_MS);
  const timers = manualScheduler(clock);
  const server = createServer({
    config: testConfig(keys.publicKeyHex, {
      ALLOWED_GUILD_IDS: GUILDS.join(','),
      UTC_OFFSET_HOURS: String(OFFSET_HOURS),
    }),
    clock,
    logger: createLogger({ level: 'silent' }),
    store: memoryStore(),
    rng: createSeededRng(seed),
    casinoTimers: timers.scheduler,
    relicAuctionPerDay: options.relicAuctionPerDay ?? 0,
  });
  const gamesPlayed = new Map<string, number>();
  server.bus.onAnyDomain((event: DomainEvent) => {
    if (event.type !== 'GameSettled' || event.game === 'arena') return;
    const key = `${event.guildId}:${event.userId}`;
    gamesPlayed.set(key, (gamesPlayed.get(key) ?? 0) + 1);
  });
  return {
    relicAuctionPerDay: options.relicAuctionPerDay ?? 0,
    server,
    economy: server.economy,
    clock,
    timers,
    gamesPlayed,
    seenLedgerId: 0,
    newRows: [],
    transfers: [],
    transferKeys: new Map(),
    intentKeys: new Map(),
    close: () => server.close(),
  };
}

const rows = <T>(w: World, sql: string, ...params: unknown[]): T[] =>
  w.server.store.stmt(sql).all(...params) as T[];

/** The game day (UTC+9) a timestamp falls in. */
export const dayOf = (ms: number): number => Math.floor((ms + OFFSET_HOURS * 3_600_000) / DAY_MS);

/** Run a service call; a domain refusal (`AppError`) is a normal outcome, anything else is a bug. */
export function attempt<T>(fn: () => T): { ok: true; value: T } | { ok: false; code: string } {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, code: error.code };
    throw error;
  }
}

const KNOWN_REASONS = new Set<string>(LEDGER_REASONS);

/**
 * What must hold after every step, whatever was done. Throws a plain Error with the
 * offending account or row, so fast-check shrinks to the shortest command list that breaks it.
 */
export function checkInvariants(w: World): void {
  const { store } = w.server;

  // Balances: never below zero, and the ledger explains every Pelica of every account.
  const accounts = rows<{ guild_id: string; user_id: string; balance: number }>(
    w,
    'SELECT guild_id, user_id, balance FROM balances',
  );
  for (const a of accounts) {
    if (a.balance < 0)
      throw new Error(`negative balance ${a.balance} for ${a.guild_id}/${a.user_id}`);
    const sum = (
      store
        .stmt('SELECT COALESCE(SUM(delta), 0) AS s FROM ledger WHERE guild_id = ? AND user_id = ?')
        .get(a.guild_id, a.user_id) as { s: number }
    ).s;
    if (sum !== a.balance) {
      throw new Error(`ledger sum ${sum} != balance ${a.balance} for ${a.guild_id}/${a.user_id}`);
    }
  }
  // Every account is also walked row by row: the running balance never dips and matches
  // `balance_after` at each step.
  const running = new Map<string, number>();
  const all = rows<LedgerRow>(w, 'SELECT * FROM ledger ORDER BY id');
  for (const row of all) {
    const key = `${row.guild_id}/${row.user_id}`;
    const next = (running.get(key) ?? 0) + row.delta;
    if (next < 0) throw new Error(`ledger row ${row.id} takes ${key} below zero`);
    if (next !== row.balance_after) {
      throw new Error(
        `ledger row ${row.id}: balance_after ${row.balance_after} != running ${next}`,
      );
    }
    running.set(key, next);
    if (!KNOWN_REASONS.has(row.reason))
      throw new Error(`row ${row.id}: unknown reason ${row.reason}`);
    const reason = row.reason as LedgerReason;
    if (!isDeltaAllowed(reason, row.delta)) {
      throw new Error(`row ${row.id}: ${reason} may not move ${row.delta}`);
    }
  }

  // Debt lives in its own tables and is never negative.
  for (const guildId of GUILDS) {
    for (const userId of USERS) {
      const debt = w.server.finance.teiai.getDebt(guildId, userId);
      if (debt < 0) throw new Error(`negative debt ${debt} for ${guildId}/${userId}`);
    }
  }

  // Supply: only faucet and sink rows change the total; transfer rows net to zero per transfer.
  const fresh = all.filter((r) => r.id > w.seenLedgerId);
  w.newRows = fresh;
  const created = fresh
    .filter((r) => LEDGER_REASON_FLOW[r.reason as LedgerReason] !== 'transfer')
    .reduce((s, r) => s + r.delta, 0);
  const moved = fresh
    .filter((r) => LEDGER_REASON_FLOW[r.reason as LedgerReason] === 'transfer')
    .reduce((s, r) => s + r.delta, 0);
  const totalNow = accounts.reduce((s, a) => s + a.balance, 0);
  const totalBefore = all.filter((r) => r.id <= w.seenLedgerId).reduce((s, r) => s + r.delta, 0);
  if (totalNow - totalBefore !== created + moved) {
    throw new Error('total balances changed by something that is not a ledger row');
  }
  if (moved !== 0) throw new Error(`transfer rows of this step sum to ${moved}, not 0`);
  const groups = new Map<string, number>();
  for (const r of all) {
    if (LEDGER_REASON_FLOW[r.reason as LedgerReason] !== 'transfer') continue;
    const group = `${r.guild_id}/${r.ref_type}/${r.ref_id}`;
    groups.set(group, (groups.get(group) ?? 0) + r.delta);
  }
  for (const [group, sum] of groups) {
    if (sum !== 0) throw new Error(`transfer ${group} nets ${sum}`);
  }
  for (const r of fresh) {
    const flow = LEDGER_REASON_FLOW[r.reason as LedgerReason];
    if (flow === 'faucet' && r.delta <= 0) throw new Error(`faucet row ${r.id} is not a credit`);
    if (flow === 'sink' && r.delta >= 0) throw new Error(`sink row ${r.id} is not a debit`);
  }
  w.seenLedgerId = all.at(-1)?.id ?? w.seenLedgerId;

  // Transfers: the principal sent per game day stays under the cap; every fee is the 10 % ceiling.
  const sent = new Map<string, number>();
  for (const r of all) {
    if (r.reason !== 'transfer_out') continue;
    const k = `${r.guild_id}/${r.user_id}/${dayOf(r.created_at)}`;
    const total = (sent.get(k) ?? 0) - r.delta;
    sent.set(k, total);
    if (total > 20_000) throw new Error(`${k} sent ${total} in a day, over the 20,000 cap`);
  }
  const fees = new Map<string, number>();
  const principals = new Map<string, number>();
  for (const r of all) {
    if (r.ref_type !== 'transfer' || r.ref_id === null) continue;
    const k = `${r.guild_id}/${r.ref_id}`;
    if (r.reason === 'transfer_fee') fees.set(k, -r.delta);
    if (r.reason === 'transfer_out') principals.set(k, -r.delta);
  }
  for (const [k, principal] of principals) {
    const fee = fees.get(k);
    if (fee === undefined) throw new Error(`transfer ${k} has no fee row`);
    if (fee !== Math.ceil(principal / 10)) {
      throw new Error(`transfer ${k}: fee ${fee} is not 10% (ceiling) of ${principal}`);
    }
  }

  checkTeiaiRelicAuction(w, w.relicAuctionPerDay);
}

interface TeiaiListingRow {
  id: number;
  guild_id: string;
  seller_id: string;
  ref: string;
  qty: number;
  mode: string;
  price: number;
  bid: number;
  bidder_id: string | null;
  buyer_id: string | null;
  sold_price: number;
  fee: number;
  status: string;
  created_at: number;
  end_at: number;
}

/** Teiai's seller id on the player market (`TEIAI_SELLER_ID`). */
const TEIAI = '0';

/** Total relics (any id starting `relic_`) in every inventory. */
export function relicCount(w: World): number {
  return (
    w.server.store
      .stmt(
        "SELECT COALESCE(SUM(qty), 0) AS n FROM inventory WHERE item_id LIKE 'relic\\_%' ESCAPE '\\'",
      )
      .get() as { n: number }
  ).n;
}

/**
 * Teiai's daily relic auction (docs/spec/player-market.md §9). After every step:
 * - at most `perDay` Teiai listings per guild per UTC day, each a 24 h auction of one relic;
 * - a Teiai listing never produces a seller credit, a fee or a transfer row;
 * - the Pelica a Teiai listing holds nets to the current bid while it is active, to the winning
 *   bid once sold (a sink that is never released), and to 0 when it expired unsold;
 * - the relics in inventories are exactly the Teiai listings sold (nothing else makes relics here).
 */
export function checkTeiaiRelicAuction(w: World, perDay: number): void {
  const listings = rows<TeiaiListingRow>(
    w,
    'SELECT * FROM marketplace_listings WHERE seller_id = ? ORDER BY id',
    TEIAI,
  );
  const perGuildDay = new Map<string, number>();
  let sold = 0;
  for (const l of listings) {
    const day = `${l.guild_id}/${Math.floor(l.created_at / DAY_MS)}`;
    const n = (perGuildDay.get(day) ?? 0) + 1;
    perGuildDay.set(day, n);
    if (n > perDay) throw new Error(`${day} has ${n} Teiai listings, over ${perDay} a day`);
    if (
      l.mode !== 'auction' ||
      l.qty !== 1 ||
      !l.ref.startsWith('relic_') ||
      /_s\d+$/.test(l.ref)
    ) {
      throw new Error(`Teiai listing ${l.id} is not one unstarred relic auction`);
    }
    if (l.end_at - l.created_at < 24 * 3_600_000) throw new Error(`Teiai listing ${l.id} is short`);
    const own = rows<LedgerRow>(
      w,
      "SELECT * FROM ledger WHERE ref_type LIKE 'marketplace%' AND ref_id = ? AND guild_id = ?",
      String(l.id),
      l.guild_id,
    );
    for (const r of own) {
      if (!['marketplace_hold', 'marketplace_release'].includes(r.reason)) {
        throw new Error(`Teiai listing ${l.id} has a ${r.reason} row (${r.delta})`);
      }
    }
    const held = own.reduce((s, r) => s - r.delta, 0);
    if (l.status === 'active' && held !== l.bid) {
      throw new Error(`Teiai listing ${l.id} holds ${held}, bid is ${l.bid}`);
    }
    if (l.status === 'sold') {
      sold += 1;
      if (held !== l.sold_price || l.sold_price !== l.bid || l.sold_price <= 0) {
        throw new Error(`Teiai listing ${l.id} sold for ${l.sold_price} but holds ${held}`);
      }
      if (l.fee !== 0 || l.buyer_id === null || l.buyer_id !== l.bidder_id) {
        throw new Error(`Teiai listing ${l.id} sold with fee ${l.fee} to ${l.buyer_id}`);
      }
    }
    if (l.status === 'expired' && (held !== 0 || l.bid !== 0)) {
      throw new Error(`Teiai listing ${l.id} expired but holds ${held}`);
    }
    if (l.status === 'cancelled') throw new Error(`Teiai listing ${l.id} was cancelled`);
  }
  const relics = relicCount(w);
  if (relics !== sold) throw new Error(`${relics} relics in inventories, ${sold} Teiai sales`);
}
