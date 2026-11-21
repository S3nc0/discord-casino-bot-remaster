import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import type { Clock } from '@casino/shared';
import type { EconomyService } from '../economy/economy-service.ts';
import type { IdentityRepo, GuildStatus } from './identity.ts';
import type { Store } from './store.ts';

// Wallet and balance tables only (see docs/DB_SCHEMA.md, "Legacy table mapping"):
// users.balance -> one `legacy_import` row, escrow -> `game_refund` rows, guild_status -> guilds,
// guild_users -> guild_members, ledger -> legacy_ledger (read-only history).

const SNOWFLAKE = /^[0-9]{17,20}$/;

export interface MemberPlan {
  guildId: string;
  userId: string;
  /** `users.balance` in the legacy file. */
  balance: number;
  /** Stakes of unfinished games, refunded right after the opening row. */
  escrow: { id: string; amount: number }[];
  /** What the new balance must be: balance + escrow. */
  expected: number;
}

export interface GuildPlan {
  guildId: string;
  status: GuildStatus;
  name: string | null;
  decidedBy: string | null;
  members: number;
  /** Sum of the expected balances of its members. */
  expectedTotal: number;
}

export interface ImportPlan {
  guilds: GuildPlan[];
  members: MemberPlan[];
  legacyLedgerRows: number;
  /** Identifies the legacy data; a second run on the same data is a no-op. */
  digest: string;
  errors: string[];
  warnings: string[];
}

export interface ImportReport {
  plan: ImportPlan;
  mode: 'dry-run' | 'applied' | 'already-imported';
  /** Set after an applied import: every per-user and per-guild total matched. */
  verified: boolean;
}

export class ImportMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportMismatchError';
  }
}

type Row = Record<string, unknown>;

const text = (value: unknown): string => String(value);

function hasTable(db: Database.Database, name: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  );
}

function toSafeNumber(value: unknown): number | null {
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : null;
  }
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

const toMs = (seconds: unknown): number => Math.round(Number(seconds) * 1000);

