import Database from 'better-sqlite3';
import { applyPragmas } from './pragmas.ts';
import { runMigrations, type Migration } from './migrate.ts';

type Statement = Database.Statement;

/**
 * One SQLite connection plus the helpers every service shares: cached prepared statements, a
 * transaction helper that nests, and `afterCommit` so events are published only once the data
 * they describe is durable.
 */
export class Store {
  readonly db: Database.Database;
  private readonly statements = new Map<string, Statement>();
  private depth = 0;
  private pending: (() => void)[] = [];
  private readonly onHookError: (error: unknown) => void;

  constructor(db: Database.Database, onHookError: (error: unknown) => void = () => {}) {
    this.db = db;
    this.onHookError = onHookError;
  }

  /** Prepared statement, compiled once per SQL text. */
  stmt(sql: string): Statement {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  /**
   * Run `fn` atomically. The outermost call opens `BEGIN IMMEDIATE` (the write lock is taken up
   * front, so a reader cannot be upgraded into a busy error half way); nested calls become
   * savepoints. A throw rolls back to the start of the call and rethrows. `afterCommit`
   * callbacks queued inside run after the outermost commit and are dropped on rollback.
   */
  transaction<T>(fn: () => T): T {
    if (this.depth === 0) {
      this.db.exec('BEGIN IMMEDIATE');
      this.depth = 1;
      let result: T;
      try {
        result = fn();
        this.db.exec('COMMIT');
      } catch (error) {
        this.pending = [];
        if (this.db.inTransaction) this.db.exec('ROLLBACK');
        throw error;
      } finally {
        this.depth = 0;
      }
      this.flush();
      return result;
    }

    const name = `sp_${this.depth}`;
    const mark = this.pending.length;
    this.db.exec(`SAVEPOINT ${name}`);
    this.depth += 1;
    try {
      const result = fn();
      this.db.exec(`RELEASE ${name}`);
      return result;
    } catch (error) {
      this.pending.length = mark;
      this.db.exec(`ROLLBACK TO ${name}`);
      this.db.exec(`RELEASE ${name}`);
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  /** Run `callback` after the outermost transaction commits (immediately when outside one). */
  afterCommit(callback: () => void): void {
    if (this.depth === 0) this.run(callback);
    else this.pending.push(callback);
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }

  private flush(): void {
    const callbacks = this.pending;
    this.pending = [];
    for (const callback of callbacks) this.run(callback);
  }

  private run(callback: () => void): void {
    try {
      callback();
    } catch (error) {
      this.onHookError(error);
    }
  }
}

export interface OpenStoreOptions {
  migrations: readonly Migration[];
  readonly?: boolean;
  onHookError?: (error: unknown) => void;
}

/** Open (creating if needed) the database file, apply pragmas and pending migrations. */
export function openStore(path: string, options: OpenStoreOptions): Store {
  const db = new Database(path, { readonly: options.readonly ?? false });
  try {
    applyPragmas(db);
    if (!options.readonly) runMigrations(db, options.migrations);
    return new Store(db, options.onHookError);
  } catch (error) {
    db.close();
    throw error;
  }
}
