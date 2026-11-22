import type { FastifyRequest } from 'fastify';
import {
  BREED_COOLDOWN_MS,
  BREED_FEE,
  BREED_MIN_RACES,
  ENTRY_FEE,
  FIELD_SIZE,
  FOAL_MATURITY_MS,
  GOLD_CARROT_MAX,
  MAX_FOALS_PER_HORSE,
  MAX_HORSES,
  MAX_RACES,
  MAX_RACE_STAKE,
  MAX_STAKE,
  MIN_STAKE,
  NAME_MAX,
  parentError,
  type BreedParent,
  type BetKind,
} from '@casino/domain/race';
import {
  HORSE_ROUTES,
  HorseBetRequest,
  HorseBreedPreviewQuery,
  HorseBreedRequest,
  HorseCarrotRequest,
  HorseCreateRequest,
  HorseEntryRequest,
  HorseGoldCarrotRequest,
  HorseRetireRequest,
  HorseStyleRequest,
  type HorseBreedPreview,
  type HorseBreedResponse,
  type HorseCard,
  type HorseInfo,
  type HorseRaceDetail,
  type HorseRaceSummary,
  type HorseRetireResponse,
  type HorseRules,
  type HorseRunner,
  type HorseStable,
  type HorseTimeline,
  type HorseWriteResponse,
  type RacePhase,
  type SessionClaims,
} from '@casino/shared';
import { Inventory } from '../../games/shop/inventory.ts';
import { GameRuleError } from '../../games/progression/context.ts';
import type { EntryRow, HorseRow, RaceRow } from '../../games/race/service.ts';
import type { HorseView } from '../../games/race/service.ts';
import { AppError } from '../../runtime/errors.ts';
import { registerArenaRoutes } from './horse-arena.ts';
import type { ActivityKit } from './context.ts';

const RULES: HorseRules = {
  maxHorses: MAX_HORSES,
  maxRaces: MAX_RACES,
  nameMax: NAME_MAX,
  entryFee: ENTRY_FEE,
  breedFee: BREED_FEE,
  minStake: MIN_STAKE,
  maxStake: MAX_STAKE,
  maxRaceStake: MAX_RACE_STAKE,
  breedMinRaces: BREED_MIN_RACES,
  maxFoals: MAX_FOALS_PER_HORSE,
  breedCooldownMs: BREED_COOLDOWN_MS,
  foalMaturityMs: FOAL_MATURITY_MS,
};

type Idem = { replayed: boolean };

function raceIdOf(request: FastifyRequest): number {
  const id = Number((request.params as { id?: string }).id);
  if (!Number.isSafeInteger(id) || id < 1) throw new AppError('invalid_payload');
  return id;
}

/** `raceRow` throws `race_not_found` for a missing race; a race of another guild is the same. */
function guildRace(kit: ActivityKit, session: SessionClaims, id: number): RaceRow {
  const row = kit.services.games.race.raceRow(id);
  if (row.guild_id !== session.gid) throw new GameRuleError('race_not_found', {}, 'not_found');
  return row;
}

function phaseOf(race: RaceRow, now: number): RacePhase {
  if (race.status === 'done') return 'done';
  if (race.status === 'betting') return now >= race.bet_close ? 'bet_closed' : 'betting';
  if (now < race.entry_open) return 'upcoming';
  return now < race.entry_close ? 'entry_open' : 'entry_closed';
}

function parseTrack(raw: string | null): { distance: number; going: string } | null {
  if (!raw) return null;
  const t = JSON.parse(raw) as { distance: number; going: string };
  return { distance: t.distance, going: t.going };
}

function breedParentOf(h: HorseView, ownerId: string): BreedParent {
  return {
    id: h.id,
    ownerId,
    name: h.name,
    stats: h.stats,
    coat: h.coat,
    races: h.races,
    generation: h.generation,
    maturesAt: h.maturesAt,
    lastBredAt: h.lastBredAt,
    foalCount: h.foalCount,
  };
}

