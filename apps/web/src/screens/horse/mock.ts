import type {
  ArenaFighter,
  ArenaMyBet,
  ArenaToday,
  ArenaTournament,
  HorseBetKind,
  HorseCard,
  HorseInfo,
  HorseOddsTable,
  HorseRaceDetail,
  HorseRaceSummary,
  HorseRules,
  HorseRunner,
  HorseStable,
  HorseStat,
  HorseTicket,
  HorseTimeline,
  RacePhase,
} from '@casino/shared';
import { HORSE_PICKS_NEEDED, HORSE_STATS } from '@casino/shared';
import { HorseApiError, type HorseApi } from './api.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;

const RULES: HorseRules = {
  maxHorses: 3,
  maxRaces: 32,
  nameMax: 12,
  entryFee: 1000,
  breedFee: 15_000,
  minStake: 100,
  maxStake: 50_000,
  maxRaceStake: 150_000,
  breedMinRaces: 4,
  maxFoals: 2,
  breedCooldownMs: 72 * HOUR,
  foalMaturityMs: 48 * HOUR,
};

const sum = (s: Record<HorseStat, number>) => s.speed + s.stamina + s.power + s.guts;

function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

const NPC_NAMES = [
  '帝愛一号',
  '帝愛二号',
  '帝愛三号',
  '帝愛四号',
  '帝愛五号',
  '帝愛六号',
  '帝愛七号',
];
const NPC_EN = ['Teiai One', 'Teiai Two', 'Teiai Three', 'Teiai Four', 'Teiai Five', 'Teiai Six'];
void NPC_EN;
const SILKS_CYCLE = ['🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜'];
const COATS_CYCLE = ['栗毛', '鹿毛', '黒鹿毛', '青毛', '芦毛', '白毛', '栃栗毛', '月毛'];

interface MockRace {
  id: number;
  major: boolean;
  startAt: number;
  runners: HorseRunner[];
  placings: number[] | null;
  timeline: HorseTimeline | null;
  tickets: HorseTicket[];
  myHorseId: number | null;
  myPrize: number;
  track: { distance: number; going: string };
}

function makeRunners(
  seed: number,
  mine: { name: string; silks: string; coat: string; id: number }[],
): HorseRunner[] {
  const rand = lcg(seed);
  const runners: HorseRunner[] = [];
  const names = [...mine.map((m) => m.name), ...NPC_NAMES];
  for (let i = 0; i < 8; i++) {
    const own = mine[i];
    const total = 200;
    const a = 40 + Math.floor(rand() * 5) * 5;
    const b = 40 + Math.floor(rand() * 5) * 5;
    const c = 40 + Math.floor(rand() * 5) * 5;
    const d = total - a - b - c;
    runners.push({
      lane: i + 1,
      name: names[i] ?? `Runner ${i + 1}`,
      silks: own?.silks ?? SILKS_CYCLE[(i + 3) % 8]!,
      coat: own?.coat ?? COATS_CYCLE[(i + 2) % 8]!,
      mine: own !== undefined,
      npc: own === undefined,
      stats: { speed: a, stamina: b, power: c, guts: Math.min(80, Math.max(20, d)) },
      style: ['nige', 'senko', 'sashi', 'oikomi'][i % 4] as HorseRunner['style'],
      form: [1, 0, -1, 0, 0, 1, 0, -1][i] ?? 0,
      races: Math.floor(rand() * 12),
      wins: Math.floor(rand() * 3),
      places: Math.floor(rand() * 5),
      horseId: own?.id ?? null,
    });
  }
  return runners;
}

