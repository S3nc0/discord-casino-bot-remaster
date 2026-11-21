import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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

const FORBIDDEN_MODULE =
  /^(node:.*|fs|fs\/.*|path|os|child_process|crypto|worker_threads|net|http|https|better-sqlite3|discord\.js|@discordjs\/.*|fastify|@fastify\/.*|socket\.io|socket\.io-client|croner|react|react-dom|@casino\/(?!shared(\/|$)).*)$/;
const FORBIDDEN_GLOBAL =
  /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)|(?<![.\w])(?<!new\s+)Date\s*\(|\bMath\.random\s*\(|\bperformance\.now\s*\(|\bprocess\.|\bglobalThis\b|\bsetTimeout\s*\(|\bsetInterval\s*\(|\bsetImmediate\s*\(|\bqueueMicrotask\s*\(|\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b|\bcrypto\.|\bimport\s*\(|\brequire\s*\(/;

/** Every module specifier: `import x from 'm'`, `import 'm'`, `export * from 'm'`. */
function specifiers(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
    if (m[1]) found.push(m[1]);
  }
  for (const m of text.matchAll(/(?:^|[\s;])import\s*['"]([^'"]+)['"]/g))
    if (m[1]) found.push(m[1]);
  return found;
}

/** Why a specifier is not allowed in domain code, or null if it is fine. */
function importProblem(file: string, spec: string): string | null {
  if (spec.startsWith('.')) {
    const target = resolve(dirname(file), spec);
    return relative(root, target).startsWith('..')
      ? `relative import leaves packages/domain/src: ${spec}`
      : null;
  }
  return FORBIDDEN_MODULE.test(spec) ? `forbidden module: ${spec}` : null;
}

describe('domain purity', () => {
  const files = sourceFiles(root);

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [relative(root, f), f]))(
    '%s has no I/O imports or ambient time/RNG',
    (_, file) => {
      const text = readFileSync(file, 'utf8');
      const problems = specifiers(text)
        .map((spec) => importProblem(file, spec))
        .filter((p): p is string => p !== null);
      expect(problems).toEqual([]);
      expect(text).not.toMatch(FORBIDDEN_GLOBAL);
    },
  );

  it('flags the escapes a review found', () => {
    const file = join(root, 'casino', 'x.ts');
    expect(importProblem(file, '../../../../apps/server/src/main.ts')).toMatch(/leaves/);
    expect(importProblem(file, '../index.ts')).toBeNull();
    expect(importProblem(file, 'better-sqlite3')).toMatch(/forbidden/);
    expect(importProblem(file, '@casino/server')).toMatch(/forbidden/);
    expect(importProblem(file, '@casino/shared')).toBeNull();
    expect(specifiers("import 'better-sqlite3';\nexport * from './a.ts';")).toEqual([
      './a.ts',
      'better-sqlite3',
    ]);
    for (const bad of [
      'Date()',
      'globalThis.fetch()',
      'setImmediate(f)',
      'new WebSocket(u)',
      'import("fs")',
    ]) {
      expect(bad).toMatch(FORBIDDEN_GLOBAL);
    }
    expect('new Date(ctx.clock.now())').not.toMatch(FORBIDDEN_GLOBAL);
  });

  it('depends on nothing but @casino/shared at runtime', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@casino/shared']);
  });
});
