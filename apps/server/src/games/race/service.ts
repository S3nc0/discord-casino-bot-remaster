import {
  addGoldCarrot,
  betKey,
  closeEntries,
  COATS,
  ENTRY_FEE,
  FIELD_SIZE,
  GOLD_CARROT_MAX,
  isMajorRace,
  isValidLook,
  makeAllOdds,
  MAX_HORSES,
  MAX_RACES,
  moveCarrot,
  regularRaceTimes,
  dailyRaceStarts,
  retireValue,
  settleRace,
  simulate,
  SILKS,
  styleOf,
  validateBet,
  valueOf,
  validateHorseName,
  type BetKind,
  type Entrant,
  type Registered,
  type RunningStyle,
  type StatKey,
  type Stats,
  type Track,
} from '@casino/domain/race';
import { localDayNumber } from '@casino/domain/progression';
import { relicBuffs } from '@casino/domain/work';
import {
  chargeOrOwe,
  creditIncome,
  emit,
  GameRuleError,
  type GamesCtx,
} from '../progression/context.ts';
import { Inventory } from '../shop/inventory.ts';

interface HorseRow {
  id: number;
  guild_id: string;
  owner_id: string | null;
  name: string;
  coat: string;
  silks: string;
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  style: RunningStyle | null;
  bonus: number;
  races: number;
  wins: number;
  places: number;
  generation: number;
  parent_a_id: number | null;
  parent_b_id: number | null;
  matures_at: number | null;
  last_bred_at: number | null;
  foal_count: number;
  base_value: number;
}

interface RaceRow {
  id: number;
  guild_id: string;
  kind: 'regular' | 'special';
  status: 'entry' | 'betting' | 'done';
  major: number;
  start_at: number;
  entry_open: number;
  entry_close: number;
  bet_close: number;
  track: string | null;
  placings: string | null;
}

interface EntryRow {
  id: number;
  race_id: number;
  horse_id: number | null;
  owner_id: string | null;
  name: string;
  lane: number;
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  style: RunningStyle;
  form: -1 | 0 | 1;
  races: number;
  wins: number;
  places: number;
  silks: string;
  coat: string;
}

export interface HorseView {
  id: number;
  ownerId: string | null;
  name: string;
  coat: string;
  silks: string;
  stats: Stats;
  style: RunningStyle | null;
  autoStyle: RunningStyle;
  races: number;
  wins: number;
  places: number;
  retireValue: number;
  /** 0 for voucher, seized and legacy horses; parents + 1 for bred ones. */
  generation: number;
  parentIds: [number, number] | null;
  /** Epoch ms a foal can race from; null for horses that were never foals. */
  maturesAt: number | null;
  lastBredAt: number | null;
  foalCount: number;
  baseValue: number;
}

export interface RaceTimeline {
  raceId: number;
  track: Track;
  /** Per lane: name, silks, owner. */
  runners: {
    lane: number;
    name: string;
    silks: string;
    ownerId: string | null;
    horseId: number | null;
  }[];
  /** Progress in milli (0..1000) of every runner (same order as `runners`) after each tick. */
  frames: number[][];
  /** Lanes from first to last. */
  placings: number[];
}

export interface RaceResult {
  raceId: number;
  placings: number[];
  prizes: { ownerId: string; horseId: number; place: number; amount: number }[];
  payouts: { userId: string; stake: number; payout: number }[];
  retired: { userId: string; horseId: number; value: number; shortfall: number }[];
}

/** Horse ownership, stable care, the four daily races, betting and settlement. */
export class RaceService {
  private readonly ctx: GamesCtx;
  private readonly inventory: Inventory;

  constructor(ctx: GamesCtx) {
    this.ctx = ctx;
    this.inventory = new Inventory(ctx.store);
  }

  private horse(id: number): HorseRow | undefined {
    return this.ctx.store.stmt('SELECT * FROM horses WHERE id = ?').get(id) as HorseRow | undefined;
  }

  private ownHorse(guildId: string, userId: string, horseId: number): HorseRow {
    const h = this.horse(horseId);
    if (!h || h.guild_id !== guildId || h.owner_id !== userId)
      throw new GameRuleError('select_own', {}, 'not_found');
    return h;
  }

