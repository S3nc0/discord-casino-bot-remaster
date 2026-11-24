// Random intents for the economy: what players and the chat bot can do, as plain data that
// fast-check can generate and shrink, plus the interpreter that runs one against the services.
import fc from 'fast-check';
import { minNextBid } from '../../packages/domain/src/finance/index.ts';
import { GUILDS, INSTANCE, USERS, attempt, dayOf, relicCount, type World } from './world.ts';

export type Cmd =
  | { t: 'daily'; g: number; u: number }
  | { t: 'slots'; g: number; u: number; stake: number; k: number }
  | { t: 'pachinko'; g: number; u: number; stake: number; sets: number; k: number }
  | { t: 'chinchiro'; g: number; u: number; stake: number; k: number }
  | { t: 'chinchiroRoll'; g: number; u: number; k: number }
  | { t: 'roulette'; g: number; u: number; stake: number; kind: string; k: number }
  | { t: 'bjBet'; g: number; u: number; stake: number; k: number }
  | { t: 'bjDeal'; g: number; u: number }
  | { t: 'bjAct'; g: number; u: number; act: 'hit' | 'stand' | 'double' }
  | { t: 'bjSolo'; g: number; u: number; stake: number; k: number }
  | {
      t: 'transfer';
      g: number;
      from: number;
      to: number;
      amount: number;
      k: number;
      /** Aim at the daily cap instead: the amount that brings today's total to 20,000 + cap. */
      cap?: -1 | 0 | 1;
    }
  | { t: 'grant'; g: number; u: number; amount: number }
  | { t: 'revoke'; g: number; u: number; amount: number }
  | { t: 'debt'; g: number; u: number; amount: number }
  | { t: 'advance'; ms: number }
  /** Teiai's daily job: lists today's relic once, a second call must list nothing. */
  | { t: 'teiaiRelic'; g: number }
  /** A player bids the minimum next bid (plus `extra`) on the guild's Teiai relic. */
  | { t: 'relicBid'; g: number; u: number; extra: number }
  /** Run the clock to the Teiai relic's end and settle the market. */
  | { t: 'relicSettle'; g: number }
  | { t: 'replay' };

const g = fc.nat(GUILDS.length - 1);
const u = fc.nat(USERS.length - 1);
const k = fc.nat(2); // a tiny key pool, so keys collide and repeat
const stake = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 10, max: 400 }) },
  { weight: 1, arbitrary: fc.integer({ min: 1, max: 9 }) },
  { weight: 1, arbitrary: fc.integer({ min: 400, max: 6000 }) },
);
const amount = fc.oneof(
  { weight: 5, arbitrary: fc.integer({ min: 1, max: 3000 }) },
  { weight: 2, arbitrary: fc.integer({ min: 3000, max: 25_000 }) },
  { weight: 1, arbitrary: fc.integer({ min: -5, max: 0 }) },
);

