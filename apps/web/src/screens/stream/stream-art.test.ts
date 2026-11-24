/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ON_AIR_BADGE } from './stream-art.ts';

const tokens = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../../design/bitbloom/tokens.css'),
  'utf8',
);

describe('stream pixel art', () => {
  it('has ON_AIR_BADGE frames on its declared 12x8 grid', () => {
    expect(ON_AIR_BADGE.frames.length).toBeGreaterThanOrEqual(2);
    for (const rows of ON_AIR_BADGE.frames) {
      expect(rows).toHaveLength(ON_AIR_BADGE.h);
      for (const row of rows) expect(row.length).toBe(ON_AIR_BADGE.w);
    }
  });

  it('uses only legend characters mapped to Bitbloom palette tokens in both themes', () => {
    const used = new Set(ON_AIR_BADGE.frames.flat().join('').replace(/\./g, ''));
    for (const ch of used) expect(ON_AIR_BADGE.legend[ch], `legend ${ch}`).toBeDefined();
    for (const pair of Object.values(ON_AIR_BADGE.legend)) {
      for (const token of pair) expect(tokens, `token ${token}`).toContain(`--${token}:`);
    }
  });
});
