/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SceneArt } from '@casino/ui';
import * as arena from './arena-art.ts';
import * as race from './race-art.ts';
import * as stable from './stable-art.ts';

const tokens = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../../design/bitbloom/tokens.css'),
  'utf8',
);
const isArt = (v: unknown): v is SceneArt =>
  typeof v === 'object' && v !== null && 'legend' in v && 'frames' in v;

describe('horse scene art', () => {
  const arts = Object.entries({ ...race, ...stable, ...arena }).filter(([, v]) => isArt(v)) as [
    string,
    SceneArt,
  ][];

  it('has every picture on its own grid, all frames the same size', () => {
    expect(arts.length).toBeGreaterThan(30);
    for (const [name, art] of arts) {
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

  it('draws the portrait in the roles of the race sprite', () => {
    expect(stable.PORTRAIT_ROWS).toHaveLength(stable.PORTRAIT_HEIGHT);
    expect(new Set(stable.PORTRAIT_ROWS.join('')).size).toBeGreaterThan(8);
    expect(stable.PORTRAIT_ROWS.join('')).toMatch(/^[a-u.]+$/);
  });

  it('keeps every fighter in both directions with an idle and an attack frame', () => {
    expect(arena.FIGHTER_ART).toHaveLength(16);
    for (const [right, left] of arena.FIGHTER_ART) {
      expect(right.frames).toHaveLength(2);
      expect(left.frames).toHaveLength(2);
      expect(right.w).toBe(arena.FIGHTER_WIDTH);
    }
  });
});
