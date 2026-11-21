import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// packages/domain must stay pure: no I/O, no Discord, no DB, no wall clock, no ambient RNG.
// ESLint enforces the same rules while editing; this test makes them fail CI on its own.
const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  dependencies?: Record<string, string>;
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name: string) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const FORBIDDEN_IMPORT =
  /from\s+['"](node:[^'"]+|fs|fs\/[^'"]*|path|os|child_process|crypto|worker_threads|net|http|https|better-sqlite3|discord\.js|@discordjs\/[^'"]+|fastify|socket\.io|socket\.io-client|croner|react)['"]|import\(\s*['"]/;
const FORBIDDEN_GLOBAL =
  /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)|\bMath\.random\s*\(|\bperformance\.now\s*\(|\bprocess\.|\bsetTimeout\s*\(|\bsetInterval\s*\(|\bfetch\s*\(|\bcrypto\./;

describe('domain purity', () => {
  const files = sourceFiles(root);

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [relative(root, f), f]))(
    '%s has no I/O imports or ambient time/RNG',
    (_, file) => {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(FORBIDDEN_IMPORT);
      expect(text).not.toMatch(FORBIDDEN_GLOBAL);
    },
  );

  it('depends on nothing but @casino/shared at runtime', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@casino/shared']);
  });
});