function makeOdds(runners: HorseRunner[]): HorseOddsTable {
  const strength = runners.map((r) => (r.stats ? sum(r.stats) + (r.form ?? 0) * 6 : 200));
  const total = strength.reduce((s, x) => s + x * x, 0);
  const winP = strength.map((x) => (x * x) / total);
  const odds = (p: number, take: number, cap: number) =>
    Math.max(10, Math.min(cap, Math.floor(((1 - take) / p) * 10)));
  const table: HorseOddsTable = {
    win: {},
    place: {},
    quinella: {},
    wide: {},
    exacta: {},
    trio: {},
    trifecta: {},
  };
  const lanes = runners.map((r) => r.lane);
  for (const a of lanes) {
    table.win![String(a)] = odds(winP[a - 1]!, 0.15, 999);
    table.place![String(a)] = odds(Math.min(0.95, winP[a - 1]! * 2.6), 0.15, 999);
    for (const b of lanes) {
      if (a === b) continue;
      const pab = winP[a - 1]! * (winP[b - 1]! / (1 - winP[a - 1]!));
      table.exacta![`${a}>${b}`] = odds(pab, 0.2, 1000);
      if (a < b) {
        const pq = pab + winP[b - 1]! * (winP[a - 1]! / (1 - winP[b - 1]!));
        table.quinella![`${a}-${b}`] = odds(pq, 0.2, 1000);
        table.wide![`${a}-${b}`] = odds(Math.min(0.9, pq * 2.4), 0.2, 1000);
      }
      for (const c of lanes) {
        if (c === a || c === b) continue;
        const pabc = pab * (winP[c - 1]! / (1 - winP[a - 1]! - winP[b - 1]!));
        table.trifecta![`${a}>${b}>${c}`] = odds(pabc, 0.2, 1000);
        if (a < b && b < c)
          table.trio![`${a}-${b}-${c}`] = odds(Math.min(0.9, pabc * 6), 0.2, 1000);
      }
    }
  }
  return table;
}

function makeTimeline(
  raceId: number,
  runners: HorseRunner[],
  track: { distance: number; going: string },
): HorseTimeline {
  const rand = lcg(raceId * 7919);
  const finish = runners.map(
    (r, i) =>
      54 +
      Math.round((8 - (r.stats ? sum(r.stats) / 25 : 8)) * 1.6) +
      Math.floor(rand() * 5) +
      i * 0,
  );
  const frames: number[][] = [];
  const total = Math.max(...finish);
  const steps = runners.map((_, i) => {
    const raw = Array.from({ length: finish[i]! }, () => 0.7 + rand() * 0.6);
    const s = raw.reduce((a, b) => a + b, 0);
    return raw.map((x) => (x / s) * 1000);
  });
  const pos = runners.map(() => 0);
  for (let t = 0; t < total; t++) {
    runners.forEach((_, i) => {
      pos[i] = t < finish[i]! ? Math.min(1000, pos[i]! + steps[i]![t]!) : 1000;
    });
    frames.push(pos.map((p) => Math.round(p)));
  }
  const placings = runners
    .map((r, i) => ({ lane: r.lane, t: finish[i]! + i * 0.001 }))
    .sort((a, b) => a.t - b.t)
    .map((x) => x.lane);
  return {
    raceId,
    track,
    runners: runners.map((r) => ({ lane: r.lane, name: r.name, silks: r.silks, mine: r.mine })),
    frames,
    placings,
  };
}

