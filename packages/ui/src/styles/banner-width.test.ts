/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The declarations of the first `.bb-banner {` rule in the bundle. */
function bannerRule(): string {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'bundle.css'), 'utf8');
  const m = /\n\.bb-banner \{([^}]*)\}/.exec(css);
  if (!m?.[1]) throw new Error('no .bb-banner rule');
  return m[1];
}

describe('Banner width', () => {
  it('has no fixed width, so it never makes a 390 px screen scroll sideways', () => {
    const rule = bannerRule();
    expect(rule).not.toMatch(/(^|\s|;)width:\s*\d/);
    expect(rule).toMatch(/max-width:\s*100%/);
    expect(rule).toMatch(/min-width:\s*0/);
  });
});
