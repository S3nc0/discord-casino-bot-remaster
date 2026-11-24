// The per-round money check of the stream panel (docs/spec/stream.md §11), run after every step
// of the invariant suites. Written from the spec's formula, not from the domain package, so a
// payout bug in either the service or `settle()` shows up as a difference. Types only from
// `world.ts`, so the world can import this file without an import cycle.
import type { LedgerRow, World } from './world.ts';

interface AuditRow {
  round_id: number;
  outcome: string;
  refunded: number;
  rake: number;
  win_total: number;
  lose_total: number;
  bettors: number;
}

/**
 * Per round (spec §11): the escrow rows equal the stakes; an undecided round has paid nothing;
 * a decided round has one audit row and paid each bettor at most once; refunded ⇒ every bettor
 * got exactly the stake back; otherwise each winner gets exactly `stake + floor(pot × stake / W)`
 * (so ≥ stake), losers get nothing, Σ out ≤ Σ in and the audit's rake = Σ in − Σ out. Plus: one
 * live panel per streamer, one active round per stream, and every tip's fee is the 10 % ceiling.
 */
export function checkStreams(w: World): void {
  const { store } = w.server;
  const rounds = store.stmt('SELECT id, status FROM stream_rounds ORDER BY id').all() as {
    id: number;
    status: string;
  }[];
  for (const round of rounds) {
    const bets = store
      .stmt('SELECT user_id, side, amount FROM stream_bets WHERE round_id = ?')
      .all(round.id) as { user_id: string; side: string; amount: number }[];
    const rows = store
      .stmt(`SELECT * FROM ledger WHERE ref_type = 'stream_round' AND ref_id = ?`)
      .all(String(round.id)) as LedgerRow[];
    const stakeOf = new Map(bets.map((b) => [b.user_id, b]));
    const escrow = new Map<string, number>();
    const paid = new Map<string, number[]>();
    for (const r of rows) {
      if (r.reason === 'stream_bet') escrow.set(r.user_id, (escrow.get(r.user_id) ?? 0) - r.delta);
      if (r.reason === 'stream_payout' || r.reason === 'stream_refund') {
        paid.set(r.user_id, [...(paid.get(r.user_id) ?? []), r.delta]);
      }
    }
    for (const b of bets) {
      if (escrow.get(b.user_id) !== b.amount) {
        throw new Error(
          `round ${round.id}: ${b.user_id} staked ${b.amount}, escrow ${escrow.get(b.user_id)}`,
        );
      }
      if (b.amount > 10_000) throw new Error(`round ${round.id}: ${b.user_id} staked ${b.amount}`);
    }
    if (escrow.size !== bets.length) throw new Error(`round ${round.id}: escrow without a bet row`);
    const audit = store
      .stmt('SELECT * FROM stream_round_audit WHERE round_id = ?')
      .get(round.id) as AuditRow | undefined;
    if (round.status === 'open' || round.status === 'locked') {
      if (paid.size > 0 || audit) throw new Error(`undecided round ${round.id} paid out`);
      continue;
    }
    if (!audit || audit.outcome !== round.status) {
      throw new Error(`round ${round.id} (${round.status}) has no matching audit row`);
    }
    for (const [userId, list] of paid) {
      if (list.length !== 1)
        throw new Error(`round ${round.id} paid ${userId} ${list.length} times`);
      if (!stakeOf.has(userId)) throw new Error(`round ${round.id} paid ${userId} who did not bet`);
    }
    const sumIn = bets.reduce((s, b) => s + b.amount, 0);
    const sumOut = [...paid.values()].reduce((s, l) => s + (l[0] ?? 0), 0);
    const win = bets.filter((b) => b.side === 'win').reduce((s, b) => s + b.amount, 0);
    const lose = sumIn - win;
    const refunded = round.status === 'void' || win === 0 || lose === 0;
    if ((audit.refunded === 1) !== refunded)
      throw new Error(`round ${round.id}: refunded flag is wrong`);
    if (audit.win_total !== win || audit.lose_total !== lose || audit.bettors !== bets.length) {
      throw new Error(`round ${round.id}: audit totals differ from the bets`);
    }
    if (refunded) {
      for (const b of bets) {
        if (paid.get(b.user_id)?.[0] !== b.amount) {
          throw new Error(`round ${round.id}: refund to ${b.user_id} is not exactly ${b.amount}`);
        }
      }
      if (audit.rake !== 0) throw new Error(`round ${round.id}: a refund kept ${audit.rake}`);
      continue;
    }
    const winnerSide = round.status;
    const winners = winnerSide === 'win' ? win : lose;
    const losers = sumIn - winners;
    const pot = losers - Math.floor((losers * 500) / 10_000);
    for (const b of bets) {
      const got = paid.get(b.user_id)?.[0];
      if (b.side !== winnerSide) {
        if (got !== undefined) throw new Error(`round ${round.id}: loser ${b.user_id} got ${got}`);
        continue;
      }
      const want = b.amount + Math.floor((pot * b.amount) / winners);
      if (got !== want)
        throw new Error(`round ${round.id}: ${b.user_id} got ${got}, the pot gives ${want}`);
      if (got < b.amount) throw new Error(`round ${round.id}: a winner got less than the stake`);
    }
    if (sumOut > sumIn) throw new Error(`round ${round.id} paid ${sumOut} on ${sumIn} staked`);
    if (audit.rake !== sumIn - sumOut) {
      throw new Error(`round ${round.id}: rake ${audit.rake} != ${sumIn} in - ${sumOut} out`);
    }
  }

  const twoLive = store
    .stmt(
      `SELECT guild_id, streamer_id, COUNT(*) AS n FROM streams WHERE status = 'live' GROUP BY 1, 2 HAVING n > 1`,
    )
    .all();
  if (twoLive.length > 0) throw new Error('a streamer has two live panels');
  const twoActive = store
    .stmt(
      `SELECT stream_id, COUNT(*) AS n FROM stream_rounds WHERE status IN ('open', 'locked') GROUP BY 1 HAVING n > 1`,
    )
    .all();
  if (twoActive.length > 0) throw new Error('a stream has two undecided rounds');
  const ended = store
    .stmt(
      `SELECT s.id FROM streams s JOIN stream_rounds r ON r.stream_id = s.id
       WHERE s.status = 'ended' AND r.status IN ('open', 'locked')`,
    )
    .all();
  if (ended.length > 0) throw new Error('an ended stream kept an undecided round');

  // Tips: each `transfer_out` of a stream has its 10 % ceiling fee under the same key.
  const tips = store
    .stmt(
      `SELECT * FROM ledger WHERE ref_type = 'stream' AND reason IN ('transfer_out', 'transfer_fee')`,
    )
    .all() as LedgerRow[];
  const fees = new Map<string, number>();
  for (const r of tips) {
    if (r.reason === 'transfer_fee')
      fees.set(`${r.guild_id}/${r.user_id}/${r.idempotency_key?.replace(/:fee$/, '')}`, -r.delta);
  }
  for (const r of tips) {
    if (r.reason !== 'transfer_out') continue;
    const key = `${r.guild_id}/${r.user_id}/${r.idempotency_key?.replace(/:out$/, '')}`;
    if (fees.get(key) !== Math.ceil(-r.delta / 10)) throw new Error(`tip ${key}: fee is not 10 %`);
  }
}
