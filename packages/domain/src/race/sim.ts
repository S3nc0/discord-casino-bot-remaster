import type { Rng } from '@casino/shared';
import { Gauss } from '../progression/py-random.ts';
import type { RunningStyle } from './horse.ts';

export const TICKS = 60;
export const MAX_TICKS = 140;
export const FATIGUE_MAX = 0.22;
export const NOISE = 0.03;
export const LUCK = 0.03;
export const PACE_FACTOR = 0.05;

export type Form = -1 | 0 | 1;
export const FORM_MULT: Record<Form, number> = { 1: 1.015, 0: 1.0, [-1]: 0.985 };
export const FORM_ODDS: Record<Form, number> = { 1: 1.15, 0: 1.0, [-1]: 0.85 };
export const FORM_MARK: Record<Form, string> = { 1: '◎', 0: '○', [-1]: '△' };

export const DISTANCES = [1000, 1200, 1600, 1800, 2000, 2400, 3000] as const;
export const GOINGS = [
  { name: '良', penalty: 0.0, weight: 60 },
  { name: '稍重', penalty: 0.012, weight: 25 },
  { name: '重', penalty: 0.03, weight: 11 },
  { name: '不良', penalty: 0.05, weight: 4 },
] as const;
export type GoingName = (typeof GOINGS)[number]['name'];

export interface Track {
  distance: number;
  going: GoingName;
}

const STYLE_EARLY: Record<RunningStyle, number> = {
  nige: 0.025,
  senko: 0.012,
  sashi: -0.01,
  oikomi: -0.022,
};
const STYLE_LATE: Record<RunningStyle, number> = {
  nige: -0.015,
  senko: 0.0,
  sashi: 0.018,
  oikomi: 0.03,
};

export interface Runner {
  lane: number;
  name: string;
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  style: RunningStyle;
  form: Form;
  races: number;
  wins: number;
  places: number;
}

export function goingPenalty(going: GoingName): number {
  return GOINGS.find((g) => g.name === going)?.penalty ?? 0;
}

function styleCurve(style: RunningStyle, p: number, paceShift: number): number {
  const early = STYLE_EARLY[style];
  const late = STYLE_LATE[style];
  if (p < 0.35) return early - (style === 'nige' || style === 'senko' ? paceShift : 0);
  if (p >= 0.7) return late + (style === 'sashi' || style === 'oikomi' ? paceShift : 0);
  const t = (p - 0.35) / 0.35;
  return early + (late - early) * t;
}

function multiplier(
  r: Runner,
  p: number,
  track: Track,
  luck: number,
  spurt: number,
  paceShift: number,
): number {
  const d = track.distance;
  let m = 1 + ((r.speed - 50) / 50) * Math.min(0.09, (0.042 * 1800) / d);
  m *= 1 + ((r.power - 50) / 50) * 0.1 * Math.max(0, 1 - p / 0.3);
  const reach = Math.min(1, Math.max(0.25, (0.8 * (r.stamina / 50)) / (d / 1800)));
  if (p > reach && reach < 1) {
    const fatigue = (FATIGUE_MAX * (p - reach)) / (1 - reach);
    m *= (1 - fatigue) * (1 + Math.min(spurt, fatigue));
  }
  m *= 1 + styleCurve(r.style, p, paceShift);
  m *= 1 - goingPenalty(track.going) * (1 - (r.power - 20) / 60);
  m *= FORM_MULT[r.form] * (1 + luck);
  return m;
}

export interface SimResult {
  /** Indexes into `runners`, first place first. */
  order: number[];
  /** Interpolated finish time in ticks, per runner index. */
  times: number[];
  /** Progress (0..1000 milli) of every runner after each tick, for the Activity animation. */
  frames: number[][];
}

/** One race. Consumes `rng` in a fixed order so a seeded run replays exactly. */
export function simulate(
  runners: readonly Runner[],
  track: Track,
  rng: Rng,
  withFrames = true,
  gauss: Gauss = new Gauss(rng),
): SimResult {
  const n = runners.length;
  // Legacy draw order: every runner's luck first, then every runner's spurt.
  const luck = runners.map(() => gauss.draw(0, LUCK));
  const spurt = runners.map((r) => Math.max(0, ((r.guts - 20) / 60) * 0.12 * (0.5 + rng.float())));
  const paceCount = runners.filter((r) => r.style === 'nige' || r.style === 'senko').length;
  const paceShift = (paceCount / n - 0.5) * PACE_FACTOR;

  const pos = new Array<number>(n).fill(0);
  const finish = new Array<number | null>(n).fill(null);
  const frames: number[][] = [];
  for (let t = 1; t <= MAX_TICKS; t++) {
    for (let i = 0; i < n; i++) {
      if (finish[i] !== null) continue;
      const r = runners[i] as Runner;
      const step =
        (multiplier(r, pos[i] as number, track, luck[i] as number, spurt[i] as number, paceShift) *
          (1 + gauss.draw(0, NOISE))) /
        TICKS;
      const before = pos[i] as number;
      const next = before + Math.max(0, step);
      if (next >= 1) {
        finish[i] = t - 1 + (1 - before) / Math.max(1e-9, next - before);
        pos[i] = 1;
      } else {
        pos[i] = next;
      }
    }
    if (withFrames) frames.push(pos.map((p) => Math.round(p * 1000)));
    if (finish.every((f) => f !== null)) break;
  }
  const times = pos.map((p, i) => finish[i] ?? MAX_TICKS + (1 - p));
  const ties = times.map(() => rng.float());
  const order = times
    .map((_, i) => i)
    .sort(
      (a, b) =>
        (times[a] as number) - (times[b] as number) || (ties[a] as number) - (ties[b] as number),
    );
  return { order, times, frames };
}