export function registerHorseRoutes(kit: ActivityKit): void {
  const { app } = kit;
  const race = () => kit.services.games.race;
  const breeding = () => kit.services.games.breeding;
  const inventory = new Inventory(kit.store);

  /** The first response per key, replayed for repeats; the balance is always read fresh. */
  function write<T extends object>(
    session: SessionClaims,
    key: string,
    scope: string,
    request: unknown,
    fn: () => T,
  ): T & Idem & { balance: number } {
    const { response, replayed } = kit.idem.run(
      { guildId: session.gid, userId: session.sub },
      key,
      scope,
      request,
      fn,
    );
    return { ...response, replayed, balance: kit.economy.getBalance(session.gid, session.sub) };
  }

  function infoOf(session: SessionClaims, h: HorseView): HorseInfo {
    const row = race().horseRow(h.id) as HorseRow;
    const parents = h.parentIds
      ? (h.parentIds.map((id) => ({
          id,
          name: race().horseRow(id)?.name ?? '?',
        })) as HorseInfo['parents'])
      : null;
    const bad = parentError(breedParentOf(h, session.sub), session.sub, kit.clock.now());
    return {
      id: h.id,
      name: h.name,
      coat: h.coat,
      silks: h.silks,
      stats: h.stats,
      style: h.style,
      autoStyle: h.autoStyle,
      races: h.races,
      wins: h.wins,
      places: h.places,
      retireValue: h.retireValue,
      generation: h.generation,
      parents,
      maturesAt: h.maturesAt,
      lastBredAt: h.lastBredAt,
      foalCount: h.foalCount,
      baseValue: h.baseValue,
      goldCarrotUsed: row.bonus >= GOLD_CARROT_MAX * 10,
      enteredRaceId: race().openRaceOf(h.id),
      breed: bad
        ? {
            ok: false,
            rule: bad.error === 'immature' ? 'foal_immature' : bad.error,
            ...(bad.at === undefined ? {} : { at: bad.at }),
          }
        : { ok: true },
    };
  }

  const stableOf = (session: SessionClaims): HorseView[] => race().stable(session.gid, session.sub);

  const infoById = (session: SessionClaims, id: number): HorseInfo => {
    const h = stableOf(session).find((x) => x.id === id);
    if (!h) throw new GameRuleError('select_own', {}, 'not_found');
    return infoOf(session, h);
  };

  // ------------------------------------------------------------------ stable

  app.get(HORSE_ROUTES.stable, (request): HorseStable => {
    const session = kit.session(request);
    const horses = stableOf(session).map((h) => infoOf(session, h));
    const qty = (item: string) => inventory.qty(session.gid, session.sub, item);
    return {
      now: kit.clock.now(),
      balance: kit.economy.getBalance(session.gid, session.sub),
      horses,
      items: {
        voucher: qty('horse_voucher'),
        carrot: qty('carrot'),
        goldCarrot: qty('gold_carrot'),
      },
      rules: RULES,
      breedingEnabled: breeding().isEnabled(session.gid),
      inDebt: breeding().isInDebt(session.gid, session.sub),
    };
  });

  app.post(HORSE_ROUTES.create, (request): HorseWriteResponse => {
    const session = kit.writer(request);
    const body = kit.body(HorseCreateRequest, request);
    const { idempotencyKey, ...intent } = body;
    return write(session, idempotencyKey, 'horse:create', intent, () => ({
      horse: infoOf(session, race().createHorse(session.gid, session.sub, intent)),
    }));
  });

  app.post(HORSE_ROUTES.carrot, (request): HorseWriteResponse => {
    const session = kit.writer(request);
    const { idempotencyKey, ...intent } = kit.body(HorseCarrotRequest, request);
    return write(session, idempotencyKey, 'horse:carrot', intent, () => ({
      horse: infoOf(
        session,
        race().carrot(session.gid, session.sub, intent.horseId, intent.from, intent.to),
      ),
    }));
  });

  app.post(HORSE_ROUTES.goldCarrot, (request): HorseWriteResponse => {
    const session = kit.writer(request);
    const { idempotencyKey, ...intent } = kit.body(HorseGoldCarrotRequest, request);
    return write(session, idempotencyKey, 'horse:gold-carrot', intent, () => ({
      horse: infoOf(
        session,
        race().goldCarrot(session.gid, session.sub, intent.horseId, intent.first, intent.second),
      ),
    }));
  });

  app.post(HORSE_ROUTES.style, (request): HorseWriteResponse => {
    const session = kit.writer(request);
    const { idempotencyKey, ...intent } = kit.body(HorseStyleRequest, request);
    return write(session, idempotencyKey, 'horse:style', intent, () => {
      race().setStyle(session.gid, session.sub, intent.horseId, intent.style);
      return { horse: infoById(session, intent.horseId) };
    });
  });

  app.post(HORSE_ROUTES.retire, (request): HorseRetireResponse => {
    const session = kit.writer(request);
    const { idempotencyKey, ...intent } = kit.body(HorseRetireRequest, request);
    return write(session, idempotencyKey, 'horse:retire', intent, () =>
      race().retire(session.gid, session.sub, intent.horseId),
    );
  });

  // ------------------------------------------------------------------ breeding

  app.get(HORSE_ROUTES.breedPreview, (request): HorseBreedPreview => {
    const session = kit.session(request);
    const q = kit.query(HorseBreedPreviewQuery, request);
    const p = breeding().preview(session.gid, session.sub, Number(q.a), Number(q.b));
    return {
      fee: BREED_FEE,
      total: p.total,
      stats: p.stats,
      coats: p.coats,
      randomCoatPercent: 10,
      generation: p.generation,
      eligible: {
        ok: p.eligible.ok,
        ...(p.eligible.rule === undefined ? {} : { rule: p.eligible.rule }),
        ...(p.eligible.at === undefined ? {} : { at: p.eligible.at }),
      },
      ...(p.eligible.horse === undefined ? {} : { ruleHorse: p.eligible.horse }),
      maturityMs: FOAL_MATURITY_MS,
    };
  });

  app.post(HORSE_ROUTES.breed, (request): HorseBreedResponse => {
    const session = kit.writer(request);
    const body = kit.body(HorseBreedRequest, request);
    // The breeding service keeps its own idempotency record (key, parents, foal), so a repeat
    // returns the stored foal without a second charge.
    const result = breeding().breed({ guildId: session.gid, userId: session.sub, ...body });
    return {
      replayed: result.replayed,
      balance: kit.economy.getBalance(session.gid, session.sub),
      breedingId: result.breedingId,
      fee: result.fee,
      foal: infoById(session, result.foal.id),
    };
  });

  // ------------------------------------------------------------------ races

  function summary(
    session: SessionClaims,
    row: RaceRow,
    now: number,
    entries: EntryRow[],
  ): HorseRaceSummary {
    const mine = entries.find((e) => e.owner_id === session.sub && e.horse_id !== null);
    const stake = race()
      .ticketsOf(row.id, session.sub)
      .reduce((sum, t) => sum + t.stake, 0);
    return {
      id: row.id,
      kind: row.kind,
      major: row.major === 1,
      status: row.status,
      phase: phaseOf(row, now),
      startAt: row.start_at,
      entryOpen: row.entry_open,
      entryClose: row.entry_close,
      betClose: row.bet_close,
      entrants: entries.length,
      track: parseTrack(row.track),
      myHorse: mine ? { id: mine.horse_id as number, name: mine.name } : null,
      myStake: stake,
      placings: row.placings ? (JSON.parse(row.placings) as number[]) : null,
    };
  }

  app.get(HORSE_ROUTES.card, (request): HorseCard => {
    const session = kit.session(request);
    // The midnight job creates the day; a server started later heals it here (INSERT OR IGNORE).
    if (race().listToday(session.gid).length === 0) race().ensureDay(session.gid);
    const now = kit.clock.now();
    return {
      now,
      races: race()
        .listToday(session.gid)
        .map((row) => summary(session, row, now, race().entriesOf(row.id))),
      nextStartAt: race().nextStart(session.gid),
    };
  });

  app.get(HORSE_ROUTES.race, (request): HorseRaceDetail => {
    const session = kit.session(request);
    const row = guildRace(kit, session, raceIdOf(request));
    const now = kit.clock.now();
    const entries = race().entriesOf(row.id);
    const closed = row.status !== 'entry';
    const runners: HorseRunner[] = entries.map((e) => {
      const live = e.horse_id === null ? undefined : race().horseRow(e.horse_id);
      const mine = e.owner_id === session.sub;
      const source = closed ? e : live;
      const show = closed || mine;
      return {
        lane: e.lane,
        name: e.name,
        silks: closed ? e.silks : (live?.silks ?? ''),
        coat: closed ? e.coat : (live?.coat ?? ''),
        mine,
        npc: e.horse_id === null,
        stats:
          show && source
            ? {
                speed: source.speed,
                stamina: source.stamina,
                power: source.power,
                guts: source.guts,
              }
            : null,
        style: show ? (closed ? e.style : (live?.style ?? null)) : null,
        form: closed ? e.form : null,
        races: closed ? e.races : (live?.races ?? 0),
        wins: closed ? e.wins : (live?.wins ?? 0),
        places: closed ? e.places : (live?.places ?? 0),
        horseId: e.horse_id,
      };
    });
    const enterable =
      row.status === 'entry' && now >= row.entry_open && now < row.entry_close
        ? stableOf(session)
            .filter(
              (h) =>
                h.races < MAX_RACES &&
                (h.maturesAt === null || now >= h.maturesAt) &&
                (row.kind === 'special' || race().openRaceOf(h.id) === null) &&
                entries.length < FIELD_SIZE &&
                !entries.some((e) => e.owner_id === session.sub || e.name === h.name),
            )
            .map((h) => h.id)
        : [];
    return {
      now,
      race: summary(session, row, now, entries),
      runners,
      odds: closed ? race().card(row.id).odds : {},
      tickets: race().ticketsOf(row.id, session.sub),
      myPrize: race().prizeOf(session.gid, session.sub, row.id),
      enterable,
      hasTimeline: race().timeline(row.id) !== null,
    };
  });

  app.get(HORSE_ROUTES.timeline, (request): HorseTimeline => {
    const session = kit.session(request);
    const row = guildRace(kit, session, raceIdOf(request));
    const timeline = race().timeline(row.id);
    if (!timeline) throw new GameRuleError('race_not_done', {}, 'not_found');
    return {
      raceId: timeline.raceId,
      track: { distance: timeline.track.distance, going: timeline.track.going },
      runners: timeline.runners.map((r) => ({
        lane: r.lane,
        name: r.name,
        silks: r.silks,
        mine: r.ownerId === session.sub,
      })),
      frames: timeline.frames,
      placings: timeline.placings,
    };
  });

  app.post(HORSE_ROUTES.enter, (request): HorseWriteResponse => {
    const session = kit.writer(request);
    const id = raceIdOf(request);
    guildRace(kit, session, id);
    const { idempotencyKey, ...intent } = kit.body(HorseEntryRequest, request);
    return write(session, idempotencyKey, `horse:enter:${id}`, intent, () => {
      race().register(session.gid, session.sub, id, intent.horseId);
      return { horse: infoById(session, intent.horseId) };
    });
  });

  app.post(HORSE_ROUTES.withdraw, (request): HorseWriteResponse => {
    const session = kit.writer(request);
    const id = raceIdOf(request);
    guildRace(kit, session, id);
    const { idempotencyKey, ...intent } = kit.body(HorseEntryRequest, request);
    return write(session, idempotencyKey, `horse:withdraw:${id}`, intent, () => {
      race().withdraw(session.gid, session.sub, id, intent.horseId);
      return { horse: infoById(session, intent.horseId) };
    });
  });

  app.post(HORSE_ROUTES.bet, (request) => {
    const session = kit.writer(request);
    const id = raceIdOf(request);
    guildRace(kit, session, id);
    const { idempotencyKey, ...intent } = kit.body(HorseBetRequest, request);
    return write(session, idempotencyKey, `horse:bet:${id}`, intent, () =>
      race().bet({
        guildId: session.gid,
        userId: session.sub,
        raceId: id,
        kind: intent.kind as BetKind,
        lanes: intent.lanes,
        stake: intent.stake,
        idempotencyKey,
      }),
    );
  });

  registerArenaRoutes(kit);
}