export const command: fc.Arbitrary<Cmd> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ t: fc.constant('daily' as const), g, u }) },
  { weight: 4, arbitrary: fc.record({ t: fc.constant('slots' as const), g, u, stake, k }) },
  {
    weight: 2,
    arbitrary: fc.record({
      t: fc.constant('pachinko' as const),
      g,
      u,
      stake,
      sets: fc.integer({ min: 1, max: 3 }),
      k,
    }),
  },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('chinchiro' as const), g, u, stake, k }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('chinchiroRoll' as const), g, u, k }) },
  {
    weight: 3,
    arbitrary: fc.record({
      t: fc.constant('roulette' as const),
      g,
      u,
      stake,
      kind: fc.constantFrom('red', 'black', 'even', 'odd', 'low', 'high'),
      k,
    }),
  },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('bjBet' as const), g, u, stake, k }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('bjDeal' as const), g, u }) },
  {
    weight: 4,
    arbitrary: fc.record({
      t: fc.constant('bjAct' as const),
      g,
      u,
      act: fc.constantFrom('hit' as const, 'stand' as const, 'double' as const),
    }),
  },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('bjSolo' as const), g, u, stake, k }) },
  {
    weight: 8,
    arbitrary: fc.record({
      t: fc.constant('transfer' as const),
      g,
      from: u,
      to: u,
      amount,
      k,
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      t: fc.constant('transfer' as const),
      g,
      from: u,
      to: u,
      amount: fc.constant(1),
      k,
      cap: fc.constantFrom(-1 as const, 0 as const, 1 as const),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      t: fc.constant('grant' as const),
      g,
      u,
      amount: fc.integer({ min: 20_000, max: 60_000 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      t: fc.constant('grant' as const),
      g,
      u,
      amount: fc.integer({ min: 1, max: 30_000 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      t: fc.constant('revoke' as const),
      g,
      u,
      amount: fc.integer({ min: 1, max: 30_000 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      t: fc.constant('debt' as const),
      g,
      u,
      amount: fc.integer({ min: 0, max: 8000 }),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      t: fc.constant('advance' as const),
      ms: fc.oneof(
        fc.integer({ min: 1_000, max: 60_000 }),
        fc.integer({ min: 60_000, max: 12 * 3_600_000 }),
      ),
    }),
  },
  { weight: 3, arbitrary: fc.constant({ t: 'replay' as const }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('teiaiRelic' as const), g }) },
  {
    weight: 4,
    arbitrary: fc.record({
      t: fc.constant('relicBid' as const),
      g,
      u,
      extra: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 5000 })),
    }),
  },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('relicSettle' as const), g }) },
);

export const commands = (max = 60): fc.Arbitrary<Cmd[]> =>
  fc.array(command, { minLength: 1, maxLength: max, size: 'max' });

/** What a transfer must answer, from the rules alone (the legacy order of checks). */
export function expectedTransfer(input: {
  sender: string;
  receiver: string;
  amount: number;
  games: number;
  sentToday: number;
  debt: number;
  balance: number;
}): { ok: true; fee: number } | { ok: false; code: string } {
  if (input.sender === input.receiver) return { ok: false, code: 'transfer_self' };
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    return { ok: false, code: 'amount_must_be_positive' };
  }
  if (input.games < 3) return { ok: false, code: 'transfer_min_games' };
  if (input.sentToday + input.amount > 20_000) return { ok: false, code: 'transfer_daily_limit' };
  if (input.debt > 0) return { ok: false, code: 'debt_blocks' };
  const fee = Math.ceil(input.amount / 10);
  if (input.balance < input.amount + fee)
    return { ok: false, code: 'transfer_insufficient_balance' };
  return { ok: true, fee };
}

export interface Replayable {
  describe: string;
  run(): { response: unknown; replayed: boolean };
}

export interface StepResult {
  /** A keyed command that went through, for the next `replay`. */
  keyed?: Replayable;
}

/** A key per (command, guild, player, slot): a client never reuses another player's key. */
const key = (c: Cmd): string =>
  `${c.t}-${'g' in c ? c.g : 0}-${'u' in c ? c.u : 'from' in c ? c.from : 0}-${'k' in c ? c.k : 0}`.padEnd(
    16,
    '_',
  );

/**
 * Run one command. Rules that only the command knows (the transfer oracle, a replay changing
 * nothing) are asserted here; the ledger-wide invariants are `checkInvariants`.
 */
