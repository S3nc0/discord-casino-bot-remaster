/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type TokenMap = Record<string, string>;

function parseCssBlock(css: string, headerPattern: RegExp): TokenMap {
  const match = css.match(headerPattern);
  if (!match || !match[1]) {
    throw new Error(`Missing CSS block for ${headerPattern.source}`);
  }
  const tokens: TokenMap = {};
  for (const entry of match[1].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    const name = entry[1];
    const value = entry[2];
    if (name && value) {
      tokens[name] = value.trim();
    }
  }
  return tokens;
}

function resolveColor(tokens: TokenMap, name: string): string {
  let current = tokens[name];
  for (let depth = 0; depth < 8; depth += 1) {
    if (!current) {
      throw new Error(`Missing token --${name}`);
    }
    const ref = current.match(/^var\(--([a-z0-9-]+)\)$/);
    if (!ref || !ref[1]) {
      return current;
    }
    current = tokens[ref[1]];
  }
  throw new Error(`Circular token reference for --${name}`);
}

function relativeLuminance(hex: string): number {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Expected 6-digit hex color, got ${hex}`);
  }
  const channels = [0, 2, 4].map((offset) => {
    const srgb = Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const SURFACES = [
  'surface-container-lowest',
  'surface',
  'surface-container-low',
  'surface-container',
  'surface-container-high',
  'surface-container-highest',
] as const;
const HUES = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'magenta',
  'pink',
  'brown',
] as const;
const FILLS = ['primary', 'secondary', 'tertiary', 'error', 'success', 'warning'] as const;

type Rule = 'text' | 'meaningful' | 'decorative' | 'not dim';
type Pair = [rule: Rule, fg: string, bg: string, min: number];

/**
 * Port of design/bitbloom/contrast_check.py: every pair the theme promises, with its minimum.
 *  text        >= 4.5  text on fills, coloured text/icons on every surface
 *  meaningful  >= 3    outline (control borders) and the focus ring on every surface
 *  decorative  >= 1.3  outline-variant stays a visible step (and is softer than outline)
 *  not dim     on-surface >= 10 and on-surface-variant >= 5.5 on surface
 */
function pairs(): Pair[] {
  const out: Pair[] = [];
  for (const f of FILLS) {
    out.push(['text', `on-${f}`, f, 4.5]);
    out.push(['text', `on-${f}-container`, `${f}-container`, 4.5]);
    for (const s of SURFACES) out.push(['text', f, s, 4.5]);
  }
  for (const s of SURFACES) {
    out.push(['text', 'on-surface', s, 4.5]);
    out.push(['text', 'on-surface-variant', s, 4.5]);
    out.push(['meaningful', 'outline', s, 3]);
    out.push(['meaningful', 'focus-ring', s, 3]);
  }
  out.push(['meaningful', 'outline', 'secondary-container', 3]);
  out.push(['text', 'inverse-on-surface', 'inverse-surface', 4.5]);
  out.push(['text', 'inverse-primary', 'inverse-surface', 4.5]);
  out.push(['text', 'on-disabled', 'disabled-container', 4.5]);
  out.push(['not dim', 'on-surface', 'surface', 10]);
  out.push(['not dim', 'on-surface-variant', 'surface', 5.5]);
  out.push(['decorative', 'outline-variant', 'surface', 1.3]);
  out.push(['decorative', 'outline-variant', 'surface-container-low', 1.3]);
  for (const h of HUES) {
    out.push(['text', `on-${h}-container`, `${h}-container`, 4.5]);
    for (const s of SURFACES) out.push(['text', `${h}-accent`, s, 4.5]);
  }
  return out;
}

describe('Bitbloom token contrast', () => {
  const stylesDir = dirname(fileURLToPath(import.meta.url));
  const tokensCss = readFileSync(join(stylesDir, 'tokens.css'), 'utf8');
  const lightTokens = parseCssBlock(tokensCss, /\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/);
  const darkTokens: TokenMap = {
    ...lightTokens,
    ...parseCssBlock(tokensCss, /\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/),
  };
  const mediaDarkTokens: TokenMap = {
    ...lightTokens,
    ...parseCssBlock(
      tokensCss,
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)\s*\{([\s\S]*?)\n\s*\}/,
    ),
  };

  const themes: Array<[string, TokenMap]> = [
    ['light', lightTokens],
    ['dark', darkTokens],
    ['prefers-color-scheme: dark', mediaDarkTokens],
  ];

  it.each(themes)('has 0 failing pairs in %s', (themeName, tokens) => {
    const ratioOf = (fg: string, bg: string) =>
      contrastRatio(resolveColor(tokens, fg), resolveColor(tokens, bg));
    const failures: string[] = [];
    let checks = 0;
    for (const [rule, fg, bg, min] of pairs()) {
      checks += 1;
      const ratio = ratioOf(fg, bg);
      if (ratio < min) {
        failures.push(`[${rule}] --${fg} on --${bg} = ${ratio.toFixed(2)}:1 (need ${min})`);
      }
    }
    // The decorative edge must be softer than the meaningful one, on the surface it is drawn on.
    checks += 1;
    if (!(ratioOf('outline-variant', 'surface') < ratioOf('outline', 'surface'))) {
      failures.push('[decorative] outline-variant is not softer than outline');
    }
    // Layers stay distinguishable but gentle.
    SURFACES.slice(1).forEach((layer, i) => {
      checks += 1;
      const prev = SURFACES[i] as string;
      const step = ratioOf(prev, layer);
      if (step < 1.04) failures.push(`[layers] ${prev} -> ${layer} is only ${step.toFixed(3)}:1`);
    });
    expect(checks, 'the rule set did not shrink').toBeGreaterThanOrEqual(198);
    expect(failures, `${themeName}: ${failures.length} failing`).toEqual([]);
  });

  it('matches design/bitbloom/tokens.json for every colour role', () => {
    const json = JSON.parse(
      readFileSync(join(stylesDir, '../../../../design/bitbloom/tokens.json'), 'utf8'),
    ) as {
      color: { tokens: Array<{ name: string; value: string | { light: string; dark: string } }> };
    };
    const unwrap = (v: string) => v.replace(/^\{(.+)\}$/, '$1');
    for (const token of json.color.tokens) {
      for (const [theme, tokens] of [
        ['light', lightTokens],
        ['dark', darkTokens],
      ] as const) {
        const raw = typeof token.value === 'string' ? token.value : token.value[theme];
        const expected = /^#/.test(raw)
          ? raw
          : resolveColor(
              // resolve through the JSON's own references with the same theme
              Object.fromEntries(
                json.color.tokens.map((t) => {
                  const r = typeof t.value === 'string' ? t.value : t.value[theme];
                  return [t.name, /^\{/.test(r) ? `var(--${unwrap(r)})` : r];
                }),
              ),
              token.name,
            );
        if (!/^#[0-9a-f]{6}$/i.test(expected)) continue; // scrim and lip carry alpha
        expect(resolveColor(tokens, token.name), `${theme} --${token.name}`).toBe(expected);
      }
    }
  });
});
