import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Migration } from './migrate.ts';

/**
 * Load the numbered `.sql` files from disk, for scripts that run without the bundler (the
 * server itself uses the inlined list in `migrations/index.ts`).
 */
export function readMigrationsFromDir(dir: string): Migration[] {
  return readdirSync(dir)
    .map((file) => /^(\d{4})_(.+)\.sql$/.exec(file))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      version: Number(m[1]),
      name: m[2] ?? '',
      sql: readFileSync(join(dir, m[0]), 'utf8'),
    }))
    .sort((a, b) => a.version - b.version);
}
