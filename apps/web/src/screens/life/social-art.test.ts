/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SceneArt } from '@casino/ui';
import * as daily from '../casino/daily-art.ts';
import * as history from '../casino/history-art.ts';
import * as profile from '../profile/profile-art.ts';
import * as lottery from './lottery-art.ts';
import * as missions from './missions-art.ts';
import * as poll from './poll-art.ts';
import * as quiz from './quiz-art.ts';
import * as ranking from './ranking-art.ts';
import * as relics from './relics-art.ts';
import * as transfer from './transfer-art.ts';

const tokens = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../../design/bitbloom/tokens.css'),
  'utf8',
);
const isArt = (v: unknown): v is SceneArt =>
  typeof v === 'object' && v !== null && 'legend' in v && 'frames' in v;
const modules = {
  quiz,
  lottery,
  poll,
  missions,
  ranking,
  relics,
  transfer,
  daily,
  history,
  profile,
};
const arts = Object.values(modules).flatMap(
  (m) => Object.entries(m).filter(([, v]) => isArt(v)) as [string, SceneArt][],
);

/** An overlay must sit inside the picture it is drawn on. */
const inside = (layer: SceneArt, at: { x: number; y: number }, base: SceneArt) =>
  at.x >= 0 && at.y >= 0 && at.x + layer.w <= base.w && at.y + layer.h <= base.h;

describe('social scene art', () => {
  it('has every picture on its own grid, all frames the same size', () => {
    expect(arts.length).toBeGreaterThan(20);
    for (const [name, art] of arts) {
      expect(art.frames.length, name).toBeGreaterThan(0);
      for (const rows of art.frames) {
        expect(rows, name).toHaveLength(art.h);
        for (const row of rows) expect(row.length, name).toBe(art.w);
      }
    }
  });

  it('uses only legend characters, each a palette token in both themes', () => {
    for (const [name, art] of arts) {
      const used = new Set(art.frames.flat().join('').replace(/\./g, ''));
      for (const ch of used) expect(art.legend[ch], `${name} ${ch}`).toBeDefined();
      for (const pair of Object.values(art.legend))
        for (const token of pair) expect(tokens, `${name} ${token}`).toContain(`--${token}:`);
    }
  });

  it('fits a 390 px phone at 2 CSS px per art pixel', () => {
    for (const art of [
      quiz.QUIZ_STAGE,
      lottery.LOTTERY_COUNTER,
      poll.POLL_HALL,
      missions.MISSIONS_BOARD,
      ranking.RANKING_PODIUM,
      relics.RELICS_HALL,
      transfer.TRANSFER_STREET,
      daily.DAILY_ROOM,
      history.HISTORY_LEDGER,
      profile.PROFILE_CARD,
    ])
      expect(art.w * 2).toBeLessThanOrEqual(358);
  });

  it('places every overlay inside its scene', () => {
    expect(inside(quiz.QUIZ_BULBS, quiz.QUIZ_BULBS_AT, quiz.QUIZ_STAGE)).toBe(true);
    expect(inside(lottery.LOTTERY_GLOBE, lottery.LOTTERY_GLOBE_AT, lottery.LOTTERY_COUNTER)).toBe(
      true,
    );
    expect(inside(poll.POLL_DROP, poll.POLL_DROP_AT, poll.POLL_HALL)).toBe(true);
    expect(inside(ranking.RANKING_CUP, ranking.RANKING_CUP_AT, ranking.RANKING_PODIUM)).toBe(true);
    expect(
      inside(transfer.TRANSFER_FLIGHT, transfer.TRANSFER_FLIGHT_AT, transfer.TRANSFER_STREET),
    ).toBe(true);
    expect(inside(daily.DAILY_GIFT, daily.DAILY_GIFT_AT, daily.DAILY_ROOM)).toBe(true);
    for (const [x, y] of daily.DAILY_CELLS)
      expect(inside(daily.DAILY_STAMP, { x, y }, daily.DAILY_ROOM)).toBe(true);
    for (const c of relics.RELIC_CASES) expect(inside(c.art, c, relics.RELICS_HALL)).toBe(true);
  });

  it('has the frame counts the screens play', () => {
    expect(quiz.QUIZ_BULBS.frames).toHaveLength(2);
    expect(quiz.QUIZ_RIGHT.frames).toHaveLength(4);
    expect(quiz.QUIZ_WRONG.frames).toHaveLength(4);
    expect(poll.POLL_DROP.frames).toHaveLength(8);
    expect(transfer.TRANSFER_FLIGHT.frames).toHaveLength(8);
    expect(ranking.RANKING_MEDALS.frames).toHaveLength(3);
    expect(daily.DAILY_GIFT.frames).toHaveLength(6);
    expect(daily.DAILY_CELLS).toHaveLength(7);
    expect(relics.RELIC_CASES).toHaveLength(6);
    for (const c of relics.RELIC_CASES) expect(c.art.frames).toHaveLength(5);
  });

  it('rests poll and transfer on frame 0, the frame their scene shows under reduced motion', () => {
    // The overlay's frame 0 is cut from the scene itself, so it matches what is underneath.
    const cut = (base: SceneArt, layer: SceneArt, at: { x: number; y: number }) =>
      (base.frames[0] as readonly string[])
        .slice(at.y, at.y + layer.h)
        .map((row) => row.slice(at.x, at.x + layer.w));
    const same = (base: SceneArt, layer: SceneArt, at: { x: number; y: number }) => {
      const rows = cut(base, layer, at);
      const legend = (a: SceneArt, ch: string) => (ch === '.' ? '.' : a.legend[ch]?.[0]);
      return rows.every((row, y) =>
        [...row].every(
          (ch, x) => legend(base, ch) === legend(layer, (layer.frames[0]?.[y] ?? '')[x] ?? '.'),
        ),
      );
    };
    expect(same(poll.POLL_HALL, poll.POLL_DROP, poll.POLL_DROP_AT)).toBe(true);
    expect(
      same(transfer.TRANSFER_STREET, transfer.TRANSFER_FLIGHT, transfer.TRANSFER_FLIGHT_AT),
    ).toBe(true);
  });
});