/** Read the legacy file (read-only) and work out what the import would do. */
export function planImport(legacyPath: string): ImportPlan {
  const legacy = new Database(legacyPath, { readonly: true, fileMustExist: true });
  legacy.defaultSafeIntegers(true);
  try {
    if (!hasTable(legacy, 'users')) throw new Error('not a legacy casino.db: no users table');
    const errors: string[] = [];
    const warnings: string[] = [];

    const members = new Map<string, MemberPlan>();
    const key = (g: string, u: string): string => `${g}:${u}`;
    const ensure = (guildId: string, userId: string): MemberPlan | null => {
      if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(userId)) {
        errors.push(`invalid id guild=${guildId} user=${userId}`);
        return null;
      }
      let member = members.get(key(guildId, userId));
      if (!member) {
        member = { guildId, userId, balance: 0, escrow: [], expected: 0 };
        members.set(key(guildId, userId), member);
      }
      return member;
    };

    for (const row of legacy
      .prepare('SELECT guild_id, user_id, balance FROM users')
      .all() as Row[]) {
      const member = ensure(text(row.guild_id), text(row.user_id));
      if (!member) continue;
      const balance = toSafeNumber(row.balance);
      if (balance === null)
        errors.push(`unreadable balance guild=${member.guildId} user=${member.userId}`);
      else if (balance < 0)
        errors.push(`negative balance ${balance} guild=${member.guildId} user=${member.userId}`);
      else member.balance = balance;
    }

    if (hasTable(legacy, 'guild_users')) {
      for (const row of legacy
        .prepare('SELECT guild_id, user_id FROM guild_users')
        .all() as Row[]) {
        ensure(text(row.guild_id), text(row.user_id));
      }
    }

    if (hasTable(legacy, 'escrow')) {
      for (const row of legacy
        .prepare('SELECT id, guild_id, user_id, amount FROM escrow ORDER BY id')
        .all() as Row[]) {
        const member = ensure(text(row.guild_id), text(row.user_id));
        if (!member) continue;
        const amount = toSafeNumber(row.amount);
        if (amount === null || amount <= 0) {
          errors.push(
            `bad escrow amount id=${text(row.id)} guild=${member.guildId} user=${member.userId}`,
          );
          continue;
        }
        member.escrow.push({ id: text(row.id), amount });
      }
    }

    const statusByGuild = new Map<
      string,
      { status: GuildStatus; name: string | null; decidedBy: string | null }
    >();
    if (hasTable(legacy, 'guild_status')) {
      for (const row of legacy
        .prepare('SELECT guild_id, status, name, decided_by FROM guild_status')
        .all() as Row[]) {
        const status = text(row.status);
        if (status !== 'pending' && status !== 'approved' && status !== 'denied') {
          errors.push(`unknown guild status ${status} guild=${text(row.guild_id)}`);
          continue;
        }
        statusByGuild.set(text(row.guild_id), {
          status,
          name: row.name === null || row.name === undefined ? null : text(row.name),
          decidedBy:
            row.decided_by === null || row.decided_by === undefined ? null : text(row.decided_by),
        });
      }
    }

    const guilds = new Map<string, GuildPlan>();
    for (const member of members.values()) {
      member.expected = member.balance + member.escrow.reduce((sum, e) => sum + e.amount, 0);
      if (!Number.isSafeInteger(member.expected)) {
        errors.push(`balance out of range guild=${member.guildId} user=${member.userId}`);
      }
      let guild = guilds.get(member.guildId);
      if (!guild) {
        const known = statusByGuild.get(member.guildId);
        if (!known)
          warnings.push(
            `guild ${member.guildId} has players but no guild_status: imported as approved`,
          );
        guild = {
          guildId: member.guildId,
          status: known?.status ?? 'approved',
          name: known?.name ?? null,
          decidedBy: known?.decidedBy ?? null,
          members: 0,
          expectedTotal: 0,
        };
        guilds.set(member.guildId, guild);
      }
      guild.members += 1;
      guild.expectedTotal += member.expected;
    }
    for (const guildId of statusByGuild.keys()) {
      if (!guilds.has(guildId) && SNOWFLAKE.test(guildId)) {
        const known = statusByGuild.get(guildId);
        if (known) {
          guilds.set(guildId, { guildId, ...known, members: 0, expectedTotal: 0 });
        }
      }
    }

    const legacyLedgerRows = hasTable(legacy, 'ledger')
      ? (toSafeNumber((legacy.prepare('SELECT COUNT(*) AS n FROM ledger').get() as Row).n) ?? 0)
      : 0;

    const ordered = [...members.values()].sort((a, b) =>
      a.guildId === b.guildId
        ? a.userId.localeCompare(b.userId)
        : a.guildId.localeCompare(b.guildId),
    );
    const hash = createHash('sha256');
    for (const m of ordered) {
      hash.update(
        `${m.guildId}:${m.userId}:${m.balance}:${m.escrow.map((e) => `${e.id}=${e.amount}`).join(',')}\n`,
      );
    }
    hash.update(`ledger:${legacyLedgerRows}`);

    return {
      guilds: [...guilds.values()].sort((a, b) => a.guildId.localeCompare(b.guildId)),
      members: ordered,
      legacyLedgerRows,
      digest: hash.digest('hex'),
      errors,
      warnings,
    };
  } finally {
    legacy.close();
  }
}

export interface RunImportOptions {
  legacyPath: string;
  /** Required to apply; in a dry run it only enables the "target already has accounts" check. */
  target?: { store: Store; economy: EconomyService; identity: IdentityRepo };
  apply: boolean;
  clock: Clock;
}

/**
 * Dry run: report totals per guild and per user. Apply: write everything in ONE transaction
 * through `EconomyService`, then assert that every user's new balance and every guild's total
 * equals the plan; any difference rolls the whole import back and throws.
 */