  private view(h: HorseRow): HorseView {
    const stats: Stats = { speed: h.speed, stamina: h.stamina, power: h.power, guts: h.guts };
    return {
      id: h.id,
      ownerId: h.owner_id,
      name: h.name,
      coat: h.coat,
      silks: h.silks,
      stats,
      style: h.style,
      autoStyle: styleOf(stats),
      races: h.races,
      wins: h.wins,
      places: h.places,
      retireValue: retireValue(h.races, h.wins, h.places),
      generation: h.generation,
      parentIds:
        h.parent_a_id !== null && h.parent_b_id !== null ? [h.parent_a_id, h.parent_b_id] : null,
      maturesAt: h.matures_at,
      lastBredAt: h.last_bred_at,
      foalCount: h.foal_count,
      baseValue: h.base_value,
    };
  }

  stable(guildId: string, userId: string): HorseView[] {
    return (
      this.ctx.store
        .stmt('SELECT * FROM horses WHERE guild_id = ? AND owner_id = ? ORDER BY id')
        .all(guildId, userId) as HorseRow[]
    ).map((h) => this.view(h));
  }

  /** Net-worth value of a player's horses. */
  horseValue(guildId: string, userId: string): number {
    return this.stable(guildId, userId).reduce(
      (sum, h) => sum + valueOf(h.baseValue, h.retireValue),
      0,
    );
  }

  // ------------------------------------------------------------------ stable

