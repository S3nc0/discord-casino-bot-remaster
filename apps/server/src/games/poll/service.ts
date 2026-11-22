import {
  planRig,
  RIG_COST,
  shownCounts,
  validateNewPoll,
  verdict,
  type PollStatus,
  type Verdict,
} from '@casino/domain/poll';
import { GameRuleError, type GamesCtx } from '../progression/context.ts';

interface PollRow {
  id: number;
  guild_id: string;
  creator_id: string;
  title: string;
  closes_at: number;
  status: PollStatus;
  adj_yes: number;
  adj_no: number;
  rigs: number;
}

export interface PollView {
  id: number;
  guildId: string;
  creatorId: string;
  title: string;
  closesAt: number;
  status: PollStatus;
  yes: number;
  no: number;
  rigs: number;
  voters: number;
}

/** Timed yes/no polls. The creator can pay to rig the displayed counts. */
export class PollService {
  private readonly ctx: GamesCtx;

  constructor(ctx: GamesCtx) {
    this.ctx = ctx;
  }

  private real(id: number): { yes: number; no: number } {
    const r = this.ctx.store
      .stmt('SELECT COALESCE(SUM(yes), 0) AS y, COUNT(*) AS n FROM poll_votes WHERE poll_id = ?')
      .get(id) as { y: number; n: number };
    return { yes: r.y, no: r.n - r.y };
  }

  get(id: number): PollView | null {
    const p = this.ctx.store.stmt('SELECT * FROM polls WHERE id = ?').get(id) as
      PollRow | undefined;
    if (!p) return null;
    const real = this.real(id);
    const shown = shownCounts({
      realYes: real.yes,
      realNo: real.no,
      adjYes: p.adj_yes,
      adjNo: p.adj_no,
    });
    return {
      id,
      guildId: p.guild_id,
      creatorId: p.creator_id,
      title: p.title,
      closesAt: p.closes_at,
      status: p.status,
      ...shown,
      rigs: p.rigs,
      voters: real.yes + real.no,
    };
  }

  /** Open polls first (closing soonest), then the most recently closed, `limit` in total. */
  list(guildId: string, limit = 20): PollView[] {
    const ids = this.ctx.store
      .stmt(
        `SELECT id FROM polls WHERE guild_id = ?
          ORDER BY (status = 'open') DESC, CASE WHEN status = 'open' THEN closes_at END ASC, id DESC
          LIMIT ?`,
      )
      .all(guildId, limit) as { id: number }[];
    return ids.map(({ id }) => this.get(id) as PollView);
  }

  /** What `userId` voted: true yes, false no, null not voted. */
  voteOf(pollId: number, userId: string): boolean | null {
    const r = this.ctx.store
      .stmt('SELECT yes FROM poll_votes WHERE poll_id = ? AND user_id = ?')
      .get(pollId, userId) as { yes: number } | undefined;
    return r ? r.yes === 1 : null;
  }

  create(input: { guildId: string; creatorId: string; title: string; minutes?: number }): PollView {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      ctx.economy.ensureMember(input.guildId, input.creatorId);
      const minutes = input.minutes ?? 1440;
      const open = (
        ctx.store
          .stmt(
            `SELECT COUNT(*) AS n FROM polls WHERE guild_id = ? AND creator_id = ? AND status = 'open'`,
          )
          .get(input.guildId, input.creatorId) as { n: number }
      ).n;
      const error = validateNewPoll(input.title, minutes, open);
      if (error) throw new GameRuleError(error, {}, 'invalid_payload');
      const info = ctx.store
        .stmt(
          `INSERT INTO polls (guild_id, creator_id, title, closes_at, status) VALUES (?, ?, ?, ?, 'open')`,
        )
        .run(
          input.guildId,
          input.creatorId,
          input.title.trim(),
          ctx.clock.now() + minutes * 60_000,
        );
      return this.get(Number(info.lastInsertRowid)) as PollView;
    });
  }

  vote(guildId: string, userId: string, pollId: number, yes: boolean): PollView {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      ctx.economy.ensureMember(guildId, userId);
      const p = ctx.store
        .stmt('SELECT * FROM polls WHERE id = ? AND guild_id = ?')
        .get(pollId, guildId) as PollRow | undefined;
      if (!p || p.status !== 'open' || ctx.clock.now() >= p.closes_at)
        throw new GameRuleError('poll_closed');
      ctx.store
        .stmt(
          'INSERT INTO poll_votes (poll_id, user_id, yes) VALUES (?, ?, ?) ON CONFLICT (poll_id, user_id) DO UPDATE SET yes = excluded.yes',
        )
        .run(pollId, userId, yes ? 1 : 0);
      return this.get(pollId) as PollView;
    });
  }

  /** Creator only: pay 500 to Teiai and set the displayed counts. Announced publicly by the caller. */
  rig(input: {
    guildId: string;
    userId: string;
    pollId: number;
    yes: number;
    no: number;
    idempotencyKey: string;
  }): { before: { yes: number; no: number }; poll: PollView } {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      const p = ctx.store
        .stmt('SELECT * FROM polls WHERE id = ? AND guild_id = ?')
        .get(input.pollId, input.guildId) as PollRow | undefined;
      if (!p || p.status !== 'open' || ctx.clock.now() >= p.closes_at)
        throw new GameRuleError('poll_closed');
      if (p.creator_id !== input.userId)
        throw new GameRuleError('poll_creator_only', {}, 'forbidden');
      const real = this.real(p.id);
      const plan = planRig({ realYes: real.yes, realNo: real.no }, input.yes, input.no);
      if (!plan.ok) throw new GameRuleError(plan.error, {}, 'invalid_payload');
      const before = shownCounts({
        realYes: real.yes,
        realNo: real.no,
        adjYes: p.adj_yes,
        adjNo: p.adj_no,
      });
      const debit = ctx.economy.debit({
        guildId: input.guildId,
        userId: input.userId,
        amount: RIG_COST,
        reason: 'poll_fee',
        refType: 'poll',
        refId: String(p.id),
        idempotencyKey: input.idempotencyKey,
      });
      if (!debit.replayed) {
        ctx.teiai.bankIncome(input.guildId, RIG_COST, 'poll rig');
        ctx.store
          .stmt('UPDATE polls SET adj_yes = ?, adj_no = ?, rigs = rigs + 1 WHERE id = ?')
          .run(plan.adjYes, plan.adjNo, p.id);
      }
      return { before, poll: this.get(p.id) as PollView };
    });
  }

  /** Job (every minute): close polls whose time is up. */
  closeDue(guildId: string): { poll: PollView; verdict: Verdict }[] {
    const { ctx } = this;
    const due = ctx.store
      .stmt(`SELECT id FROM polls WHERE guild_id = ? AND status = 'open' AND closes_at <= ?`)
      .all(guildId, ctx.clock.now()) as { id: number }[];
    return due.map(({ id }) => {
      ctx.store.stmt(`UPDATE polls SET status = 'closed' WHERE id = ?`).run(id);
      const poll = this.get(id) as PollView;
      return { poll, verdict: verdict(poll) };
    });
  }
}
