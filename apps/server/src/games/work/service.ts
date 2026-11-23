import {
  addClickToHour,
  autoClickSuspected,
  BIG_ORES,
  BIG_RELICS,
  click,
  CLICK_INTERVAL_MS,
  CONTRACT_MS,
  DORM_MAX,
  DRINK_RECOVER,
  dormCost,
  fatigueNow,
  isMechanicalHour,
  MAX_LEVEL,
  settlePlan,
  slotsOf,
  terrainToday,
  upgradeCost,
  WORKERS,
  type ClickHour,
  type ClickResult,
  type Tool,
  type WorkerKind,
  type WorkerRow,
} from '@casino/domain/work';
import { planMerge, relicBuffs } from '@casino/domain/work';
import {
  isoDate,
  laborSkim,
  localDayNumber,
  withholdIncome,
  MS_HOUR,
} from '@casino/domain/progression';
import { Inventory } from '../shop/inventory.ts';
import { GameRuleError, type GamesCtx } from '../progression/context.ts';

export interface WorkRankRow {
  userId: string;
  clicks: number;
  earned: number;
}

interface StateRow {
  pick: number;
  glove: number;
  dorm: number;
  fatigue_milli: number;
  fatigue_at: number;
  last_click: number;
  clicks: number;
  day: string | null;
  day_clicks: number;
  day_earned: number;
  earned_total: number;
  pot: number;
  idle_at: number;
  ores: string;
  relics: string;
  donated: number;
}

export interface WorkView {
  pick: number;
  glove: number;
  dorm: number;
  slots: number;
  fatigue: number;
  clicks: number;
  dayClicks: number;
  pot: number;
  ores: Record<string, number>;
  relics: Record<string, number>;
  workers: { id: number; kind: WorkerKind; expiresAt: number; renew: boolean }[];
  terrain: string;
}

export interface CollectResult {
  amount: number;
  skimmed: number;
  withheld: number;
  net: number;
  ores: Record<string, number>;
  relics: Record<string, number>;
  /** Big finds worth a public announcement. */
  big: string[];
}

/** Underground labor: clicking, idle workers, upgrades, collecting with the 3 % Teiai skim. */
export class WorkService {
  private readonly ctx: GamesCtx;
  private readonly inventory: Inventory;

  constructor(ctx: GamesCtx) {
    this.ctx = ctx;
    this.inventory = new Inventory(ctx.store);
  }

