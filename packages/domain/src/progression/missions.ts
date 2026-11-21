import type { GameId } from '@casino/shared';
import { PyRandom } from './py-random.ts';

export const MISSIONS_PER_DAY = 3;
export const MISSION_MIN_BET = 100;
export const MISSION_COMPLETE_BONUS = 500;
export const JACKPOT_MULTIPLIER = 50;

export type MissionKind =
  'play' | 'win' | 'wager' | 'streak' | 'play_game' | 'game_win' | 'tag' | 'big_win';

export interface Mission {
  id: string;
  /** Japanese name, kept for the legacy import and parity (the UI translates by id). */
  name: string;
  kind: MissionKind;
  target: number;
  reward: number;
  /** Legacy Japanese game name for game-specific missions. */
  game: string | null;
  tag: string | null;
}

/** Casino games that count for missions and the weekly ranking, with their legacy names. */
export const LEGACY_GAME_NAMES = {
  slots: 'スロット',
  roulette: 'ルーレット',
  chinchiro: 'チンチロ',
  blackjack: 'ブラックジャック',
  pachinko: 'パチンコ',
} as const satisfies Partial<Record<GameId, string>>;

export type MissionGame = keyof typeof LEGACY_GAME_NAMES;

export function isMissionGame(game: string): game is MissionGame {
  return Object.hasOwn(LEGACY_GAME_NAMES, game);
}

const GAMES = ['スロット', 'ルーレット', 'チンチロ', 'ブラックジャック', 'パチンコ'] as const;

function m(
  id: string,
  name: string,
  kind: MissionKind,
  target: number,
  reward: number,
  game: string | null = null,
  tag: string | null = null,
): Mission {
  return { id, name, kind, target, reward, game, tag };
}

export const UNIVERSAL: readonly Mission[] = [
  m('play5', 'ゲームを5回遊ぶ', 'play', 5, 300),
  m('play10', 'ゲームを10回遊ぶ', 'play', 10, 500),
  m('win3', '3回勝つ', 'win', 3, 400),
  m('win5', '5回勝つ', 'win', 5, 600),
  m('wager5k', '合計5,000ペリカ賭ける', 'wager', 5000, 400),
  m('wager20k', '合計20,000ペリカ賭ける', 'wager', 20_000, 700),
  m('streak2', '2連勝する', 'streak', 2, 400),
  m('streak3', '3連勝する', 'streak', 3, 700),
];

const OTHER_GAME_NAMES = GAMES.filter((g) => g !== 'ブラックジャック');

export const OTHER_GAMES: readonly Mission[] = [
  ...OTHER_GAME_NAMES.map((g) => m(`game_${g}`, `${g}を3回遊ぶ`, 'play_game', 3, 400, g)),
  ...OTHER_GAME_NAMES.map((g) => m(`gwin_${g}`, `${g}で2回勝つ`, 'game_win', 2, 600, g)),
];

export const BLACKJACK_MISSIONS: readonly Mission[] = [
  m('game_ブラックジャック', 'ブラックジャックを3回遊ぶ', 'play_game', 3, 300, 'ブラックジャック'),
  m('gwin_ブラックジャック', 'ブラックジャックで2回勝つ', 'game_win', 2, 400, 'ブラックジャック'),
  m(
    'bj_double',
    'ブラックジャックでダブルダウンに成功する',
    'tag',
    1,
    600,
    'ブラックジャック',
    'double_win',
  ),
  m('bj_natural', 'ナチュラルブラックジャックを出す', 'tag', 1, 700, 'ブラックジャック', 'natural'),
];

export const BIG_WIN: Mission = m('big3x', '賭け金の3倍以上の利益を1回で出す', 'big_win', 3, 600);

export const POOL: readonly Mission[] = [
  ...UNIVERSAL,
  ...OTHER_GAMES,
  ...BLACKJACK_MISSIONS,
  BIG_WIN,
];

export function missionById(id: string): Mission | undefined {
  return POOL.find((x) => x.id === id);
}

/** The day's three missions, identical for every guild. `dayIso` is `YYYY-MM-DD`. */
export function todayMissions(dayIso: string): Mission[] {
  const rng = new PyRandom(`mission:${dayIso}`);
  const first = rng.choice(UNIVERSAL);
  const second = rng.choice(BLACKJACK_MISSIONS);
  const third = rng.choice(POOL.filter((x) => x.id !== first.id && x.id !== second.id));
  return [first, second, third];
}

