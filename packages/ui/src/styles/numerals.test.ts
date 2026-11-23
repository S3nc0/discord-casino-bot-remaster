/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Pixelify Sans draws 2 like 8 and 5 like S at every size, so numbers must not use its digits.
const styles = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(styles, name), 'utf8');
const tokens = read('tokens.css');
const bundle = read('bundle.css');
const numerals = read('numerals.css');

/** The declaration of a custom property, up to its semicolon. */
const token = (name: string): string =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1]?.replace(/\s+/g, ' ') ?? '';

describe('numeric font', () => {
  it('--font-numeric is the body font (Atkinson Hyperlegible)', () => {
    expect(token('--font-numeric')).toBe('var(--font-body)');
    expect(token('--font-body')).toMatch(/^'Atkinson Hyperlegible'/);
  });

  it('.num sets the numeric token and tabular figures', () => {
    const rule = /\n\.num\s*\{([^}]*)\}/.exec(bundle)?.[1] ?? '';
    expect(rule).toContain('font-family: var(--font-numeric)');
    expect(rule).toContain('tabular-nums');
  });

  it('--font-display puts the digit-safe face before Pixelify Sans', () => {
    const stack = token('--font-display');
    expect(stack.indexOf("'Bitbloom Numerals'")).toBe(0);
    expect(stack).toContain("'Pixelify Sans'");
  });

  it('the digit-safe face covers 0-9 in regular and bold, from the bundled Atkinson files', () => {
    const faces = numerals.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces).toHaveLength(2);
    for (const face of faces) {
      expect(face).toContain("font-family: 'Bitbloom Numerals'");
      expect(face).toMatch(/unicode-range:[^;]*U\+0030-0039/);
      expect(face).toMatch(/atkinson-hyperlegible-latin-(400|700)-normal\.woff2/);
      expect(face).not.toMatch(/https?:/);
    }
    expect(faces.map((f) => /font-weight:\s*(\d+)/.exec(f)?.[1])).toEqual(['400', '700']);
  });

  it('the kit button colour rule has zero specificity beyond .bb-btn, so screens can override it', () => {
    expect(bundle).toContain(
      '.bb-btn:where(:not(:disabled):not(.bb-btn--outlined):not(.bb-btn--text))',
    );
    expect(bundle).not.toMatch(/^\.bb-btn:not\(:disabled\):not\(/m);
  });
});
