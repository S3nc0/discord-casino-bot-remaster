import type Database from 'better-sqlite3';

/**
 * Pragmas for every connection (they are per connection, so they cannot live in a migration).
 * `recursive_triggers = ON` makes the implicit delete of INSERT OR REPLACE fire DELETE triggers;
 * the ledger triggers also hold without it.
 */
export const CONNECTION_PRAGMAS = [
  'journal_mode = WAL',
  'synchronous = NORMAL',
  'busy_timeout = 5000',
  'foreign_keys = ON',
  'recursive_triggers = ON',
  'temp_store = MEMORY',
  'cache_size = -8000',
] as const;

export function applyPragmas(db: Database.Database): void {
  for (const pragma of CONNECTION_PRAGMAS) db.pragma(pragma);
}
