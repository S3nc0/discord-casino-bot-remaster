import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  contrast,
  loadTokens,
  parseRules,
  resolve,
  roleOf,
  type Theme,
} from './testing/contrast.ts';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const shellCss = read('./styles.css');
const tokensCss = read('../../../../packages/ui/src/styles/tokens.css');

const THEMES: Theme[] = ['dark', 'light'];
const TEXT_MIN = 4.5;
const BORDER_MIN = 3;

/** Every surface a shell element can sit on. */
const SURFACES = [
  'surface',
  'surface-container-low',
  'surface-container',
  'surface-container-high',
  'surface-container-highest',
] as const;

const rules = parseRules(shellCss);

/** Text the shell restyles: selector → it must set `color` to a role in this file. */
const SHELL_TEXT = [
  '.app-root .bb-card__meta',
  '.app-root .bb-list__support',
  '.app-root .bb-nav-item',
  '.app-root .bb-tab',
  '.app-root .bb-slider__head',
  '.app-root .bb-radio',
  '.app-root .participants__more',
  '.home__balance',
];

/**
 * Kit roles the shell uses as they are (foreground, background, minimum). Disabled controls are
 * exempt from WCAG and listed separately below.
 */
const KIT_TEXT: [string, string][] = [
  ['on-surface', 'surface'],
  ['on-surface', 'surface-container'],
  ['on-surface', 'surface-container-low'],
  ['on-surface', 'surface-container-highest'],
  ['on-primary', 'primary'],
  ['on-secondary-container', 'secondary-container'],
  ['on-primary-container', 'primary-container'],
  ['on-error', 'error'],
  ['on-error-container', 'error-container'],
  ['on-warning-container', 'warning-container'],
  ['inverse-on-surface', 'inverse-surface'],
  ['primary', 'surface'],
  ['primary', 'surface-container-low'],
  ['on-yellow-container', 'yellow-container'],
  // Home balance: yellow text on the card (dark) and on the butter plate (light).
  ['tertiary', 'surface-container-low'],
  ['on-tertiary-container', 'tertiary-container'],
];

const fmt = (n: number) => n.toFixed(2);

describe.each(THEMES)('contrast (%s theme)', (theme) => {
  const tokens = loadTokens(tokensCss, theme);
  const color = (role: string) => resolve(tokens, role);

  it.each(SHELL_TEXT)('%s text reaches 4.5:1 on every surface', (selector) => {
    const role = roleOf(rules, selector, 'color');
    expect(role, `${selector} sets no colour role`).not.toBeNull();
    for (const surface of SURFACES) {
      const ratio = contrast(color(role!), color(surface));
      expect(ratio, `${selector} ${role} on ${surface} = ${fmt(ratio)}`).toBeGreaterThanOrEqual(
        TEXT_MIN,
      );
    }
  });

  it.each(KIT_TEXT)('kit text %s on %s reaches 4.5:1', (fg, bg) => {
    const ratio = contrast(color(fg), color(bg));
    expect(ratio, `${fg} on ${bg} = ${fmt(ratio)}`).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it('keeps focus rings and control outlines at 3:1', () => {
    for (const role of ['focus-ring', 'outline']) {
      for (const surface of SURFACES) {
        const ratio = contrast(color(role), color(surface));
        expect(ratio, `${role} on ${surface} = ${fmt(ratio)}`).toBeGreaterThanOrEqual(BORDER_MIN);
      }
    }
  });
});

describe('shell stylesheet', () => {
  it('never uses the muted variant roles', () => {
    expect(shellCss).not.toMatch(/on-surface-variant|outline-variant/);
  });

  it('applies Discord safe-area variables with env() fallbacks on all four edges', () => {
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      expect(shellCss).toContain(
        `var(--discord-safe-area-inset-${edge}, env(safe-area-inset-${edge}, 0px))`,
      );
    }
  });
});
