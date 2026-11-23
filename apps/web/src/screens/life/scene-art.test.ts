/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SceneArt } from '@casino/ui';
import * as inventory from './inventory-art.ts';
import * as mine from './mine-art.ts';
import * as shop from './shop-art.ts';

const tokens = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../../design/bitbloom/tokens.css'),
  'utf8',
);
const isArt = (v: unknown): v is SceneArt =>
  typeof v === 'object' && v !== null && 'legend' in v && 'frames' in v;

describe('life scene art', () => {
  const arts = Object.entries({ ...mine, ...shop, ...inventory }).filter(([, v]) => isArt(v)) as [
    string,
    SceneArt,
  ][];

  it('has every picture on its own grid, all frames the same size', () => {
    expect(arts.length).toBeGreaterThan(15);
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

  it('has a sprite for every ore and relic and a four-frame swing', () => {
    expect(Object.keys(mine.FIND_ART)).toHaveLength(12);
    expect(mine.MINER.frames).toHaveLength(4);
    for (const art of Object.values(mine.FIND_ART)) expect([art.w, art.h]).toEqual([16, 16]);
  });
});