  private state(guildId: string, userId: string): StateRow {
    this.ctx.economy.ensureMember(guildId, userId);
    this.ctx.store
      .stmt('INSERT OR IGNORE INTO work_state (guild_id, user_id) VALUES (?, ?)')
      .run(guildId, userId);
    return this.ctx.store
      .stmt('SELECT * FROM work_state WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as StateRow;
  }

  private workers(guildId: string, userId: string): WorkerRow[] {
    return (
      this.ctx.store
        .stmt(
          'SELECT id, kind, expires_at, renew FROM work_workers WHERE guild_id = ? AND user_id = ? ORDER BY id',
        )
        .all(guildId, userId) as {
        id: number;
        kind: WorkerKind;
        expires_at: number;
        renew: number;
      }[]
    ).map((w) => ({ id: w.id, kind: w.kind, expiresAt: w.expires_at, renew: w.renew === 1 }));
  }

  private terrain(): string {
    return terrainToday(isoDate(localDayNumber(this.ctx.clock.now(), this.ctx.offsetHours)));
  }

  /**
   * `/labor ranking`: most earned first, fewest clicks breaking ties, then user id. `today` counts
   * only what was earned on the current local day. Top `top` rows plus the caller's own rank.
   */
  ranking(
    guildId: string,
    userId: string,
    period: 'total' | 'today',
    top = 10,
  ): { rows: WorkRankRow[]; self: (WorkRankRow & { rank: number }) | null; total: number } {
    // Ranked in SQL: only the top rows and the caller's own row reach JavaScript.
    const earned =
      period === 'today' ? 'CASE WHEN day = ? THEN day_earned ELSE 0 END' : 'earned_total';
    const ranked = `SELECT user_id, clicks, ${earned} AS earned FROM work_state
       WHERE guild_id = ? AND clicks > 0`;
    const scope = period === 'today' ? [this.dayIso(), guildId] : [guildId];
    const rows = (
      this.ctx.store
        .stmt(
          `SELECT user_id, clicks, earned FROM (${ranked}) WHERE earned > 0
           ORDER BY earned DESC, clicks ASC, user_id ASC LIMIT ?`,
        )
        .all(...scope, top) as { user_id: string; clicks: number; earned: number }[]
    ).map((r) => ({ userId: r.user_id, clicks: r.clicks, earned: r.earned }));
    const mine = this.ctx.store
      .stmt(`SELECT clicks, earned FROM (${ranked} AND user_id = ?) WHERE earned > 0`)
      .get(...scope, userId) as { clicks: number; earned: number } | undefined;
    const counts = this.ctx.store
      .stmt(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(earned > ? OR (earned = ? AND (clicks < ? OR (clicks = ? AND user_id < ?)))), 0) AS ahead
         FROM (${ranked}) WHERE earned > 0`,
      )
      .get(
        mine?.earned ?? 0,
        mine?.earned ?? 0,
        mine?.clicks ?? 0,
        mine?.clicks ?? 0,
        userId,
        ...scope,
      ) as { total: number; ahead: number };
    return {
      rows,
      self: mine === undefined ? null : { userId, ...mine, rank: counts.ahead + 1 },
      total: counts.total,
    };
  }

  /** Hourly click statistics of one member, newest hours first (`/admin click-history`). */
  clickHistory(
    guildId: string,
    userId: string,
    hours: number,
  ): { hour: number; clicks: number; pay: number; cv: number | null; mechanical: boolean }[] {
    const nowHour = Math.floor(this.ctx.clock.now() / MS_HOUR);
    const rows = this.ctx.store
      .stmt(
        `SELECT hour, clicks, pay, gaps, sum_gap_ms, sum_gap2_ms, min_gap_ms FROM work_click_hours
          WHERE guild_id = ? AND user_id = ? AND hour > ? ORDER BY hour DESC`,
      )
      .all(guildId, userId, nowHour - hours) as {
      hour: number;
      clicks: number;
      pay: number;
      gaps: number;
      sum_gap_ms: number;
      sum_gap2_ms: number;
      min_gap_ms: number;
    }[];
    return rows.map((r) => {
      const h: ClickHour = {
        clicks: r.clicks,
        pay: r.pay,
        gaps: r.gaps,
        sumGap: r.sum_gap_ms / 1000,
        sumGap2: r.sum_gap2_ms / 1e6,
        minGap: r.min_gap_ms / 1000,
      };
      const mean = h.gaps > 0 ? h.sumGap / h.gaps : 0;
      const variance = h.gaps > 0 ? Math.max(0, h.sumGap2 / h.gaps - mean * mean) : 0;
      return {
        hour: r.hour,
        clicks: r.clicks,
        pay: r.pay,
        cv: h.gaps >= 2 && mean > 0 ? Math.sqrt(variance) / mean : null,
        mechanical: isMechanicalHour(h),
      };
    });
  }

  view(guildId: string, userId: string): WorkView {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      this.settleIdle(guildId, userId);
      const s = this.state(guildId, userId);
      const buffs = relicBuffs(this.inventory.all(guildId, userId));
      return {
        pick: s.pick,
        glove: s.glove,
        dorm: s.dorm,
        slots: slotsOf(s.dorm),
        fatigue: fatigueNow(
          s.fatigue_milli / 1000,
          (ctx.clock.now() - s.fatigue_at) / 1000,
          buffs.recovery,
        ),
        clicks: s.clicks,
        dayClicks: s.day === this.dayIso() ? s.day_clicks : 0,
        pot: s.pot,
        ores: JSON.parse(s.ores) as Record<string, number>,
        relics: JSON.parse(s.relics) as Record<string, number>,
        workers: this.workers(guildId, userId),
        terrain: this.terrain(),
      };
    });
  }

  private dayIso(): string {
    return isoDate(localDayNumber(this.ctx.clock.now(), this.ctx.offsetHours));
  }

  /** Settle idle time before any state change: wages, ores, relics, renewals and expiries. */
  private settleIdle(guildId: string, userId: string): void {
    const { ctx } = this;
    const s = this.state(guildId, userId);
    const now = ctx.clock.now();
    const workers = this.workers(guildId, userId);
    if (workers.length === 0 || s.idle_at <= 0) {
      ctx.store
        .stmt('UPDATE work_state SET idle_at = ? WHERE guild_id = ? AND user_id = ?')
        .run(now, guildId, userId);
      return;
    }
    const buffs = relicBuffs(this.inventory.all(guildId, userId));
    const plan = settlePlan({
      nowMs: now,
      idleAtMs: s.idle_at,
      pot: s.pot,
      balance: ctx.economy.getBalance(guildId, userId),
      workers,
      wageBuff: buffs.wage,
      luckBuff: buffs.luck,
      rng: ctx.rng,
    });
    if (plan.balanceSpent > 0) {
      ctx.economy.debit({
        guildId,
        userId,
        amount: plan.balanceSpent,
        reason: 'work_renewal',
        refType: 'work',
        refId: String(now),
      });
    }
    for (const id of plan.renewed)
      ctx.store
        .stmt('UPDATE work_workers SET expires_at = ? WHERE id = ?')
        .run(now + CONTRACT_MS, id);
    for (const id of plan.removed) ctx.store.stmt('DELETE FROM work_workers WHERE id = ?').run(id);
    const ores = JSON.parse(s.ores) as Record<string, number>;
    const relics = JSON.parse(s.relics) as Record<string, number>;
    for (const [k, n] of Object.entries(plan.ores)) ores[k] = (ores[k] ?? 0) + n;
    for (const [k, n] of Object.entries(plan.relics)) relics[k] = (relics[k] ?? 0) + n;
    for (const f of plan.finds) {
      ctx.store
        .stmt(
          'INSERT INTO work_finds (guild_id, user_id, at, worker, item, qty) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(guildId, userId, f.at, f.worker, f.item, f.qty);
    }
    ctx.store
      .stmt(
        `DELETE FROM work_finds WHERE guild_id = ? AND user_id = ? AND id NOT IN (SELECT id FROM work_finds WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 40)`,
      )
      .run(guildId, userId, guildId, userId);
    ctx.store
      .stmt(
        'UPDATE work_state SET pot = ?, idle_at = ?, ores = ?, relics = ? WHERE guild_id = ? AND user_id = ?',
      )
      .run(
        s.pot - plan.potSpent + plan.gain,
        now,
        JSON.stringify(ores),
        JSON.stringify(relics),
        guildId,
        userId,
      );
  }

  private hours(guildId: string, userId: string, hour: number): Map<number, ClickHour> {
    const rows = this.ctx.store
      .stmt(
        'SELECT hour, clicks, pay, gaps, sum_gap_ms, sum_gap2_ms, min_gap_ms FROM work_click_hours WHERE guild_id = ? AND user_id = ? AND hour >= ?',
      )
      .all(guildId, userId, hour - 3) as {
      hour: number;
      clicks: number;
      pay: number;
      gaps: number;
      sum_gap_ms: number;
      sum_gap2_ms: number;
      min_gap_ms: number;
    }[];
    return new Map(
      rows.map((r) => [
        r.hour,
        {
          clicks: r.clicks,
          pay: r.pay,
          gaps: r.gaps,
          sumGap: r.sum_gap_ms / 1000,
          sumGap2: r.sum_gap2_ms / 1e6,
          minGap: r.min_gap_ms / 1000,
        },
      ]),
    );
  }

  /** One manual dig. Fails quietly (`too_fast`) inside the one-second cooldown. */
  click(guildId: string, userId: string): ClickResult & { tooFast: boolean } {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      this.settleIdle(guildId, userId);
      const s = this.state(guildId, userId);
      const now = ctx.clock.now();
      const noop: ClickResult & { tooFast: boolean } = {
        pay: 0,
        fatigue: s.fatigue_milli / 1000,
        crit: false,
        combo: false,
        ore: null,
        capped: false,
        tooFast: true,
      };
      if (s.last_click > 0 && now - s.last_click < CLICK_INTERVAL_MS) return noop;
      const buffs = relicBuffs(this.inventory.all(guildId, userId));
      const today = this.dayIso();
      const dayClicks = s.day === today ? s.day_clicks : 0;
      const hour = Math.floor(now / MS_HOUR);
      const active = this.workers(guildId, userId).filter((w) => w.expiresAt > now).length;
      const fatigue = fatigueNow(
        s.fatigue_milli / 1000,
        (now - s.fatigue_at) / 1000,
        buffs.recovery,
      );
      const res = click(
        {
          pick: s.pick,
          glove: s.glove,
          fatigue,
          clicks: s.clicks,
          dayClicks,
          activeWorkers: active,
          terrain: this.terrain() as 'hit',
          clickBuff: buffs.click,
          autoSuspected: autoClickSuspected(this.hours(guildId, userId, hour), hour),
        },
        ctx.rng,
      );
      ctx.economy.credit({
        guildId,
        userId,
        amount: res.pay,
        reason: 'work_earnings',
        refType: 'work_click',
        refId: String(s.clicks + 1),
      });
      const gap = s.last_click > 0 ? now - s.last_click : null;
      const prev = this.hours(guildId, userId, hour).get(hour);
      const h = addClickToHour(prev, res.pay, gap === null ? null : gap / 1000);
      ctx.store
        .stmt(
          `INSERT OR REPLACE INTO work_click_hours (guild_id, user_id, hour, clicks, pay, gaps, sum_gap_ms, sum_gap2_ms, min_gap_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          guildId,
          userId,
          hour,
          h.clicks,
          h.pay,
          h.gaps,
          Math.round(h.sumGap * 1000),
          Math.round(h.sumGap2 * 1e6),
          Number.isFinite(h.minGap) ? Math.round(h.minGap * 1000) : 0,
        );
      ctx.store
        .stmt('DELETE FROM work_click_hours WHERE guild_id = ? AND user_id = ? AND hour < ?')
        .run(guildId, userId, hour - 14 * 24);
      ctx.store
        .stmt(
          `UPDATE work_state SET fatigue_milli = ?, fatigue_at = ?, last_click = ?, clicks = clicks + 1, day = ?, day_clicks = ?, day_earned = ?, earned_total = earned_total + ? WHERE guild_id = ? AND user_id = ?`,
        )
        .run(
          Math.round(res.fatigue * 1000),
          now,
          now,
          today,
          dayClicks + 1,
          (s.day === today ? s.day_earned : 0) + res.pay,
          res.pay,
          guildId,
          userId,
        );
      return { ...res, tooFast: false };
    });
  }

  /** Energy drink: -60 fatigue. */
  drink(guildId: string, userId: string): number {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      const s = this.state(guildId, userId);
      const buffs = relicBuffs(this.inventory.all(guildId, userId));
      const now = ctx.clock.now();
      const fatigue = fatigueNow(
        s.fatigue_milli / 1000,
        (now - s.fatigue_at) / 1000,
        buffs.recovery,
      );
      if (fatigue < 1) throw new GameRuleError('labor_not_tired');
      if (!this.inventory.take(guildId, userId, 'labor_drink', 1))
        throw new GameRuleError('labor_no_drink');
      const next = Math.max(0, fatigue - DRINK_RECOVER);
      ctx.store
        .stmt(
          'UPDATE work_state SET fatigue_milli = ?, fatigue_at = ? WHERE guild_id = ? AND user_id = ?',
        )
        .run(Math.round(next * 1000), now, guildId, userId);
      return next;
    });
  }

  upgrade(guildId: string, userId: string, tool: Tool): number {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      const s = this.state(guildId, userId);
      const level = tool === 'pick' ? s.pick : s.glove;
      const cost = upgradeCost(level);
      if (cost === null || level >= MAX_LEVEL) throw new GameRuleError('labor_max_level');
      this.pay(guildId, userId, cost, 'work_upgrade', `${tool}:${level + 1}`);
      ctx.store
        .stmt(`UPDATE work_state SET ${tool} = ? WHERE guild_id = ? AND user_id = ?`)
        .run(level + 1, guildId, userId);
      return level + 1;
    });
  }

  upgradeDorm(guildId: string, userId: string): number {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      const s = this.state(guildId, userId);
      const cost = dormCost(s.dorm);
      if (cost === null || s.dorm >= DORM_MAX) throw new GameRuleError('labor_max_level');
      this.pay(guildId, userId, cost, 'work_upgrade', `dorm:${s.dorm + 1}`);
      ctx.store
        .stmt('UPDATE work_state SET dorm = dorm + 1 WHERE guild_id = ? AND user_id = ?')
        .run(guildId, userId);
      return s.dorm + 1;
    });
  }

  private pay(
    guildId: string,
    userId: string,
    amount: number,
    reason: 'work_upgrade' | 'worker_hire',
    ref: string,
  ): void {
    const balance = this.ctx.economy.getBalance(guildId, userId);
    if (balance < amount)
      throw new GameRuleError(
        'insufficient_balance',
        { need: amount, balance },
        'insufficient_funds',
      );
    this.ctx.economy.debit({ guildId, userId, amount, reason, refType: 'work', refId: ref });
  }

  hire(guildId: string, userId: string, kind: WorkerKind): number {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      this.settleIdle(guildId, userId);
      const s = this.state(guildId, userId);
      const workers = this.workers(guildId, userId);
      if (workers.length >= slotsOf(s.dorm))
        throw new GameRuleError('labor_dorm_full', { slots: slotsOf(s.dorm) });
      this.pay(guildId, userId, WORKERS[kind].fee, 'worker_hire', kind);
      const info = ctx.store
        .stmt(
          'INSERT INTO work_workers (guild_id, user_id, kind, expires_at, renew) VALUES (?, ?, ?, ?, 1)',
        )
        .run(guildId, userId, kind, ctx.clock.now() + CONTRACT_MS);
      if (s.idle_at <= 0 || workers.length === 0)
        ctx.store
          .stmt('UPDATE work_state SET idle_at = ? WHERE guild_id = ? AND user_id = ?')
          .run(ctx.clock.now(), guildId, userId);
      return Number(info.lastInsertRowid);
    });
  }

  /** Dismiss the contract of that kind that ends first. The fee is not refunded. */
  dismiss(guildId: string, userId: string, kind: WorkerKind): void {
    this.ctx.store.transaction(() => {
      this.settleIdle(guildId, userId);
      const w = this.workers(guildId, userId)
        .filter((x) => x.kind === kind)
        .sort((a, b) => a.expiresAt - b.expiresAt)[0];
      if (!w) throw new GameRuleError('labor_no_worker', {}, 'not_found');
      this.ctx.store.stmt('DELETE FROM work_workers WHERE id = ?').run(w.id);
    });
  }

  setRenew(guildId: string, userId: string, renew: boolean): void {
    this.ctx.store
      .stmt('UPDATE work_workers SET renew = ? WHERE guild_id = ? AND user_id = ?')
      .run(renew ? 1 : 0, guildId, userId);
  }

  /** Take the pot: 3 % goes to Teiai, the rest to the wallet (30 % of it to debt), relics to the inventory. */
  collect(guildId: string, userId: string): CollectResult {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      this.settleIdle(guildId, userId);
      const s = this.state(guildId, userId);
      const ores = JSON.parse(s.ores) as Record<string, number>;
      const relics = JSON.parse(s.relics) as Record<string, number>;
      const amount = s.pot;
      if (amount <= 0 && Object.keys(relics).length === 0)
        throw new GameRuleError('labor_nothing_to_collect');
      const skimmed = laborSkim(amount);
      const net = amount - skimmed;
      const key = `work:collect:${ctx.clock.now()}`;
      let withheld = 0;
      if (amount > 0) {
        ctx.economy.credit({
          guildId,
          userId,
          amount,
          reason: 'work_earnings',
          refType: 'work',
          refId: 'collect',
          idempotencyKey: key,
        });
        if (skimmed > 0) {
          ctx.economy.debit({
            guildId,
            userId,
            amount: skimmed,
            reason: 'teiai_skim',
            refType: 'work',
            refId: 'collect',
            idempotencyKey: `${key}:skim`,
          });
          ctx.teiai.houseIncome(guildId, skimmed, 'labor skim');
        }
        withheld = withholdIncome(net, ctx.teiai.debtOf(guildId, userId));
        if (withheld > 0) {
          ctx.economy.debit({
            guildId,
            userId,
            amount: withheld,
            reason: 'debt_withholding',
            refType: 'work',
            refId: 'collect',
            idempotencyKey: `${key}:w`,
          });
          ctx.teiai.repayDebt(guildId, userId, withheld);
        }
      }
      for (const [item, n] of Object.entries(relics)) this.inventory.add(guildId, userId, item, n);
      ctx.store
        .stmt(`UPDATE work_finds SET collected = 1 WHERE guild_id = ? AND user_id = ?`)
        .run(guildId, userId);
      ctx.store
        .stmt(
          `UPDATE work_state SET pot = 0, ores = '{}', relics = '{}', donated = donated + ?, earned_total = earned_total + ? WHERE guild_id = ? AND user_id = ?`,
        )
        .run(skimmed, net, guildId, userId);
      return {
        amount,
        skimmed,
        withheld,
        net,
        ores,
        relics,
        big: [
          ...Object.keys(ores).filter((o) => BIG_ORES.has(o)),
          ...Object.keys(relics).filter((r) => BIG_RELICS.has(r)),
        ],
      };
    });
  }

  /** Ten identical relics into one of the next star. */
  mergeRelic(guildId: string, userId: string, itemId: string): string {
    return this.ctx.store.transaction(() => {
      const plan = planMerge(itemId, this.inventory.qty(guildId, userId, itemId));
      if (!plan.ok) throw new GameRuleError(plan.error);
      this.inventory.take(guildId, userId, plan.from, plan.consume);
      this.inventory.add(guildId, userId, plan.to, 1);
      return plan.to;
    });
  }
}
