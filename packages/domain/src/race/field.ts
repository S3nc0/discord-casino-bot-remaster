import type { Rng } from '@casino/shared';
import { binomial, weightedIndex } from '../progression/py-random.ts';
import { shuffle } from '@casino/shared';
import { COATS, SILKS, STAT_MAX, STAT_MIN, STAT_TOTAL, styleOf, type Stats } from './horse.ts';
import { DISTANCES, GOINGS, type Form, type Runner, type Track } from './sim.ts';
import { FIELD_SIZE } from './schedule.ts';

export const NPC_NAMES = [
  'ハヤテノツバサ',
  'ミッドナイトブルー',
  'サクラフブキ',
  'ゴールデンキャロット',
  'カミナリボルト',
  'ダイヤモンドロード',
  'ナイトメアランナー',
  'ツキノヒカリ',
  'アカツキレッド',
  'シルバーアロー',
  'ドリームチェイサー',
  'イナズマライダー',
  'ブラックサンダー',
  'ハルノオトメ',
  'ワイルドハート',
  'ロイヤルクラウン',
  'キタノカゼ',
  'スターライトダッシュ',
  'ホワイトファング',
  'ユメノツヅキ',
  'ライジングサン',
  'オオゾラノキセキ',
  'ジェットストリーム',
  'ミラクルバンブー',
  'ブルーコメット',
  'アサヒノプリンス',
  'テンカイチ',
  'ニチダイラグビー',
  'アリジゴク',
  'トンデミーナ',
] as const;

const STAT_UNIT = 5;

/** NPC stats: skewed raw draws scaled to a total of 200 in steps of 5, each within 20..80. */
export function randomStats(rng: Rng): Stats {
  for (;;) {
    const raw = [0, 1, 2, 3].map(() => rng.float() ** 3 + 0.08);
    const total = raw.reduce((a, b) => a + b, 0);
    const units = (STAT_TOTAL - 4 * STAT_MIN) / STAT_UNIT;
    const vals = raw.map((x) => STAT_MIN + STAT_UNIT * Math.round((x / total) * units));
    vals[0] = (vals[0] as number) + (STAT_TOTAL - vals.reduce((a, b) => a + b, 0));
    if (vals.every((v) => v >= STAT_MIN && v <= STAT_MAX)) {
      return {
        speed: vals[0] as number,
        stamina: vals[1] as number,
        power: vals[2] as number,
        guts: vals[3] as number,
      };
    }
  }
}

/** Fake record for an NPC: 0..12 starts, 1/8 win rate, 2/7 of the rest placing. */
export function npcRecord(rng: Rng): { races: number; wins: number; places: number } {
  const races = rng.int(0, 13);
  const wins = binomial(rng, races, 1 / 8);
  const places = wins + binomial(rng, races - wins, 2 / 7);
  return { races, wins, places };
}

/** Form: ◎ 2/9, ○ 5/9, △ 2/9. */
export function randomForm(rng: Rng): Form {
  return ([1, 0, -1] as const)[weightedIndex(rng, [2, 5, 2])] as Form;
}

export function randomTrack(rng: Rng): Track {
  const distance = DISTANCES[rng.int(0, DISTANCES.length)] as number;
  const going = GOINGS[
    weightedIndex(
      rng,
      GOINGS.map((g) => g.weight),
    )
  ] as (typeof GOINGS)[number];
  return { distance, going: going.name };
}

/** One entrant of the closed field: a player's horse snapshot or an NPC. */
export interface Entrant extends Runner {
  /** Player horse id, or null for an NPC. */
  horseId: number | null;
  ownerId: string | null;
  silks: string;
  coat: string;
}

export interface Registered {
  horseId: number;
  ownerId: string;
  name: string;
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  style: Runner['style'] | null;
  races: number;
  wins: number;
  places: number;
  silks: string;
  coat: string;
}

/**
 * Close the entries: snapshot the registered horses, fill up to 8 with NPCs, shuffle into
 * lanes 1..8 and draw each runner's form. Returns the field, the track and the lane order.
 */
export function closeEntries(
  registered: readonly Registered[],
  rng: Rng,
): { entrants: Entrant[]; track: Track } {
  const rows: Omit<Entrant, 'lane' | 'form'>[] = registered.map((h) => ({
    horseId: h.horseId,
    ownerId: h.ownerId,
    name: h.name,
    speed: h.speed,
    stamina: h.stamina,
    power: h.power,
    guts: h.guts,
    style: h.style ?? styleOf(h),
    races: h.races,
    wins: h.wins,
    places: h.places,
    silks: h.silks,
    coat: h.coat,
  }));
  const usedNames = new Set(rows.map((r) => r.name));
  const pool = shuffle(
    rng,
    NPC_NAMES.filter((n) => !usedNames.has(n)),
  );
  const usage = new Map<string, number>(SILKS.map((s) => [s, 0]));
  for (const r of rows) usage.set(r.silks, (usage.get(r.silks) ?? 0) + 1);
  while (rows.length < FIELD_SIZE) {
    const stats = randomStats(rng);
    const record = npcRecord(rng);
    const least = Math.min(...usage.values());
    const candidates = SILKS.filter((s) => usage.get(s) === least);
    const silks = candidates[rng.int(0, candidates.length)] as string;
    usage.set(silks, (usage.get(silks) ?? 0) + 1);
    rows.push({
      horseId: null,
      ownerId: null,
      name: pool.shift() ?? `帝愛${rows.length}号`,
      ...stats,
      style: styleOf(stats),
      ...record,
      silks,
      coat: COATS[rng.int(0, COATS.length)] as string,
    });
  }
  const shuffled = shuffle(rng, rows);
  const entrants: Entrant[] = shuffled.map((r, i) => ({
    ...r,
    lane: i + 1,
    form: randomForm(rng),
  }));
  return { entrants, track: randomTrack(rng) };
}