export function runImport(options: RunImportOptions): ImportReport {
  const plan = planImport(options.legacyPath);
  const target = options.target;

  if (target) {
    for (const m of plan.members) {
      if (target.economy.hasAccount(m.guildId, m.userId)) {
        plan.errors.push(`target already has an account guild=${m.guildId} user=${m.userId}`);
      }
    }
    const done = target.store
      .stmt('SELECT 1 FROM legacy_import_runs WHERE source_digest = ?')
      .get(plan.digest);
    if (done !== undefined) {
      plan.errors.length = 0;
      return { plan, mode: 'already-imported', verified: true };
    }
  }
  if (!options.apply) return { plan, mode: 'dry-run', verified: false };
  if (!target) throw new Error('apply needs a target database');
  if (plan.errors.length > 0) {
    throw new ImportMismatchError(
      `refusing to import: ${plan.errors.length} problem(s), see the report`,
    );
  }

  const { store, economy, identity } = target;
  const startedAt = options.clock.now();
  store.transaction(() => {
    for (const guild of plan.guilds) {
      identity.ensureGuild(guild.guildId, guild.status, guild.name);
      store
        .stmt('UPDATE guilds SET decided_by = ? WHERE guild_id = ?')
        .run(guild.decidedBy, guild.guildId);
    }
    for (const m of plan.members) {
      economy.ensureMember(m.guildId, m.userId, { initialGrant: false });
      if (m.balance > 0) {
        economy.apply({
          guildId: m.guildId,
          userId: m.userId,
          delta: m.balance,
          reason: 'legacy_import',
          idempotencyKey: 'legacy_import',
        });
      }
      for (const e of m.escrow) {
        economy.apply({
          guildId: m.guildId,
          userId: m.userId,
          delta: e.amount,
          reason: 'game_refund',
          refType: 'escrow',
          refId: e.id,
          idempotencyKey: `legacy_escrow:${e.id}`,
        });
      }
    }
    copyLegacyLedger(options.legacyPath, store);
    verify(plan, economy);
    store
      .stmt(
        `INSERT INTO legacy_import_runs (source_digest, source_path, started_at, finished_at, totals)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        plan.digest,
        options.legacyPath,
        startedAt,
        options.clock.now(),
        JSON.stringify({
          guilds: plan.guilds.map((g) => ({
            guildId: g.guildId,
            members: g.members,
            total: g.expectedTotal,
          })),
          legacyLedgerRows: plan.legacyLedgerRows,
        }),
      );
  });
  return { plan, mode: 'applied', verified: true };
}

function verify(plan: ImportPlan, economy: EconomyService): void {
  const perGuild = new Map<string, number>();
  for (const m of plan.members) {
    const actual = economy.getBalance(m.guildId, m.userId);
    if (actual !== m.expected) {
      throw new ImportMismatchError(
        `guild ${m.guildId} user ${m.userId}: expected ${m.expected}, imported ${actual}`,
      );
    }
    perGuild.set(m.guildId, (perGuild.get(m.guildId) ?? 0) + actual);
  }
  for (const g of plan.guilds) {
    const actual = perGuild.get(g.guildId) ?? 0;
    if (actual !== g.expectedTotal) {
      throw new ImportMismatchError(
        `guild ${g.guildId}: expected total ${g.expectedTotal}, imported ${actual}`,
      );
    }
  }
}

function copyLegacyLedger(legacyPath: string, store: Store): void {
  const legacy = new Database(legacyPath, { readonly: true, fileMustExist: true });
  legacy.defaultSafeIntegers(true);
  try {
    if (!hasTable(legacy, 'ledger')) return;
    const insert = store.stmt(
      `INSERT OR IGNORE INTO legacy_ledger (legacy_id, guild_id, user_id, delta, balance_after, reason, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of legacy
      .prepare(
        'SELECT id, guild_id, user_id, delta, balance_after, reason, ts FROM ledger ORDER BY id',
      )
      .iterate() as Iterable<Row>) {
      const guildId = text(row.guild_id);
      if (!SNOWFLAKE.test(guildId)) continue; // pre-guild rows (guild_id 0) have no home
      const delta = toSafeNumber(row.delta);
      const after = toSafeNumber(row.balance_after);
      if (delta === null || after === null) continue;
      insert.run(
        text(row.id),
        guildId,
        text(row.user_id),
        delta,
        after,
        text(row.reason),
        toMs(row.ts),
      );
    }
  } finally {
    legacy.close();
  }
}