/** `net >= bet * 50` (celebration only). */
export function isJackpot(bet: number, net: number): boolean {
  return bet > 0 && net >= bet * JACKPOT_MULTIPLIER;
}

export interface Play {
  /** Legacy Japanese game name. */
  game: string;
  bet: number;
  net: number;
  tags: readonly string[];
}

/** Progress of one mission after a play (before clamping to the target). */
export function progressAfter(
  mission: Mission,
  current: number,
  play: Play,
  dayStreak: number,
): number {
  switch (mission.kind) {
    case 'play':
      return current + 1;
    case 'win':
      return current + (play.net > 0 ? 1 : 0);
    case 'wager':
      return current + play.bet;
    case 'streak':
      return Math.max(current, dayStreak);
    case 'big_win':
      return Math.max(current, play.net > 0 && play.bet > 0 ? Math.floor(play.net / play.bet) : 0);
    case 'play_game':
      return current + (play.game === mission.game ? 1 : 0);
    case 'game_win':
      return current + (play.game === mission.game && play.net > 0 ? 1 : 0);
    case 'tag':
      return current + (mission.tag !== null && play.tags.includes(mission.tag) ? 1 : 0);
  }
}

export interface PlayState {
  winStreak: number;
  bestStreak: number;
  dayStreak: number;
  streakDay: string | null;
  plays: number;
  wins: number;
  netTotal: number;
}

export const EMPTY_PLAY_STATE: PlayState = {
  winStreak: 0,
  bestStreak: 0,
  dayStreak: 0,
  streakDay: null,
  plays: 0,
  wins: 0,
  netTotal: 0,
};

export interface MissionRow {
  progress: number;
  done: boolean;
}

export interface PlayRecord {
  state: PlayState;
  /** Rows to upsert (only missions touched by this play). */
  rows: Map<string, MissionRow>;
  completed: Mission[];
  /** `MISSION_COMPLETE_BONUS` when this play finished the last of the day's missions. */
  bonus: number;
  newBest: boolean;
}

/**
 * One finished casino play: updates streaks and totals always; advances missions only for bets
 * of at least 100. `rows` holds today's mission rows (missing = 0 / not done).
 */
export function recordPlay(
  state: PlayState,
  rows: ReadonlyMap<string, MissionRow>,
  play: Play,
  dayIso: string,
): PlayRecord {
  const counts = play.bet >= MISSION_MIN_BET;
  let winStreak = state.winStreak;
  if (play.net > 0) winStreak += 1;
  else if (play.net < 0) winStreak = 0;
  const newBest = winStreak > state.bestStreak;

  let dayStreak = state.streakDay === dayIso ? state.dayStreak : 0;
  if (counts) {
    if (play.net > 0) dayStreak += 1;
    else if (play.net < 0) dayStreak = 0;
  }
  const next: PlayState = {
    winStreak,
    bestStreak: Math.max(state.bestStreak, winStreak),
    dayStreak: counts ? dayStreak : state.dayStreak,
    streakDay: counts ? dayIso : state.streakDay,
    plays: state.plays + 1,
    wins: state.wins + (play.net > 0 ? 1 : 0),
    netTotal: state.netTotal + play.net,
  };

  const updated = new Map<string, MissionRow>();
  const completed: Mission[] = [];
  if (counts) {
    for (const mission of todayMissions(dayIso)) {
      const row = rows.get(mission.id) ?? { progress: 0, done: false };
      if (row.done) continue;
      const progress = Math.min(
        progressAfter(mission, row.progress, play, dayStreak),
        mission.target,
      );
      const done = progress >= mission.target;
      updated.set(mission.id, { progress, done });
      if (done) completed.push(mission);
    }
  }
  let bonus = 0;
  if (completed.length > 0) {
    const doneCount = todayMissions(dayIso).filter(
      (x) => (updated.get(x.id) ?? rows.get(x.id))?.done === true,
    ).length;
    if (doneCount >= MISSIONS_PER_DAY) bonus = MISSION_COMPLETE_BONUS;
  }
  return { state: next, rows: updated, completed, bonus, newBest };
}
