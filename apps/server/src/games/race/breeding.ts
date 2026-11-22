import type { Rng } from '@casino/shared';
import {
  BREED_FEE,
  breedFoal,
  foalStats,
  foaledEvent,
  MAX_HORSES,
  parentError,
  STAT_KEYS,
  statSum,
  type BreedError,
  type BreedParent,
  type RunningStyle,
  type StatKey,
  type Stats,
} from '@casino/domain/race';
import { emit, GameRuleError, type GamesCtx } from '../progression/context.ts';

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
  races: number;
  generation: number;
  parent_a_id: number | null;
  parent_b_id: number | null;
  foaled_at: number | null;
  matures_at: number | null;
  last_bred_at: number | null;
  foal_count: number;
  base_value: number;
}

interface BreedingRow {
  id: number;
  parent_a_id: number;
  parent_b_id: number;
  foal_id: number;
  fee: number;
}

export interface BreedRequest {
  guildId: string;
  userId: string;
  parentA: number;
  parentB: number;
  name: string;
  silks: string;
  idempotencyKey: string;
}

export interface FoalView {
  id: number;
  name: string;
  coat: string;
  silks: string;
  stats: Stats;
  generation: number;
  parentIds: [number, number];
  foaledAt: number;
  maturesAt: number;
  baseValue: number;
}

export interface BreedResult {
  breedingId: number;
  fee: number;
  foal: FoalView;
  /** True when the idempotency key had been used: nothing new was written. */
  replayed: boolean;
}

/** Spec message key (`horse.breed.err.*` / `horse.err.*`) for each rejection. */
const ERROR_KEY: Record<BreedError, string> = {
  same_horse: 'same_horse',
  not_owner: 'select_own',
  in_debt: 'in_debt',
  stable_full: 'stable_full',
  insufficient_funds: 'breed_fee_short',
  min_races: 'min_races',
  retired_by_age: 'retired_by_age',
  immature: 'foal_immature',
  foal_limit: 'foal_limit',
  cooldown: 'cooldown',
  invalid_look: 'invalid_look',
  name_empty: 'name_empty',
  name_too_long: 'name_too_long',
  name_invalid_chars: 'name_invalid_chars',
};

const ERROR_CODE: Partial<Record<BreedError, 'forbidden' | 'invalid_payload' | 'not_found'>> = {
  not_owner: 'not_found',
  in_debt: 'forbidden',
  invalid_look: 'invalid_payload',
  name_empty: 'invalid_payload',
  name_too_long: 'invalid_payload',
  name_invalid_chars: 'invalid_payload',
};

function parentOf(h: HorseRow): BreedParent {
  return {
    id: h.id,
    ownerId: h.owner_id,
    name: h.name,
    stats: { speed: h.speed, stamina: h.stamina, power: h.power, guts: h.guts },
    coat: h.coat,
    races: h.races,
    generation: h.generation,
    maturesAt: h.matures_at,
    lastBredAt: h.last_bred_at,
    foalCount: h.foal_count,
  };
}

function viewOf(h: HorseRow): FoalView {
  return {
    id: h.id,
    name: h.name,
    coat: h.coat,
    silks: h.silks,
    stats: { speed: h.speed, stamina: h.stamina, power: h.power, guts: h.guts },
    generation: h.generation,
    parentIds: [h.parent_a_id as number, h.parent_b_id as number],
    foaledAt: h.foaled_at as number,
    maturesAt: h.matures_at as number,
    baseValue: h.base_value,
  };
}

export interface StatRange {
  min: number;
  max: number;
}

export interface BreedPreview {
  total: StatRange;
  stats: Record<StatKey, StatRange>;
  coats: [string, string];
  generation: number;
  /** The first rule that stops this pair (spec key without the `horse.` prefix), if any. */
  eligible: { ok: boolean; rule?: string; at?: number; horse?: string };
}

/** An Rng that replays a script: `foalStats` asks for the total noise, then four stat offsets. */
function scriptedRng(values: readonly number[]): Rng {
  let i = 0;
  return { int: () => values[i++] as number, float: () => 0 };
}

const TOTAL_NOISE_DRAWS = [0, 1, 3, 7, 9] as const; // -10, -5, 0, +5, +10
const SHAPE_OFFSETS = Array.from({ length: 15 }, (_, i) => i - 7);

/**
 * Every foal the two parents can have: the minimum and maximum of each stat and of the total over
 * all 5 x 15^4 rolls of `foalStats`. The roll itself still happens once, server side, when paid.
 */
