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

  const surfaceRoles = [
    'surface',
    'surface-container-lowest',
    'surface-container-low',
    'surface-container',
    'surface-container-high',
    'surface-container-highest',
  ] as const;

  const onPrefixPairs = Object.keys(lightTokens)
    .filter((key) => key.startsWith('on-'))
    .map((fg) => {
      const base = fg.slice(3);
      const bg =
        base === 'surface-variant' ? 'surface' : lightTokens[base] ? base : `${base}-container`;
      return [fg, bg] as const;
    });

  it.each(themes)(
    'passes >= 4.5:1 for every on-X/X and inverse text pair in %s',
    (themeName, tokens) => {
      for (const [fg, bg] of onPrefixPairs) {
        const ratio = contrastRatio(resolveColor(tokens, fg), resolveColor(tokens, bg));
        expect(
          ratio,
          `${themeName}: --${fg} on --${bg} (${ratio.toFixed(2)}:1)`,
        ).toBeGreaterThanOrEqual(4.5);
      }

      for (const surface of surfaceRoles) {
        for (const textRole of ['on-surface', 'on-surface-variant']) {
          const ratio = contrastRatio(
            resolveColor(tokens, textRole),
            resolveColor(tokens, surface),
          );
          expect(
            ratio,
            `${themeName}: --${textRole} on --${surface} (${ratio.toFixed(2)}:1)`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }

      for (const inverseFg of ['inverse-on-surface', 'inverse-primary']) {
        const ratio = contrastRatio(
          resolveColor(tokens, inverseFg),
          resolveColor(tokens, 'inverse-surface'),
        );
        expect(
          ratio,
          `${themeName}: --${inverseFg} on --inverse-surface (${ratio.toFixed(2)}:1)`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(themes)(
    'passes >= 3:1 for outline and outline-variant against all surfaces in %s',
    (themeName, tokens) => {
      for (const outlineRole of ['outline', 'outline-variant']) {
        for (const surface of surfaceRoles) {
          const ratio = contrastRatio(
            resolveColor(tokens, outlineRole),
            resolveColor(tokens, surface),
          );
          expect(
            ratio,
            `${themeName}: --${outlineRole} on --${surface} (${ratio.toFixed(2)}:1)`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    },
  );
});
