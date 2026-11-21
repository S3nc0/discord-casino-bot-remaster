import init from './0001_init.sql';

export interface Migration {
  /** Strictly increasing. Never edit a migration after it has merged; add a new one. */
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/** Ordered list of migrations. SQL files are inlined into the server bundle at build time. */
export const migrations: readonly Migration[] = [{ version: 1, name: 'init', sql: init }];
