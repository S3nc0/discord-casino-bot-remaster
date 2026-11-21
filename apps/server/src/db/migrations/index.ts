import type { Migration } from '../migrate.ts';
import init from './0001_init.sql';
import ledgerIdempotency from './0002_ledger_idempotency.sql';
import legacyImport from './0003_legacy_import.sql';
import userSettings from './0004_user_settings.sql';
import casino from './0005_casino.sql';

export type { Migration };

/** Ordered list of migrations. SQL files are inlined into the server bundle at build time. */
export const migrations: readonly Migration[] = [
  { version: 1, name: 'init', sql: init },
  { version: 2, name: 'ledger_idempotency', sql: ledgerIdempotency },
  { version: 3, name: 'legacy_import', sql: legacyImport },
  { version: 4, name: 'user_settings', sql: userSettings },
  { version: 5, name: 'casino', sql: casino },
];