export function foalRanges(
  a: Stats,
  b: Stats,
): { total: StatRange; stats: Record<StatKey, StatRange> } {
  const cacheKey = JSON.stringify([a, b]);
  const cached = RANGE_CACHE.get(cacheKey);
  if (cached) return cached;
  const computed = computeFoalRanges(a, b);
  if (RANGE_CACHE.size >= 128) RANGE_CACHE.clear();
  RANGE_CACHE.set(cacheKey, computed);
  return computed;
}

const RANGE_CACHE = new Map<string, { total: StatRange; stats: Record<StatKey, StatRange> }>();

function computeFoalRanges(
  a: Stats,
  b: Stats,
): { total: StatRange; stats: Record<StatKey, StatRange> } {
  const stats = {} as Record<StatKey, StatRange>;
  for (const k of STAT_KEYS) stats[k] = { min: Infinity, max: -Infinity };
  const total: StatRange = { min: Infinity, max: -Infinity };
  for (const draw of TOTAL_NOISE_DRAWS)
    for (const o1 of SHAPE_OFFSETS)
      for (const o2 of SHAPE_OFFSETS)
        for (const o3 of SHAPE_OFFSETS)
          for (const o4 of SHAPE_OFFSETS) {
            const foal = foalStats(a, b, scriptedRng([draw, o1, o2, o3, o4]));
            const sum = statSum(foal);
            total.min = Math.min(total.min, sum);
            total.max = Math.max(total.max, sum);
            for (const k of STAT_KEYS) {
              const r = stats[k];
              r.min = Math.min(r.min, foal[k]);
              r.max = Math.max(r.max, foal[k]);
            }
          }
  return { total, stats };
}

/**
 * Horse breeding (docs/spec/horse-breeding.md). Breeding is instant: one transaction charges the
 * fee, marks both parents and inserts the foal. A foal's maturity is a timestamp checked at race
 * entry, so there is no scheduled job.
 */
export class BreedingService {
  private readonly ctx: GamesCtx;

  constructor(ctx: GamesCtx) {
    this.ctx = ctx;
  }

  private horse(id: number): HorseRow | undefined {
    return this.ctx.store.stmt('SELECT * FROM horses WHERE id = ?').get(id) as HorseRow | undefined;
  }

  /** Feature `horse` off blocks new breedings; foals already born keep maturing. */
  isEnabled(guildId: string): boolean {
    return !this.ctx.store
      .stmt(`SELECT 1 FROM guild_features_off WHERE guild_id = ? AND feature = 'horse'`)
      .get(guildId);
  }

  /** Teiai debt blocks breeding. */
  isInDebt(guildId: string, userId: string): boolean {
    return this.ctx.teiai.debtOf(guildId, userId) > 0;
  }

  /** Horses a player owns now; the stable cap counts every one of them. */
  private horseCount(guildId: string, userId: string): number {
    return (
      this.ctx.store
        .stmt('SELECT COUNT(*) AS n FROM horses WHERE guild_id = ? AND owner_id = ?')
        .get(guildId, userId) as { n: number }
    ).n;
  }

  /** What a foal of two of the player's horses can look like, and whether they may breed now. */
  preview(guildId: string, userId: string, parentA: number, parentB: number): BreedPreview {
    const { ctx } = this;
    const a = this.horse(parentA);
    const b = this.horse(parentB);
    if (!a || !b || a.guild_id !== guildId || b.guild_id !== guildId)
      throw new GameRuleError('select_own', {}, 'not_found');
    const pa = parentOf(a);
    const pb = parentOf(b);
    const now = ctx.clock.now();
    const rejected =
      parentA === parentB
        ? ({ error: 'same_horse' } as const)
        : (parentError(pa, userId, now) ?? parentError(pb, userId, now));
    let eligible: BreedPreview['eligible'];
    if (rejected) {
      eligible = {
        ok: false,
        rule: ERROR_KEY[rejected.error],
        ...('at' in rejected && rejected.at !== undefined ? { at: rejected.at } : {}),
        ...('horse' in rejected && rejected.horse !== undefined ? { horse: rejected.horse } : {}),
      };
    } else if (!this.isEnabled(guildId)) {
      eligible = { ok: false, rule: 'feature_disabled' };
    } else if (ctx.teiai.debtOf(guildId, userId) > 0) {
      eligible = { ok: false, rule: 'in_debt' };
    } else if (this.horseCount(guildId, userId) >= MAX_HORSES) {
      eligible = { ok: false, rule: 'stable_full' };
    } else if (ctx.economy.getBalance(guildId, userId) < BREED_FEE) {
      eligible = { ok: false, rule: 'breed_fee_short' };
    } else {
      eligible = { ok: true };
    }
    const { total, stats } = foalRanges(pa.stats, pb.stats);
    return {
      total,
      stats,
      coats: [a.coat, b.coat],
      generation: Math.max(a.generation, b.generation) + 1,
      eligible,
    };
  }

