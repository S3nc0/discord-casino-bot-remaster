/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A number a player reads (balance, price, odds, rank, timer, pool) must not be set in the display
// font: Pixelify Sans draws 2 like 8 and 5 like S. Use the `.num` class or `--font-numeric`.
const src = dirname(fileURLToPath(import.meta.url));

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return full.endsWith('.css') ? [full] : [];
  });
}

const NUMERIC =
  /(amount|value|price|odds|rank|timer|countdown|pool|balance|payout|stake|total|score)/;

describe('numbers are not set in the display font', () => {
  it('no numeric selector in the web app uses --font-display', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(src)) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [, selector = '', body = ''] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (NUMERIC.test(selector) && body.includes('--font-display')) {
          offenders.push(`${file.slice(src.length + 1)}: ${selector.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the balance and the stat values carry the .num class', () => {
    const home = readFileSync(join(src, 'shell/HomeScreen.tsx'), 'utf8');
    const stat = readFileSync(join(src, 'screens/life/ui.tsx'), 'utf8');
    expect(home).toContain('home__amount num');
    expect(stat).toContain('life-stat__value num');
  });
});