/** In-memory stand-in for the horse and arena endpoints (mock Discord mode, tests, screenshots). */
export function createMockHorseApi(
  options: { now?: () => number; balance?: number } = {},
): HorseApi {
  const now = options.now ?? (() => Date.now());
  const t0 = now();
  // Enough for a breeding (15,000); the shell's mock balance only shows until the first write.
  let balance = options.balance ?? 42_400;
  const items = { voucher: 1, carrot: 2, goldCarrot: 1 };
  let nextId = 4;
  let nextTicket = 1;
  const horses: HorseInfo[] = [
    horse(
      1,
      'サニーダッシュ',
      '鹿毛',
      '🟦',
      { speed: 60, stamina: 45, power: 50, guts: 45 },
      9,
      3,
      5,
    ),
    horse(
      2,
      'ムーンペブル',
      '芦毛',
      '🟩',
      { speed: 45, stamina: 60, power: 50, guts: 45 },
      6,
      1,
      2,
    ),
  ];
  function horse(
    id: number,
    name: string,
    coat: string,
    silks: string,
    stats: Record<HorseStat, number>,
    races: number,
    wins: number,
    places: number,
  ): HorseInfo {
    return {
      id,
      name,
      coat,
      silks,
      stats,
      style: null,
      autoStyle: 'nige',
      races,
      wins,
      places,
      retireValue:
        wins * 5000 + Math.max(0, places - wins) * 2000 - Math.max(0, races - places) * 2000,
      generation: 0,
      parents: null,
      maturesAt: null,
      lastBredAt: null,
      foalCount: 0,
      baseValue: 30_000,
      goldCarrotUsed: false,
      enteredRaceId: null,
      breed: { ok: true },
    };
  }

  const refreshBreed = () => {
    for (const h of horses) {
      h.breed = { ok: true };
      if (h.races < RULES.breedMinRaces) h.breed = { ok: false, rule: 'min_races' };
      else if (h.maturesAt !== null && now() < h.maturesAt)
        h.breed = { ok: false, rule: 'foal_immature', at: h.maturesAt };
      else if (h.foalCount >= RULES.maxFoals) h.breed = { ok: false, rule: 'foal_limit' };
      else if (h.lastBredAt !== null && now() < h.lastBredAt + RULES.breedCooldownMs)
        h.breed = { ok: false, rule: 'cooldown', at: h.lastBredAt + RULES.breedCooldownMs };
    }
  };

  const mine = () => horses.map((h) => ({ name: h.name, silks: h.silks, coat: h.coat, id: h.id }));
  const races: MockRace[] = [
    {
      id: 101,
      major: false,
      startAt: t0 - 50 * MIN,
      runners: makeRunners(11, [mine()[0]!]),
      placings: null,
      timeline: null,
      tickets: [],
      myHorseId: 1,
      myPrize: 0,
      track: { distance: 1600, going: '良' },
    },
    {
      id: 102,
      major: false,
      startAt: t0 + 25 * MIN,
      runners: makeRunners(21, [mine()[1]!]),
      placings: null,
      timeline: null,
      tickets: [],
      myHorseId: 2,
      myPrize: 0,
      track: { distance: 2000, going: '稍重' },
    },
    {
      id: 103,
      major: false,
      startAt: t0 + 95 * MIN,
      runners: [],
      placings: null,
      timeline: null,
      tickets: [],
      myHorseId: null,
      myPrize: 0,
      track: { distance: 1200, going: '良' },
    },
    {
      id: 104,
      major: true,
      startAt: t0 + 4.5 * HOUR,
      runners: [],
      placings: null,
      timeline: null,
      tickets: [],
      myHorseId: null,
      myPrize: 0,
      track: { distance: 2400, going: '良' },
    },
  ];
  // Race 101 is done: run it once, with one paid ticket.
  const done = races[0]!;
  done.timeline = makeTimeline(done.id, done.runners, done.track);
  done.placings = done.timeline.placings;
  done.myPrize = done.placings.indexOf(1) < 3 ? 5000 : 0;
  const oddsOf: Record<number, HorseOddsTable> = {
    101: makeOdds(done.runners),
    102: makeOdds(races[1]!.runners),
  };
  const winLane = done.placings[0]!;
  done.tickets = [
    {
      id: nextTicket++,
      kind: 'win',
      key: String(winLane),
      stake: 500,
      oddsTenths: oddsOf[101]!.win![String(winLane)]!,
      payout: Math.floor((500 * oddsOf[101]!.win![String(winLane)]!) / 10),
    },
    { id: nextTicket++, kind: 'place', key: '1', stake: 300, oddsTenths: 18, payout: null },
  ];
  if (done.placings.slice(0, 3).includes(1)) done.tickets[1]!.payout = Math.floor((300 * 18) / 10);
  else done.tickets[1]!.payout = 0;
  // Race 103 and 104 start with a few registered horses.
  races[2]!.runners = [3, 5, 2].map((i) => ({
    ...makeRunners(31, [])[i]!,
    lane: -1,
    mine: false,
    stats: null,
    form: null,
    style: null,
  }));

  const phaseOf = (r: MockRace): RacePhase => {
    const t = now();
    const entryOpen = r.startAt - 120 * MIN;
    const entryClose = r.startAt - 60 * MIN;
    const betClose = r.startAt - 2 * MIN;
    if (r === done || t >= r.startAt) return 'done';
    if (t < entryOpen) return 'upcoming';
    if (t < entryClose) return 'entry_open';
    return t < betClose ? 'betting' : 'bet_closed';
  };
  const summaryOf = (r: MockRace): HorseRaceSummary => {
    const phase = phaseOf(r);
    const my = r.runners.find((x) => x.mine);
    return {
      id: r.id,
      kind: 'regular',
      major: r.major,
      status:
        phase === 'done'
          ? 'done'
          : phase === 'betting' || phase === 'bet_closed'
            ? 'betting'
            : 'entry',
      phase,
      startAt: r.startAt,
      entryOpen: r.startAt - 120 * MIN,
      entryClose: r.startAt - 60 * MIN,
      betClose: r.startAt - 2 * MIN,
      entrants: r.runners.length,
      track: phase === 'entry_open' || phase === 'upcoming' ? null : r.track,
      myHorse: my ? { id: my.horseId!, name: my.name } : null,
      myStake: r.tickets.reduce((s, t) => s + t.stake, 0),
      placings: phase === 'done' ? r.placings : null,
    };
  };
  const find = (id: number): MockRace => {
    const r = races.find((x) => x.id === id);
    if (!r) throw new HorseApiError('not_found', 404, 'race_not_found');
    return r;
  };
  const stableInfo = (): HorseInfo[] => {
    refreshBreed();
    for (const h of horses)
      h.enteredRaceId =
        races.find((r) => phaseOf(r) !== 'done' && r.runners.some((x) => x.horseId === h.id))?.id ??
        null;
    return structuredClone(horses);
  };
  const need = (id: number): HorseInfo => {
    const h = horses.find((x) => x.id === id);
    if (!h) throw new HorseApiError('not_found', 404, 'select_own');
    return h;
  };
  const write = <T extends object>(body: T) => ({ replayed: false, balance, ...body });
  const take = (item: keyof typeof items, rule: string) => {
    if (items[item] < 1) throw new HorseApiError('conflict', 409, rule);
    items[item] -= 1;
  };

  // ---- arena ----
  const fighterNames = [
    '鉄拳のゴウ',
    '灼熱のレイジ',
    '黒影のクロウ',
    '修羅のバキ',
    '氷牙のユキ',
    '雷鳴のライ',
    '鬼哭のオニマル',
    '疾風のハヤテ',
    '剛腕のゴリウス',
    '影狼のシノビ',
    '爆砕のデストロ',
    '不死身のゾンバ',
    '蛇瞳のメデューサ',
    '怒髪のバーサーカー',
    '無敵のタイタン',
    '影帝のシャドウキング',
  ];
  const arenaBets: ArenaMyBet[] = [];
  const arenaPool = new Map<number, number>();
  const fightersFor = (
    tid: number,
    count: number,
    perGroup: number,
    stage: 'semi' | 'final',
  ): ArenaFighter[] => {
    const rand = lcg(tid * 31);
    return Array.from({ length: count }, (_, i) => {
      const id = tid * 100 + i + 1;
      const base = 20 + Math.floor(rand() * 60);
      const pool = (arenaPool.get(id) ?? 0) + Math.floor(rand() * 9) * 1500;
      return {
        id,
        name: fighterNames[i % 16]!,
        basePower: base,
        group: Math.floor(i / perGroup) + 1,
        stage,
        result: null,
        betTotal: pool,
        weaponPercent: Math.min(100, Math.round((pool / 50_000) * 100)),
        oddsHundredths: 0,
        myStake: 0,
      };
    });
  };
  const oddsFill = (fs: ArenaFighter[], boost: number): void => {
    const groups = new Set(fs.filter((f) => f.stage !== 'out').map((f) => f.group));
    for (const g of groups) {
      const grp = fs.filter((f) => f.group === g && f.stage !== 'out');
      const power = grp.map((f) => f.basePower * (1 + Math.min(1, f.betTotal / 50_000)));
      const total = power.reduce((a, b) => a + b, 0);
      grp.forEach((f, i) => {
        f.oddsHundredths = Math.min(
          2000,
          Math.floor(
            Math.max(10, Math.min(200, Math.floor((0.85 / (power[i]! / total)) * 10))) * 10 * boost,
          ),
        );
      });
    }
  };
  const tournaments = (): ArenaTournament[] => {
    const day = new Date(t0).toISOString().slice(0, 10);
    const duelFighters = fightersFor(1, 4, 2, 'semi').map((f, i) => ({
      ...f,
      stage: i === 0 || i === 2 ? ('final' as const) : ('out' as const),
      result: i === 0 || i === 2 ? null : ('lost' as const),
      group: i < 2 ? 1 : 2,
    }));
    duelFighters.forEach((f) => (f.betTotal += arenaPool.get(f.id) ?? 0));
    oddsFill(duelFighters, 1.3);
    const royale = fightersFor(2, 16, 4, 'semi');
    royale.forEach((f) => (f.betTotal += arenaPool.get(f.id) ?? 0));
    oddsFill(royale, 1);
    const withMine = (fs: ArenaFighter[], stage: 'semi' | 'final') =>
      fs.map((f) => ({
        ...f,
        weaponPercent: Math.min(100, Math.round((f.betTotal / 50_000) * 100)),
        myStake: arenaBets
          .filter((b) => b.fighterId === f.id && b.stage === stage)
          .reduce((s, b) => s + b.amount, 0),
      }));
    return [
      {
        id: 1,
        format: 'duel',
        day,
        status: 'final_betting',
        championId: null,
        fighters: withMine(duelFighters, 'final'),
        myBets: arenaBets.filter((b) => Math.floor(b.fighterId / 100) === 1),
        semiAt: t0 - 3 * HOUR,
        finalAt: t0 + 2 * HOUR,
      },
      {
        id: 2,
        format: 'royale',
        day,
        status: 'semi_betting',
        championId: null,
        fighters: withMine(royale, 'semi'),
        myBets: arenaBets.filter((b) => Math.floor(b.fighterId / 100) === 2),
        semiAt: t0 + 1 * HOUR,
        finalAt: t0 + 5 * HOUR,
      },
    ];
  };

  return {
    stable: (): Promise<HorseStable> =>
      Promise.resolve({
        now: now(),
        balance,
        horses: stableInfo(),
        items: { ...items },
        rules: RULES,
        breedingEnabled: true,
        inDebt: false,
      }),
    createHorse: (i) => {
      if (horses.length >= RULES.maxHorses)
        throw new HorseApiError('conflict', 409, 'max_owned', { max_horses: 3 });
      take('voucher', 'no_voucher');
      const h = horse(
        nextId++,
        i.name,
        i.coat,
        i.silks,
        { speed: 50, stamina: 50, power: 50, guts: 50 },
        0,
        0,
        0,
      );
      horses.push(h);
      return Promise.resolve(write({ horse: structuredClone(h) }));
    },
    carrot: (i) => {
      const h = need(i.horseId);
      if (i.from === i.to) throw new HorseApiError('invalid_payload', 400, 'select_distinct_stats');
      if (h.stats[i.from] - 5 < 20)
        throw new HorseApiError('invalid_payload', 400, 'stat_at_min', { stat: i.from });
      if (h.stats[i.to] + 5 > 80)
        throw new HorseApiError('invalid_payload', 400, 'stat_at_max', { stat: i.to });
      take('carrot', 'no_carrot');
      h.stats[i.from] -= 5;
      h.stats[i.to] += 5;
      return Promise.resolve(write({ horse: structuredClone(h) }));
    },
    goldCarrot: (i) => {
      const h = need(i.horseId);
      if (h.goldCarrotUsed)
        throw new HorseApiError('conflict', 409, 'gold_carrot_max', { max_count: 1 });
      take('goldCarrot', 'no_gold_carrot');
      h.stats[i.first] += 5;
      h.stats[i.second] += 5;
      h.goldCarrotUsed = true;
      return Promise.resolve(write({ horse: structuredClone(h) }));
    },
    style: (i) => {
      const h = need(i.horseId);
      h.style = i.style;
      return Promise.resolve(write({ horse: structuredClone(h) }));
    },
    retire: (i) => {
      const h = need(i.horseId);
      if (stableInfo().find((x) => x.id === h.id)?.enteredRaceId)
        throw new HorseApiError('conflict', 409, 'busy_no_retire');
      horses.splice(horses.indexOf(h), 1);
      balance += h.retireValue;
      return Promise.resolve({ replayed: false, balance, value: h.retireValue });
    },
    breedPreview: (a, b) => {
      const pa = need(a);
      const pb = need(b);
      const total = (sum(pa.stats) + sum(pb.stats)) / 2;
      const range = (k: HorseStat) => {
        const mid = Math.round((pa.stats[k] + pb.stats[k]) / 2 / 5) * 5;
        return { min: Math.max(20, mid - 10), max: Math.min(80, mid + 10) };
      };
      refreshBreed();
      const bad =
        a === b
          ? { ok: false, rule: 'same_horse' }
          : !pa.breed.ok
            ? pa.breed
            : !pb.breed.ok
              ? pb.breed
              : null;
      const eligible =
        bad ??
        (horses.length >= RULES.maxHorses
          ? { ok: false, rule: 'stable_full' }
          : balance < RULES.breedFee
            ? { ok: false, rule: 'breed_fee_short' }
            : { ok: true });
      return Promise.resolve({
        fee: RULES.breedFee,
        total: {
          min: Math.max(190, Math.floor(total) - 10),
          max: Math.min(210, Math.floor(total) + 10),
        },
        stats: {
          speed: range('speed'),
          stamina: range('stamina'),
          power: range('power'),
          guts: range('guts'),
        },
        coats: [pa.coat, pb.coat] as [string, string],
        randomCoatPercent: 10,
        generation: Math.max(pa.generation, pb.generation) + 1,
        eligible,
        maturityMs: RULES.foalMaturityMs,
      });
    },
    breed: (i) => {
      const pa = need(i.parentA);
      const pb = need(i.parentB);
      if (horses.length >= RULES.maxHorses) throw new HorseApiError('conflict', 409, 'stable_full');
      if (balance < RULES.breedFee)
        throw new HorseApiError('conflict', 409, 'breed_fee_short', { fee: RULES.breedFee });
      balance -= RULES.breedFee;
      pa.lastBredAt = pb.lastBredAt = now();
      pa.foalCount += 1;
      pb.foalCount += 1;
      const foal = horse(
        nextId++,
        i.name,
        pa.coat,
        i.silks,
        { speed: 50, stamina: 55, power: 50, guts: 45 },
        0,
        0,
        0,
      );
      foal.generation = Math.max(pa.generation, pb.generation) + 1;
      foal.parents = [
        { id: pa.id, name: pa.name },
        { id: pb.id, name: pb.name },
      ];
      foal.maturesAt = now() + RULES.foalMaturityMs;
      foal.baseValue = RULES.breedFee;
      horses.push(foal);
      return Promise.resolve({
        replayed: false,
        balance,
        breedingId: nextId,
        fee: RULES.breedFee,
        foal: structuredClone(foal),
      });
    },
    card: (): Promise<HorseCard> =>
      Promise.resolve({
        now: now(),
        races: races.map(summaryOf),
        nextStartAt: races.find((r) => phaseOf(r) !== 'done')?.startAt ?? null,
      }),
    race: (id): Promise<HorseRaceDetail> => {
      const r = find(id);
      const phase = phaseOf(r);
      const closed = phase === 'betting' || phase === 'bet_closed' || phase === 'done';
      const enterable =
        phase === 'entry_open' && !r.runners.some((x) => x.mine)
          ? stableInfo()
              .filter(
                (h) => h.enteredRaceId === null && (h.maturesAt === null || now() >= h.maturesAt),
              )
              .map((h) => h.id)
          : [];
      return Promise.resolve({
        now: now(),
        race: summaryOf(r),
        runners: structuredClone(r.runners),
        odds: closed ? (oddsOf[r.id] ?? {}) : {},
        tickets: structuredClone(r.tickets),
        myPrize: r.myPrize,
        enterable,
        hasTimeline: r.timeline !== null,
      });
    },
    timeline: (id) => {
      const r = find(id);
      if (!r.timeline) throw new HorseApiError('not_found', 404, 'race_not_done');
      return Promise.resolve(structuredClone(r.timeline));
    },
    enter: (id, i) => {
      const r = find(id);
      const h = need(i.horseId);
      if (phaseOf(r) !== 'entry_open') throw new HorseApiError('conflict', 409, 'entry_closed');
      if (balance < RULES.entryFee)
        throw new HorseApiError('conflict', 409, 'entry_fee_short', {
          fee: RULES.entryFee,
          balance,
        });
      balance -= RULES.entryFee;
      r.runners.push({
        lane: -1,
        name: h.name,
        silks: h.silks,
        coat: h.coat,
        mine: true,
        npc: false,
        stats: h.stats,
        style: h.style,
        form: null,
        races: h.races,
        wins: h.wins,
        places: h.places,
        horseId: h.id,
      });
      return Promise.resolve(write({ horse: structuredClone(h) }));
    },
    withdraw: (id, i) => {
      const r = find(id);
      const at = r.runners.findIndex((x) => x.horseId === i.horseId);
      if (at < 0) throw new HorseApiError('conflict', 409, 'not_entered');
      r.runners.splice(at, 1);
      balance += RULES.entryFee;
      return Promise.resolve(write({ horse: structuredClone(need(i.horseId)) }));
    },
    bet: (id, i) => {
      const r = find(id);
      const phase = phaseOf(r);
      if (phase !== 'betting')
        throw new HorseApiError(
          'conflict',
          409,
          phase === 'bet_closed' ? 'bet_closed' : 'bet_unavailable',
        );
      const kind = i.kind as HorseBetKind;
      const lanes = i.lanes;
      if (lanes.length !== HORSE_PICKS_NEEDED[kind] || new Set(lanes).size !== lanes.length)
        throw new HorseApiError('invalid_payload', 400, 'select_distinct_horses');
      if (i.stake < RULES.minStake || i.stake > RULES.maxStake)
        throw new HorseApiError('invalid_payload', 400, 'stake_range', {
          min_stake: RULES.minStake,
          max_stake: RULES.maxStake,
        });
      const spent = r.tickets.reduce((s, t) => s + t.stake, 0);
      if (spent + i.stake > RULES.maxRaceStake)
        throw new HorseApiError('invalid_payload', 400, 'max_stake', {
          max_race_stake: RULES.maxRaceStake,
        });
      if (balance < i.stake) throw new HorseApiError('insufficient_funds', 409);
      const key =
        kind === 'exacta' || kind === 'trifecta'
          ? lanes.join('>')
          : [...lanes].sort((x, y) => x - y).join(lanes.length === 1 ? '' : '-');
      const oddsTenths = oddsOf[r.id]?.[kind]?.[key] ?? 10;
      balance -= i.stake;
      const ticket: HorseTicket = {
        id: nextTicket++,
        kind,
        key,
        stake: i.stake,
        oddsTenths,
        payout: null,
      };
      r.tickets.push(ticket);
      return Promise.resolve({ replayed: false, balance, betId: ticket.id, oddsTenths });
    },
    arena: (): Promise<ArenaToday> =>
      Promise.resolve({
        now: now(),
        balance,
        minStake: 100,
        maxStake: 20_000,
        tournaments: tournaments(),
      }),
    arenaBet: (i) => {
      if (i.amount < 100 || i.amount > 20_000)
        throw new HorseApiError('invalid_payload', 400, 'stake_range', {
          min_stake: 100,
          max_stake: 20_000,
        });
      if (balance < i.amount) throw new HorseApiError('insufficient_funds', 409);
      const t = tournaments().find((x) => x.id === i.tournamentId);
      const f = t?.fighters.find((x) => x.id === i.fighterId);
      if (!t || !f || f.stage === 'out')
        throw new HorseApiError('conflict', 409, 'arena_fighter_out');
      balance -= i.amount;
      arenaBets.push({
        fighterId: f.id,
        stage: t.status === 'final_betting' ? 'final' : 'semi',
        amount: i.amount,
        payout: null,
      });
      arenaPool.set(f.id, (arenaPool.get(f.id) ?? 0) + i.amount);
      return Promise.resolve({ replayed: false, balance });
    },
  };
}

export { HORSE_STATS };