export function step(w: World, c: Cmd, last: Replayable | undefined): StepResult {
  const s = w.server;
  const guild = (n: number): string => GUILDS[n] as string;
  const user = (n: number): string => USERS[n] as string;
  const chat = (gi: number, ui: number) => ({
    guildId: guild(gi),
    userId: user(ui),
    source: 'chat' as const,
  });
  const room = (gi: number, ui: number) => ({
    guildId: guild(gi),
    userId: user(ui),
    source: 'activity' as const,
    instanceId: `${INSTANCE}-${gi}`,
  });
  const keyed = (
    describe: string,
    who: { g: number; u: number },
    idempotencyKey: string,
    run: () => { response: unknown; replayed: boolean },
  ): StepResult => {
    const first = attempt(run);
    if (!first.ok) return {};
    // One key is one request: the same key with another body must have been refused, and the
    // same body must come back as a replay.
    const id = `${guild(who.g)}:${user(who.u)}:${idempotencyKey}`;
    const known = w.intentKeys.get(id);
    if (known === undefined) {
      if (first.value.replayed) throw new Error(`"${describe}" was replayed on a key never used`);
      w.intentKeys.set(id, describe);
    } else if (known !== describe) {
      throw new Error(
        `key ${idempotencyKey} first asked "${known}", then "${describe}" went through`,
      );
    } else if (!first.value.replayed) {
      throw new Error(`"${describe}" ran twice on key ${idempotencyKey}`);
    }
    return { keyed: { describe, run } };
  };

  switch (c.t) {
    case 'daily':
      attempt(() => s.games.progression.claimDaily(guild(c.g), user(c.u)));
      return {};
    case 'slots':
      return keyed(`slots ${c.stake}`, c, key(c), () =>
        s.casino.slots.play(chat(c.g, c.u), { stake: c.stake, idempotencyKey: key(c) }),
      );
    case 'pachinko':
      return keyed(`pachinko ${c.stake}x${c.sets}`, c, key(c), () =>
        s.casino.pachinko.play(chat(c.g, c.u), {
          stake: c.stake,
          sets: c.sets,
          idempotencyKey: key(c),
        }),
      );
    case 'chinchiro':
      return keyed(`chinchiro ${c.stake}`, c, key(c), () =>
        s.casino.chinchiro.start(chat(c.g, c.u), { stake: c.stake, idempotencyKey: key(c) }),
      );
    case 'chinchiroRoll': {
      const open = s.casino.chinchiro.current(chat(c.g, c.u));
      if (open) attempt(() => s.casino.chinchiro.roll(chat(c.g, c.u), { roundId: open.roundId }));
      return {};
    }
    case 'roulette':
      return keyed(`roulette ${c.kind} ${c.stake}`, c, key(c), () =>
        s.casino.roulette.placeBet(room(c.g, c.u), {
          stake: c.stake,
          kind: c.kind,
          idempotencyKey: key(c),
        }),
      );
    case 'bjBet':
      return keyed(`blackjack seat ${c.stake}`, c, key(c), () =>
        s.casino.blackjack.bet(room(c.g, c.u), { stake: c.stake, idempotencyKey: key(c) }),
      );
    case 'bjDeal': {
      const open = s.casino.blackjack.current(room(c.g, c.u));
      if (open) attempt(() => s.casino.blackjack.deal(room(c.g, c.u), { roundId: open.roundId }));
      return {};
    }
    case 'bjAct': {
      const open = s.casino.blackjack.current(room(c.g, c.u));
      if (open) {
        attempt(() => s.casino.blackjack[c.act](room(c.g, c.u), { roundId: open.roundId }));
      }
      return {};
    }
    case 'bjSolo':
      return keyed(`blackjack solo ${c.stake}`, c, key(c), () =>
        s.casino.blackjack.startSolo(chat(c.g, c.u), { stake: c.stake, idempotencyKey: key(c) }),
      );
    case 'grant':
      attempt(() =>
        s.economy.credit({
          guildId: guild(c.g),
          userId: user(c.u),
          amount: c.amount,
          reason: 'admin_grant',
        }),
      );
      return {};
    case 'revoke':
      attempt(() =>
        s.economy.debit({
          guildId: guild(c.g),
          userId: user(c.u),
          amount: c.amount,
          reason: 'admin_revoke',
        }),
      );
      return {};
    case 'debt':
      s.finance.teiai.adminSetDebt(guild(c.g), user(c.u), c.amount);
      return {};
    case 'advance':
      w.timers.advance(c.ms);
      return {};
    case 'teiaiRelic': {
      const gId = guild(c.g);
      const market = s.finance.playerMarket;
      const before = teiaiListings(w, gId).length;
      const first = market.teiaiDaily(gId);
      const again = market.teiaiDaily(gId);
      if (again.length !== 0) throw new Error(`a second daily tick listed ${again.length} more`);
      if (before + first.length !== teiaiListings(w, gId).length) {
        throw new Error('the daily job returned ids that do not match the new listings');
      }
      return {};
    }
    case 'relicBid': {
      const gId = guild(c.g);
      const bidder = user(c.u);
      const listing = teiaiListings(w, gId).find((l) => l.status === 'active');
      if (!listing) return {};
      s.economy.ensureMember(gId, bidder);
      const amount = minNextBid(listing.price, listing.bid) + c.extra;
      const balance = s.economy.getBalance(gId, bidder);
      const res = s.finance.playerMarket.placeBid(gId, bidder, listing.id, amount);
      if (!res.ok) {
        // Teiai is not a player: the pair limit and the self-bid rule never apply.
        const allowed = [
          'insufficient_funds',
          'marketplace_debtor_blocked',
          'marketplace_listing_expired',
        ];
        if (!allowed.includes(res.reason)) throw new Error(`Teiai bid refused with ${res.reason}`);
        if (res.reason === 'insufficient_funds') {
          const own = listing.bidder_id === bidder ? listing.bid : 0;
          if (balance + own >= amount) throw new Error('refused for funds though they were enough');
        }
      }
      return {};
    }
    case 'relicSettle': {
      const gId = guild(c.g);
      const market = s.finance.playerMarket;
      const listing = teiaiListings(w, gId).find((l) => l.status === 'active');
      if (!listing) return {};
      w.timers.advance(Math.max(0, listing.end_at - w.clock.now()));
      const relicsBefore = relicCount(w);
      const winnerBefore =
        listing.bidder_id === null ? 0 : inventoryQty(w, gId, listing.bidder_id, listing.ref);
      const heldBefore = listing.bid;
      const entries = market.settleExpired(gId).filter((e) => e.listing.id === listing.id);
      const done = entries[0];
      if (!done) throw new Error('the Teiai listing was not settled at its end');
      const after = market.getListing(listing.id);
      if (heldBefore > 0 && listing.bidder_id !== null) {
        if (done.outcome !== 'sold' || after?.status !== 'sold')
          throw new Error('bid but not sold');
        if (inventoryQty(w, gId, listing.bidder_id, listing.ref) !== winnerBefore + 1) {
          throw new Error('the winner did not get the relic');
        }
        if (relicCount(w) !== relicsBefore + 1) throw new Error('a sale must deliver one relic');
      } else {
        if (done.outcome !== 'expired' || after?.status !== 'expired')
          throw new Error('not expired');
        if (relicCount(w) !== relicsBefore) throw new Error('an unsold relic was delivered');
      }
      return {};
    }
    case 'replay': {
      if (!last) return {};
      const before = JSON.stringify(
        w.server.store.stmt('SELECT guild_id, user_id, balance FROM balances ORDER BY 1, 2').all(),
      );
      const rowsBefore = (
        w.server.store.stmt('SELECT COUNT(*) AS n FROM ledger').get() as { n: number }
      ).n;
      const replay = attempt(last.run);
      const after = JSON.stringify(
        w.server.store.stmt('SELECT guild_id, user_id, balance FROM balances ORDER BY 1, 2').all(),
      );
      const rowsAfter = (
        w.server.store.stmt('SELECT COUNT(*) AS n FROM ledger').get() as { n: number }
      ).n;
      if (!replay.ok) throw new Error(`replaying "${last.describe}" failed with ${replay.code}`);
      if (!replay.value.replayed)
        throw new Error(`replaying "${last.describe}" was not flagged replayed`);
      if (before !== after || rowsBefore !== rowsAfter) {
        throw new Error(`replaying "${last.describe}" changed balances or the ledger`);
      }
      return {};
    }
    case 'transfer': {
      const gId = guild(c.g);
      const sender = user(c.from);
      const receiver = user(c.to);
      const idem = key(c);
      // The oracle's inputs, read before the call.
      const sentToday = w.transfers
        .filter((t) => t.guildId === gId && t.sender === sender && t.day === dayOf(w.clock.now()))
        .reduce((sum, t) => sum + t.amount, 0);
      const amount = c.cap === undefined ? c.amount : Math.max(1, 20_000 - sentToday + c.cap);
      const body = `${gId}:${sender}:${receiver}:${amount}`;
      const priorBody = w.transferKeys.get(`${gId}:${sender}:${idem}`);
      s.economy.ensureMember(gId, sender);
      const input = {
        sender,
        receiver,
        amount,
        games: w.gamesPlayed.get(`${gId}:${sender}`) ?? 0,
        sentToday,
        debt: s.finance.teiai.getDebt(gId, sender),
        balance: s.economy.getBalance(gId, sender),
      };
      const ledgerBefore = (s.store.stmt('SELECT COUNT(*) AS n FROM ledger').get() as { n: number })
        .n;
      const result = attempt(() =>
        s.games.progression.transfer({
          guildId: gId,
          senderId: sender,
          receiverId: receiver,
          amount,
          idempotencyKey: idem,
        }),
      );
      const rowsAdded =
        (s.store.stmt('SELECT COUNT(*) AS n FROM ledger').get() as { n: number }).n - ledgerBefore;
      if (priorBody !== undefined) {
        // The key was used by a transfer that went through. The same request is a replay and
        // changes nothing; a different one is refused. Neither may post a second transfer.
        if (rowsAdded !== 0 && !(priorBody !== body && !result.ok)) {
          // a refused different body may still have created the receiver's account (a grant row)
          const onlyGrants = w.newRows.length === 0;
          if (!onlyGrants && priorBody === body) {
            throw new Error(`replayed transfer ${idem} posted ${rowsAdded} ledger rows`);
          }
        }
        if (priorBody === body && !(result.ok && 'ok' in result.value && result.value.ok)) {
          throw new Error(`replayed transfer ${idem} answered ${JSON.stringify(result)}`);
        }
        return {};
      }
      const expected = expectedTransfer(input);
      if (!result.ok) {
        throw new Error(`transfer threw ${result.code}; expected ${JSON.stringify(expected)}`);
      }
      const outcome = result.value;
      if (expected.ok) {
        if (!outcome.ok)
          throw new Error(`transfer refused (${outcome.error.code}); expected success`);
        if (outcome.fee !== expected.fee)
          throw new Error(`fee ${outcome.fee}, expected ${expected.fee}`);
        w.transfers.push({ guildId: gId, sender, day: dayOf(w.clock.now()), amount });
        w.transferKeys.set(`${gId}:${sender}:${idem}`, body);
      } else {
        if (outcome.ok) throw new Error(`transfer went through; expected ${expected.code}`);
        if (outcome.error.code !== expected.code) {
          throw new Error(`transfer refused with ${outcome.error.code}; expected ${expected.code}`);
        }
      }
      return {};
    }
  }
}

interface TeiaiListing {
  id: number;
  ref: string;
  price: number;
  bid: number;
  bidder_id: string | null;
  status: string;
  end_at: number;
}

/** Teiai's relic listings in a guild, oldest first. */
function teiaiListings(w: World, guildId: string): TeiaiListing[] {
  return w.server.store
    .stmt("SELECT * FROM marketplace_listings WHERE guild_id = ? AND seller_id = '0' ORDER BY id")
    .all(guildId) as TeiaiListing[];
}

function inventoryQty(w: World, guildId: string, userId: string, itemId: string): number {
  const row = w.server.store
    .stmt('SELECT qty FROM inventory WHERE guild_id = ? AND user_id = ? AND item_id = ?')
    .get(guildId, userId, itemId) as { qty: number } | undefined;
  return row?.qty ?? 0;
}