  /** Spend one `horse_voucher` on a new horse with 50/50/50/50 stats. */
  createHorse(
    guildId: string,
    userId: string,
    input: { name: string; coat: string; silks: string },
  ): HorseView {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      ctx.economy.ensureMember(guildId, userId);
      const name = validateHorseName(input.name);
      if (!name.ok) throw new GameRuleError(name.error, {}, 'invalid_payload');
      if (!isValidLook(input.coat, input.silks))
        throw new GameRuleError('invalid_look', {}, 'invalid_payload');
      if (this.stable(guildId, userId).length >= MAX_HORSES)
        throw new GameRuleError('max_owned', { max_horses: MAX_HORSES });
      if (!this.inventory.take(guildId, userId, 'horse_voucher', 1))
        throw new GameRuleError('no_voucher');
      const info = ctx.store
        .stmt(
          `INSERT INTO horses (guild_id, owner_id, name, coat, silks, speed, stamina, power, guts, created_at) VALUES (?, ?, ?, ?, ?, 50, 50, 50, 50, ?)`,
        )
        .run(guildId, userId, name.name, input.coat, input.silks, ctx.clock.now());
      return this.view(this.horse(Number(info.lastInsertRowid)) as HorseRow);
    });
  }

  carrot(guildId: string, userId: string, horseId: number, src: StatKey, dst: StatKey): HorseView {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      const h = this.ownHorse(guildId, userId, horseId);
      const moved = moveCarrot(
        { speed: h.speed, stamina: h.stamina, power: h.power, guts: h.guts },
        src,
        dst,
      );
      if (!moved.ok)
        throw new GameRuleError(moved.error, { stat: moved.stat ?? '' }, 'invalid_payload');
      if (!this.inventory.take(guildId, userId, 'carrot', 1)) throw new GameRuleError('no_carrot');
      this.saveStats(horseId, moved.stats, h.bonus);
      return this.view(this.horse(horseId) as HorseRow);
    });
  }

  goldCarrot(
    guildId: string,
    userId: string,
    horseId: number,
    first: StatKey,
    second: StatKey,
  ): HorseView {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      const h = this.ownHorse(guildId, userId, horseId);
      if (h.bonus >= GOLD_CARROT_MAX * 2 * 5)
        throw new GameRuleError('gold_carrot_max', { max_count: GOLD_CARROT_MAX });
      const added = addGoldCarrot(
        { speed: h.speed, stamina: h.stamina, power: h.power, guts: h.guts },
        first,
        second,
      );
      if (!added.ok)
        throw new GameRuleError(added.error, { stat: added.stat ?? '' }, 'invalid_payload');
      if (!this.inventory.take(guildId, userId, 'gold_carrot', 1))
        throw new GameRuleError('no_gold_carrot');
      this.saveStats(horseId, added.stats, h.bonus + 10);
      return this.view(this.horse(horseId) as HorseRow);
    });
  }

  private saveStats(horseId: number, s: Stats, bonus: number): void {
    this.ctx.store
      .stmt('UPDATE horses SET speed = ?, stamina = ?, power = ?, guts = ?, bonus = ? WHERE id = ?')
      .run(s.speed, s.stamina, s.power, s.guts, bonus, horseId);
  }

  setStyle(guildId: string, userId: string, horseId: number, style: RunningStyle | null): void {
    this.ownHorse(guildId, userId, horseId);
    this.ctx.store.stmt('UPDATE horses SET style = ? WHERE id = ?').run(style, horseId);
  }

  /** Retire by hand: a payout, or a fee the owner must be able to pay. Not while entered in a race. */
  retire(guildId: string, userId: string, horseId: number): { value: number } {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      const h = this.ownHorse(guildId, userId, horseId);
      const busy = ctx.store
        .stmt(
          `SELECT 1 FROM horse_entries e JOIN horse_races r ON r.id = e.race_id WHERE e.horse_id = ? AND r.status != 'done'`,
        )
        .get(horseId);
      if (busy) throw new GameRuleError('busy_no_retire');
      const value = retireValue(h.races, h.wins, h.places);
      if (value < 0 && ctx.economy.getBalance(guildId, userId) < -value) {
        throw new GameRuleError('retire_fee_short', {
          fee: -value,
          balance: ctx.economy.getBalance(guildId, userId),
        });
      }
      this.finishRetirement(guildId, userId, h, value);
      return { value };
    });
  }

  private finishRetirement(
    guildId: string,
    userId: string,
    h: HorseRow,
    value: number,
  ): { shortfall: number } {
    const { ctx } = this;
    ctx.store
      .stmt('UPDATE horses SET owner_id = NULL, retired_at = ? WHERE id = ?')
      .run(ctx.clock.now(), h.id);
    let shortfall = 0;
    if (value > 0) {
      creditIncome(ctx, {
        guildId,
        userId,
        amount: value,
        reason: 'horse_retirement',
        refType: 'horse',
        refId: String(h.id),
        idempotencyKey: `retire:${h.id}`,
      });
    } else if (value < 0) {
      // The wallet never goes below zero: whatever it cannot cover becomes Teiai debt.
      shortfall = chargeOrOwe(ctx, {
        guildId,
        userId,
        amount: -value,
        reason: 'horse_retirement_fee',
        why: 'horse retirement fee',
        refType: 'horse',
        refId: String(h.id),
        idempotencyKey: `retire:${h.id}`,
      }).shortfall;
    }
    emit(ctx, {
      type: 'HorseRetired',
      guildId,
      at: ctx.clock.now(),
      userId,
      horseId: h.id,
      payout: Math.max(0, value),
    });
    return { shortfall };
  }

  // ------------------------------------------------------------------ schedule and state machine

  private race(id: number): RaceRow {
    const r = this.ctx.store.stmt('SELECT * FROM horse_races WHERE id = ?').get(id) as
      RaceRow | undefined;
    if (!r) throw new GameRuleError('race_not_found', {}, 'not_found');
    return r;
  }

  /** Job: make sure today's regular races exist (entries open 2 h before each start). */
  ensureDay(guildId: string): number[] {
    const { ctx } = this;
    const day = localDayNumber(ctx.clock.now(), ctx.offsetHours);
    const created: number[] = [];
    ctx.store.transaction(() => {
      for (const start of dailyRaceStarts(day, ctx.offsetHours)) {
        const t = regularRaceTimes(start);
        const major = isMajorRace('regular', start, ctx.offsetHours) ? 1 : 0;
        const info = ctx.store
          .stmt(
            `INSERT OR IGNORE INTO horse_races (guild_id, kind, status, major, start_at, entry_open, entry_close, bet_close) VALUES (?, 'regular', 'entry', ?, ?, ?, ?, ?)`,
          )
          .run(guildId, major, start, t.entryOpen, t.entryClose, t.betClose);
        if (info.changes > 0) {
          const id = Number(info.lastInsertRowid);
          created.push(id);
          emit(ctx, {
            type: 'RaceScheduled',
            guildId,
            at: ctx.clock.now(),
            raceId: id,
            startsAt: start,
            entrants: 0,
          });
        }
      }
    });
    return created;
  }

  /** Job (every 5 s): close entries when due, run races when their time has come. */
  tick(guildId: string): { closed: number[]; run: RaceResult[] } {
    const now = this.ctx.clock.now();
    const rows = this.ctx.store
      .stmt(
        `SELECT id, status, entry_close, start_at FROM horse_races WHERE guild_id = ? AND status != 'done'`,
      )
      .all(guildId) as { id: number; status: string; entry_close: number; start_at: number }[];
    const closed: number[] = [];
    const run: RaceResult[] = [];
    for (const r of rows) {
      if (r.status === 'entry' && now >= r.entry_close) {
        this.closeEntries(r.id);
        closed.push(r.id);
      }
      if (now >= r.start_at) run.push(this.runRace(r.id));
    }
    return { closed, run };
  }

  /** Snapshot the registered horses, fill with NPCs, draw lanes, form, track and fixed odds. */
  closeEntries(raceId: number): void {
    const { ctx } = this;
    ctx.store.transaction(() => {
      const race = this.race(raceId);
      if (race.status !== 'entry') return;
      const reg = ctx.store
        .stmt(
          `SELECT h.* FROM horse_entries e JOIN horses h ON h.id = e.horse_id WHERE e.race_id = ? ORDER BY e.id`,
        )
        .all(raceId) as HorseRow[];
      const registered: Registered[] = reg.map((h) => ({
        horseId: h.id,
        ownerId: h.owner_id as string,
        name: h.name,
        speed: h.speed,
        stamina: h.stamina,
        power: h.power,
        guts: h.guts,
        style: h.style,
        races: h.races,
        wins: h.wins,
        places: h.places,
        silks: h.silks,
        coat: h.coat,
      }));
      const { entrants, track } = closeEntries(registered, ctx.rng);
      ctx.store.stmt('DELETE FROM horse_entries WHERE race_id = ?').run(raceId);
      const ins = ctx.store.stmt(
        `INSERT INTO horse_entries (race_id, guild_id, horse_id, owner_id, name, lane, speed, stamina, power, guts, style, form, races, wins, places, silks, coat)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const e of entrants)
        ins.run(
          raceId,
          race.guild_id,
          e.horseId,
          e.ownerId,
          e.name,
          e.lane,
          e.speed,
          e.stamina,
          e.power,
          e.guts,
          e.style,
          e.form,
          e.races,
          e.wins,
          e.places,
          e.silks,
          e.coat,
        );
      const odds = makeAllOdds(entrants, track);
      const insOdds = ctx.store.stmt(
        'INSERT INTO horse_odds (race_id, kind, key, odds_tenths) VALUES (?, ?, ?, ?)',
      );
      for (const [kind, table] of Object.entries(odds))
        for (const [key, tenths] of Object.entries(table)) insOdds.run(raceId, kind, key, tenths);
      ctx.store
        .stmt(`UPDATE horse_races SET status = 'betting', track = ? WHERE id = ?`)
        .run(JSON.stringify(track), raceId);
      emit(ctx, {
        type: 'RaceScheduled',
        guildId: race.guild_id,
        at: ctx.clock.now(),
        raceId,
        startsAt: race.start_at,
        entrants: entrants.length,
      });
    });
  }

  // ------------------------------------------------------------------ entry

  register(guildId: string, userId: string, raceId: number, horseId: number): void {
    const { ctx } = this;
    ctx.store.transaction(() => {
      const race = this.race(raceId);
      const h = this.ownHorse(guildId, userId, horseId);
      if (
        race.guild_id !== guildId ||
        race.status !== 'entry' ||
        ctx.clock.now() >= race.entry_close
      )
        throw new GameRuleError('entry_closed');
      if (ctx.clock.now() < race.entry_open) throw new GameRuleError('entry_not_open');
      if (h.races >= MAX_RACES) throw new GameRuleError('retired_by_age', { max_races: MAX_RACES });
      if (h.matures_at !== null && ctx.clock.now() < h.matures_at)
        throw new GameRuleError('foal_immature', { time: h.matures_at, at: h.matures_at });
      const entries = ctx.store
        .stmt('SELECT owner_id, name, horse_id FROM horse_entries WHERE race_id = ?')
        .all(raceId) as { owner_id: string; name: string; horse_id: number }[];
      if (entries.some((e) => e.owner_id === userId))
        throw new GameRuleError('one_horse_per_owner');
      if (entries.length >= FIELD_SIZE) throw new GameRuleError('field_full');
      if (entries.some((e) => e.name === h.name)) throw new GameRuleError('duplicate_name');
      if (race.kind === 'regular') {
        const busy = ctx.store
          .stmt(
            `SELECT 1 FROM horse_entries e JOIN horse_races r ON r.id = e.race_id WHERE e.horse_id = ? AND r.status != 'done' AND r.kind = 'regular'`,
          )
          .get(horseId);
        if (busy) throw new GameRuleError('horse_busy');
      }
      const balance = ctx.economy.getBalance(guildId, userId);
      if (balance < ENTRY_FEE)
        throw new GameRuleError('entry_fee_short', { fee: ENTRY_FEE, balance });
      ctx.economy.debit({
        guildId,
        userId,
        amount: ENTRY_FEE,
        reason: 'race_entry_fee',
        refType: 'race',
        refId: String(raceId),
        idempotencyKey: `race:${raceId}:entry:${horseId}`,
      });
      ctx.store
        .stmt(
          'INSERT INTO horse_entries (race_id, guild_id, horse_id, owner_id, name, lane) VALUES (?, ?, ?, ?, ?, -1)',
        )
        .run(raceId, guildId, horseId, userId, h.name);
    });
  }

  withdraw(guildId: string, userId: string, raceId: number, horseId: number): void {
    const { ctx } = this;
    ctx.store.transaction(() => {
      const race = this.race(raceId);
      if (race.status !== 'entry' || ctx.clock.now() >= race.entry_close)
        throw new GameRuleError('entry_closed');
      const info = ctx.store
        .stmt('DELETE FROM horse_entries WHERE race_id = ? AND horse_id = ? AND owner_id = ?')
        .run(raceId, horseId, userId);
      if (info.changes === 0) throw new GameRuleError('not_entered');
      ctx.economy.credit({
        guildId,
        userId,
        amount: ENTRY_FEE,
        reason: 'race_refund',
        refType: 'race',
        refId: String(raceId),
        idempotencyKey: `race:${raceId}:withdraw:${horseId}`,
      });
    });
  }

  // ------------------------------------------------------------------ card and bets

  card(raceId: number): {
    race: RaceRow;
    entrants: EntryRow[];
    odds: Record<string, Record<string, number>>;
  } {
    const race = this.race(raceId);
    const entrants = this.ctx.store
      .stmt('SELECT * FROM horse_entries WHERE race_id = ? ORDER BY lane, id')
      .all(raceId) as EntryRow[];
    const odds: Record<string, Record<string, number>> = {};
    for (const o of this.ctx.store
      .stmt('SELECT kind, key, odds_tenths FROM horse_odds WHERE race_id = ?')
      .all(raceId) as { kind: string; key: string; odds_tenths: number }[]) {
      (odds[o.kind] ??= {})[o.key] = o.odds_tenths;
    }
    return { race, entrants, odds };
  }

  /** Buy one ticket (several single/place tickets are several calls with their own keys). */
  bet(input: {
    guildId: string;
    userId: string;
    raceId: number;
    kind: BetKind;
    lanes: number[];
    stake: number;
    idempotencyKey: string;
  }): { betId: number; oddsTenths: number } {
    const { ctx } = this;
    const { guildId, userId, raceId, kind, lanes, stake } = input;
    return ctx.store.transaction(() => {
      ctx.economy.ensureMember(guildId, userId);
      const race = this.race(raceId);
      if (race.guild_id !== guildId) throw new GameRuleError('race_not_found', {}, 'not_found');
      const key = (() => {
        try {
          return betKey(kind, lanes);
        } catch {
          throw new GameRuleError('select_distinct_horses', {}, 'invalid_payload');
        }
      })();
      const running = new Set(
        (
          ctx.store
            .stmt('SELECT lane FROM horse_entries WHERE race_id = ? AND lane > 0')
            .all(raceId) as { lane: number }[]
        ).map((r) => r.lane),
      );
      const spent = (
        ctx.store
          .stmt(
            'SELECT COALESCE(SUM(stake), 0) AS s FROM horse_bets WHERE race_id = ? AND user_id = ?',
          )
          .get(raceId, userId) as { s: number }
      ).s;
      const oddsRow = ctx.store
        .stmt('SELECT odds_tenths FROM horse_odds WHERE race_id = ? AND kind = ? AND key = ?')
        .get(raceId, kind, key) as { odds_tenths: number } | undefined;
      const error = validateBet({
        kind,
        lanes,
        stake,
        spent,
        runningLanes: running,
        status: race.status,
        nowMs: ctx.clock.now(),
        betClose: race.bet_close,
        hasOdds: oddsRow !== undefined,
      });
      if (error)
        throw new GameRuleError(
          error,
          { min_stake: 100, max_stake: 50_000, max_race_stake: 150_000 },
          'invalid_payload',
        );
      const debit = ctx.economy.debit({
        guildId,
        userId,
        amount: stake,
        reason: 'race_bet',
        refType: 'race',
        refId: String(raceId),
        idempotencyKey: input.idempotencyKey,
      });
      const existing = ctx.store
        .stmt(
          'SELECT id, odds_tenths FROM horse_bets WHERE race_id = ? AND user_id = ? AND created_at = ? AND key = ?',
        )
        .get(raceId, userId, debit.entry.createdAt, key) as
        { id: number; odds_tenths: number } | undefined;
      if (debit.replayed && existing)
        return { betId: existing.id, oddsTenths: existing.odds_tenths };
      const info = ctx.store
        .stmt(
          'INSERT INTO horse_bets (race_id, guild_id, user_id, kind, key, stake, odds_tenths, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          raceId,
          guildId,
          userId,
          kind,
          key,
          stake,
          (oddsRow as { odds_tenths: number }).odds_tenths,
          debit.entry.createdAt,
        );
      return {
        betId: Number(info.lastInsertRowid),
        oddsTenths: (oddsRow as { odds_tenths: number }).odds_tenths,
      };
    });
  }

  // ------------------------------------------------------------------ run and settle

  /** Simulate once, store the timeline, pay prizes and tickets, update records, retire at 32 races. */
  runRace(raceId: number): RaceResult {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      let race = this.race(raceId);
      if (race.status === 'done')
        return {
          raceId,
          placings: JSON.parse(race.placings ?? '[]') as number[],
          prizes: [],
          payouts: [],
          retired: [],
        };
      if (race.status === 'entry') {
        this.closeEntries(raceId);
        race = this.race(raceId);
      }
      const guildId = race.guild_id;
      const entries = ctx.store
        .stmt('SELECT * FROM horse_entries WHERE race_id = ? ORDER BY lane')
        .all(raceId) as EntryRow[];
      const track = JSON.parse(race.track as string) as Track;
      const runners: Entrant[] = entries.map((e) => ({
        lane: e.lane,
        name: e.name,
        speed: e.speed,
        stamina: e.stamina,
        power: e.power,
        guts: e.guts,
        style: e.style,
        form: e.form,
        races: e.races,
        wins: e.wins,
        places: e.places,
        horseId: e.horse_id,
        ownerId: e.owner_id,
        silks: e.silks,
        coat: e.coat,
      }));
      const sim = simulate(runners, track, ctx.rng);

      const bets = ctx.store
        .stmt('SELECT id, user_id, kind, key, stake, odds_tenths FROM horse_bets WHERE race_id = ?')
        .all(raceId) as {
        id: number;
        user_id: string;
        kind: BetKind;
        key: string;
        stake: number;
        odds_tenths: number;
      }[];
      const buffs = new Map<string, number>();
      for (const e of entries)
        if (e.owner_id)
          buffs.set(e.owner_id, relicBuffs(this.inventory.all(guildId, e.owner_id)).prize);
      const settlement = settleRace({
        runners: runners.map((r) => ({
          lane: r.lane,
          horseId: r.horseId,
          ownerId: r.ownerId,
          name: r.name,
          races: r.races,
          wins: r.wins,
          places: r.places,
        })),
        order: sim.order,
        major: race.major === 1,
        bets: bets.map((b) => ({
          id: b.id,
          userId: b.user_id,
          kind: b.kind,
          lanes: b.key.split(/[->]/).map(Number),
          stake: b.stake,
          odds: b.odds_tenths,
        })),
        bankCash: ctx.teiai.bankCash(guildId),
        prizeBuff: buffs,
      });

      if (settlement.bankTopup > 0) ctx.teiai.drawBankCash(guildId, settlement.bankTopup);
      for (const p of settlement.prizes) {
        if (p.amount > 0)
          creditIncome(ctx, {
            guildId,
            userId: p.ownerId,
            amount: p.amount,
            reason: 'race_prize',
            refType: 'race',
            refId: String(raceId),
            idempotencyKey: `race:${raceId}:prize:${p.horseId}`,
          });
      }
      const perUser = new Map<string, { stake: number; payout: number }>();
      for (const b of bets) {
        const pay = settlement.payouts.find((x) => x.betId === b.id) as { payout: number };
        ctx.store.stmt('UPDATE horse_bets SET payout = ? WHERE id = ?').run(pay.payout, b.id);
        const t = perUser.get(b.user_id) ?? { stake: 0, payout: 0 };
        t.stake += b.stake;
        t.payout += pay.payout;
        perUser.set(b.user_id, t);
      }
      for (const [userId, t] of perUser) {
        if (t.payout > 0)
          creditIncome(ctx, {
            guildId,
            userId,
            amount: t.payout,
            reason: 'race_payout',
            refType: 'race',
            refId: String(raceId),
            idempotencyKey: `race:${raceId}:payout:${userId}`,
          });
      }
      if (settlement.bankIncome > 0)
        ctx.teiai.bankIncome(guildId, settlement.bankIncome, 'race loss share');

      const retired: RaceResult['retired'] = [];
      for (const u of settlement.horseUpdates) {
        ctx.store
          .stmt('UPDATE horses SET races = ?, wins = ?, places = ? WHERE id = ?')
          .run(u.races, u.wins, u.places, u.horseId);
        if (u.retire) {
          const h = this.horse(u.horseId) as HorseRow;
          // Automatic retirement charges its fee even when the wallet cannot pay it: the rest is debt.
          const { shortfall } = this.finishRetirement(guildId, u.ownerId, h, u.retireValue);
          retired.push({ userId: u.ownerId, horseId: u.horseId, value: u.retireValue, shortfall });
        }
      }

      const at = ctx.clock.now();
      const timeline: RaceTimeline = {
        raceId,
        track,
        runners: runners.map((r) => ({
          lane: r.lane,
          name: r.name,
          silks: r.silks,
          ownerId: r.ownerId,
          horseId: r.horseId,
        })),
        frames: sim.frames,
        placings: settlement.placings,
      };
      ctx.store
        .stmt(`UPDATE horse_races SET status = 'done', placings = ?, timeline = ? WHERE id = ?`)
        .run(JSON.stringify(settlement.placings), JSON.stringify(timeline), raceId);

      emit(ctx, {
        type: 'RaceFinished',
        guildId,
        at,
        raceId,
        placings: sim.order.map((i) => (entries[i] as EntryRow).id),
        ownerIds: [
          ...new Set(entries.map((e) => e.owner_id).filter((x): x is string => x !== null)),
        ],
        bettorIds: [...perUser.keys()],
      });
      for (const [userId, t] of perUser) {
        emit(ctx, {
          type: 'GameSettled',
          guildId,
          at,
          userId,
          game: 'horse',
          roundId: `race:${raceId}`,
          stake: t.stake,
          payout: t.payout,
          net: t.payout - t.stake,
          source: 'system',
        });
      }
      return {
        raceId,
        placings: settlement.placings,
        prizes: settlement.prizes.map((p) => ({
          ownerId: p.ownerId,
          horseId: p.horseId,
          place: p.place,
          amount: p.amount,
        })),
        payouts: [...perUser].map(([userId, t]) => ({ userId, ...t })),
        retired,
      };
    });
  }

  /** The stored race animation for the Activity. */
  timeline(raceId: number): RaceTimeline | null {
    const r = this.ctx.store.stmt('SELECT timeline FROM horse_races WHERE id = ?').get(raceId) as
      { timeline: string | null } | undefined;
    return r?.timeline ? (JSON.parse(r.timeline) as RaceTimeline) : null;
  }
}

export { COATS, SILKS };
