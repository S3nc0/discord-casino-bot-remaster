/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function collectCssFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectCssFiles(full));
    } else if (full.endsWith('.css')) {
      results.push(full);
    }
  }
  return results;
}

describe('CSS CSP and font rules', () => {
  const srcDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const cssFiles = collectCssFiles(srcDir);

  it('finds package CSS files', () => {
    expect(cssFiles.length).toBeGreaterThanOrEqual(2);
  });

  it('contains no external http(s):// URLs or @import url( in any CSS file', () => {
    for (const file of cssFiles) {
      const content = readFileSync(file, 'utf8');
      const withoutSvgXmlns = content.replaceAll("xmlns='http://www.w3.org/2000/svg'", '');
      expect(withoutSvgXmlns, `${file} contains http(s)://`).not.toMatch(/https?:\/\//i);
      expect(content, `${file} contains @import url(`).not.toMatch(/@import\s+url\s*\(/i);
    }
  });

  it('includes Japanese system font fallbacks in tokens.css', () => {
    const tokensCss = readFileSync(join(srcDir, 'styles', 'tokens.css'), 'utf8');
    expect(tokensCss).toContain('Hiragino Sans');
    expect(tokensCss).toContain('Yu Gothic');
    expect(tokensCss).toContain('Meiryo');
  });
});