  breed(req: BreedRequest): BreedResult {
    const { ctx } = this;
    const { guildId, userId } = req;
    return ctx.store.transaction(() => {
      ctx.economy.ensureMember(guildId, userId);

      const prior = ctx.store
        .stmt(
          'SELECT id, parent_a_id, parent_b_id, foal_id, fee FROM horse_breedings WHERE guild_id = ? AND user_id = ? AND idempotency_key = ?',
        )
        .get(guildId, userId, req.idempotencyKey) as BreedingRow | undefined;
      if (prior) {
        if (prior.parent_a_id !== req.parentA || prior.parent_b_id !== req.parentB)
          throw new GameRuleError('idempotency_key_reused');
        return {
          breedingId: prior.id,
          fee: prior.fee,
          foal: viewOf(this.horse(prior.foal_id) as HorseRow),
          replayed: true,
        };
      }

      if (!this.isEnabled(guildId))
        throw new GameRuleError('feature_disabled', {}, 'feature_disabled');
      const a = this.horse(req.parentA);
      const b = this.horse(req.parentB);
      if (req.parentA === req.parentB) throw new GameRuleError('same_horse', {}, 'invalid_payload');
      if (!a || !b || a.guild_id !== guildId || b.guild_id !== guildId)
        throw new GameRuleError('select_own', {}, 'not_found');

      const now = ctx.clock.now();
      const debt = ctx.teiai.debtOf(guildId, userId);
      const result = breedFoal(
        { a: parentOf(a), b: parentOf(b), name: req.name, silks: req.silks },
        {
          userId,
          balance: ctx.economy.getBalance(guildId, userId),
          debt,
          horseCount: this.horseCount(guildId, userId),
        },
        ctx,
      );
      if (!result.ok) {
        const params: Record<string, string | number> = {
          max_horses: MAX_HORSES,
          fee: BREED_FEE,
          ...(result.horse === undefined ? {} : { name: result.horse }),
          ...(result.at === undefined ? {} : { at: result.at }),
        };
        throw new GameRuleError(ERROR_KEY[result.error], params, ERROR_CODE[result.error]);
      }
      const foal = result.outcome.state;

      // Both parents change or nothing does: the guard repeats the cooldown and foal limit so a
      // concurrent breeding of the same parent cannot slip through.
      const cooldownEdge = now - 72 * 3_600_000;
      const upd = ctx.store.stmt(
        `UPDATE horses SET last_bred_at = ?, foal_count = foal_count + 1
         WHERE id = ? AND owner_id = ? AND foal_count < 2 AND (last_bred_at IS NULL OR last_bred_at <= ?)`,
      );
      const changed =
        upd.run(now, a.id, userId, cooldownEdge).changes +
        upd.run(now, b.id, userId, cooldownEdge).changes;
      if (changed !== 2) throw new GameRuleError('conflict');

      const foalInfo = ctx.store
        .stmt(
          `INSERT INTO horses (guild_id, owner_id, name, coat, silks, speed, stamina, power, guts,
             created_at, parent_a_id, parent_b_id, generation, foaled_at, matures_at, base_value)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          guildId,
          userId,
          foal.name,
          foal.coat,
          foal.silks,
          foal.stats.speed,
          foal.stats.stamina,
          foal.stats.power,
          foal.stats.guts,
          now,
          a.id,
          b.id,
          foal.generation,
          foal.foaledAt,
          foal.maturesAt,
          foal.baseValue,
        );
      const foalId = Number(foalInfo.lastInsertRowid);
      const breedingId = Number(
        ctx.store
          .stmt(
            `INSERT INTO horse_breedings (guild_id, user_id, parent_a_id, parent_b_id, foal_id, fee, idempotency_key, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(guildId, userId, a.id, b.id, foalId, foal.fee, req.idempotencyKey, now)
          .lastInsertRowid,
      );

      ctx.economy.debit({
        guildId,
        userId,
        amount: foal.fee,
        reason: 'horse_breeding_fee',
        refType: 'horse_breeding',
        refId: String(breedingId),
        idempotencyKey: `horse_breeding:${req.idempotencyKey}`,
        meta: { foal: foal.name },
      });

      emit(ctx, foaledEvent(guildId, userId, foalId, foal));
      return {
        breedingId,
        fee: foal.fee,
        foal: viewOf(this.horse(foalId) as HorseRow),
        replayed: false,
      };
    });
  }
}
