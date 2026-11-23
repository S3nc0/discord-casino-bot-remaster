// Load script for the Pi performance check (ops/pi-sim/perf.sh runs it against the pi-sim
// container; it also works against any running server: `node apps/server/scripts/load.ts`).
//
// It logs in N simulated players with session tokens it signs itself (HS256 over SESSION_SECRET,
// the same shape `POST /api/token` returns; the harness starts the server with a throw-away
// secret and BOT_DISABLED=1, so nothing reaches Discord), then runs a realistic mix for a
// fixed time: roulette, slots, blackjack seats, race bets, daily claims, transfers, market
// orders and read-only screens. It records round trips on the client side and reads the
// server-side probe file (ops/pi-sim/perf/probe.cjs) for RSS, CPU and event-loop lag, then
// checks the targets and writes a JSON result and a Markdown table.
//
// Only node built-ins and socket.io-client are used. Run with `--help` for the options.
import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@casino/shared';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

/** The targets. They are fixed; do not raise them to make a run pass. */
export const TARGETS = {
  idleRssMb: 150,
  loadRssMb: 250,
  socketRttP95Ms: 50,
  coldStartMs: 5000,
} as const;

const SOCKET_PATH = '/api/socket.io';
const GUILD_ID = '900000000000000001';
const INSTANCE_ID = 'perf-instance-1';
const SYMBOLS = ['cs', 'teio', 'numa', 'gold'] as const;

// ---- options ---------------------------------------------------------------------------------

interface Options {
  url: string;
  players: number;
  durationS: number;
  idleS: number;
  rateScale: number;
  secret: string;
  probe: string | null;
  coldStartMs: number | null;
  /** Docker container to read the cgroup memory peak from at the end. */
  container: string | null;
  json: string | null;
  markdown: string | null;
  label: string;
  gate: boolean;
}

const HELP = `usage: node load.ts [options]
  --url <http://127.0.0.1:3001>   server base URL
  --players <30>                  simulated players
  --duration <300>                seconds of load
  --idle <10>                     seconds of idle measurement before the load starts
  --rate-scale <1>                multiply every player's action rate
  --secret <SESSION_SECRET>       token signing secret (or env SESSION_SECRET)
  --probe <file>                  server-side probe output (RSS, CPU, event-loop lag)
  --cold-start-ms <n>             cold start measured by the harness (container start to health)
  --container <name>              docker container whose cgroup memory peak is read at the end
  --json <file>  --markdown <file>  write the result
  --label <text>                  title of the Markdown table
  --no-gate                       print the result but always exit 0
`;

function parseArgs(argv: string[]): Options {
  const values = new Map<string, string>();
  let gate = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(HELP);
      process.exit(0);
    }
    if (arg === '--no-gate') {
      gate = false;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    values.set(arg.slice(2), value);
  }
  const num = (key: string, fallback: number): number => {
    const raw = values.get(key);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${key} must be a number`);
    return n;
  };
  const optNum = (key: string): number | null => (values.has(key) ? num(key, 0) : null);
  const secret = values.get('secret') ?? process.env['SESSION_SECRET'] ?? '';
  if (secret.length < 32) throw new Error('--secret (or SESSION_SECRET) must be at least 32 chars');
  return {
    url: values.get('url') ?? 'http://127.0.0.1:3001',
    players: num('players', 30),
    durationS: num('duration', 300),
    idleS: num('idle', 10),
    rateScale: num('rate-scale', 1) || 1,
    secret,
    probe: values.get('probe') ?? null,
    coldStartMs: optNum('cold-start-ms'),
    container: values.get('container') ?? null,
    json: values.get('json') ?? null,
    markdown: values.get('markdown') ?? null,
    label: values.get('label') ?? 'Pi performance',
    gate,
  };
}

// ---- small helpers ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const key = (): string => randomBytes(12).toString('base64url');
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T;
const between = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min));

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] as number;
}

const sortedCopy = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);
const round = (n: number, digits = 1): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

function sessionToken(secret: string, userId: string, ttlS: number): string {
  const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const signingInput = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    v: 1,
    sub: userId,
    gid: GUILD_ID,
    iid: INSTANCE_ID,
    loc: 'en',
    iat,
    exp: iat + ttlS,
    jti: randomBytes(16).toString('base64url'),
  })}`;
  return `${signingInput}.${createHmac('sha256', secret).update(signingInput).digest('base64url')}`;
}

// ---- recording -------------------------------------------------------------------------------

/**
 * A refusal is part of normal play unless it says the server broke or the session is bad: no
 * money, a table between rounds, one game at a time (`game_busy`), a rule. Only these count as
 * failures.
 */
const UNEXPECTED_ERRORS = new Set(['internal', 'unauthorized', 'expired', 'feature_disabled']);

interface OpStats {
  ok: number;
  rejected: number;
  failed: number;
  rttMs: number[];
}

class Recorder {
  readonly ops = new Map<string, OpStats>();
  readonly pingRtt: number[] = [];
  readonly failures: string[] = [];
  disconnects = 0;
  private active = false;

  start(): void {
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  private stats(op: string): OpStats {
    let s = this.ops.get(op);
    if (!s) this.ops.set(op, (s = { ok: 0, rejected: 0, failed: 0, rttMs: [] }));
    return s;
  }

  record(op: string, outcome: 'ok' | 'rejected' | 'failed', rttMs: number, detail = ''): void {
    if (!this.active) return;
    const s = this.stats(op);
    s[outcome]++;
    s.rttMs.push(rttMs);
    if (outcome === 'failed' && this.failures.length < 20) this.failures.push(`${op}: ${detail}`);
  }

  ping(rttMs: number): void {
    if (this.active) this.pingRtt.push(rttMs);
  }
}

// ---- a simulated player ----------------------------------------------------------------------

class Player {
  private socket: Client | null = null;
  private readonly timers = new Set<NodeJS.Timeout>();
  private running = false;
  private blackjackRound: string | null = null;

  readonly userId: string;
  private readonly token: string;
  private readonly opts: Options;
  private readonly rec: Recorder;
  private readonly peers: () => readonly string[];

  constructor(
    userId: string,
    token: string,
    opts: Options,
    rec: Recorder,
    peers: () => readonly string[],
  ) {
    this.userId = userId;
    this.token = token;
    this.opts = opts;
    this.rec = rec;
    this.peers = peers;
  }

  async connect(): Promise<void> {
    const socket: Client = connect(this.opts.url, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      auth: { token: this.token },
      reconnection: false,
      forceNew: true,
    });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('socket connect timed out')), 15_000);
      socket.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    socket.on('disconnect', (reason) => {
      if (this.running && reason !== 'io client disconnect') this.rec.disconnects++;
    });
    // Same rooms and snapshots a player's Activity subscribes to.
    socket.on('table:state', (state) => {
      if (state.game === 'blackjack') this.blackjackRound = state.roundId ?? null;
    });
    for (const game of ['roulette', 'blackjack'] as const) {
      await socket.emitWithAck('table:join', { game }).catch(() => undefined);
    }
  }

  start(): void {
    this.running = true;
    const scale = this.opts.rateScale;
    // [name, min ms, max ms, action]. Each task re-arms itself with a random delay.
    const tasks: [string, number, number, () => Promise<void>][] = [
      ['ping', 1000, 1000, () => this.ping()],
      // One casino round at a time per player, like the real session guard allows.
      ['game', 500, 1500, () => this.game()],
      ['race', 15000, 25000, () => this.race()],
      ['daily', 40000, 70000, () => this.daily()],
      ['transfer', 12000, 22000, () => this.transfer()],
      ['market', 7000, 12000, () => this.market()],
      ['screens', 8000, 14000, () => this.screens()],
    ];
    for (const [name, min, max, run] of tasks) {
      const arm = (first: boolean): void => {
        if (!this.running) return;
        const delay = first ? between(0, max) / scale : between(min, max + 1) / scale;
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          run()
            .catch((error: unknown) => {
              this.rec.record(name, 'failed', 0, error instanceof Error ? error.message : 'error');
            })
            .finally(() => arm(false));
        }, delay);
        this.timers.add(timer);
      };
      arm(true);
    }
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.socket?.close();
  }

  // -- socket actions

  private async ping(): Promise<void> {
    const at = performance.now();
    await this.socket?.timeout(5000).emitWithAck('time:ping');
    this.rec.ping(performance.now() - at);
  }

  private async intent(
    op: string,
    payload: ClientToServerEvents['game:bet'] extends (p: infer P, ...rest: never[]) => void
      ? P
      : never,
  ): Promise<{ ok: boolean; result?: unknown; retryAfterMs?: number } | null> {
    const at = performance.now();
    const ack = await this.socket?.timeout(10_000).emitWithAck('game:bet', payload);
    const rtt = performance.now() - at;
    if (!ack) return null;
    if (ack.ok) {
      this.rec.record(op, 'ok', rtt);
      return { ok: true, result: ack.result };
    }
    this.rec.record(
      op,
      UNEXPECTED_ERRORS.has(ack.error) ? 'failed' : 'rejected',
      rtt,
      `bet rejected: ${ack.error}`,
    );
    return {
      ok: false,
      ...(ack.retryAfterMs === undefined ? {} : { retryAfterMs: ack.retryAfterMs }),
    };
  }

  /** Play one round of a random game, then wait for it to end (or for the cooldown). */
  private async game(): Promise<void> {
    const roll = Math.random();
    const waitMs =
      roll < 0.5 ? await this.slots() : roll < 0.8 ? await this.roulette() : await this.blackjack();
    await sleep(waitMs / this.opts.rateScale);
  }

  /** What to wait before the next round: the cooldown the server named, or a default. */
  private busyWait(bet: { ok: boolean; retryAfterMs?: number } | null): number {
    return (bet?.retryAfterMs ?? 4000) + between(0, 500);
  }

  private async slots(): Promise<number> {
    const bet = await this.intent('slots', { idempotencyKey: key(), game: 'slots', stake: 10 });
    return bet?.ok ? between(2500, 5000) : this.busyWait(bet);
  }

  private async roulette(): Promise<number> {
    const stake = pick([10, 20, 50]);
    const bet = await this.intent('roulette', {
      idempotencyKey: key(),
      game: 'roulette',
      stake,
      bets: [{ kind: pick(['red', 'black', 'odd', 'even']), targets: [], stake }],
    });
    // The table spins 20 s after its first bet and shows the result for 6 s.
    return bet?.ok ? between(22_000, 28_000) : this.busyWait(bet);
  }

  private async blackjack(): Promise<number> {
    const roundId = this.blackjackRound;
    const bet = await this.intent('blackjack_bet', {
      idempotencyKey: key(),
      game: 'blackjack',
      stake: 20,
      ...(roundId === null ? {} : { roundId }),
    });
    const placed = (bet?.result as { roundId?: string } | undefined)?.roundId;
    if (!bet?.ok || !placed) return this.busyWait(bet);
    // The seat acts a moment later: start the hand, maybe hit once, then stand.
    for (const action of ['deal', ...(Math.random() < 0.5 ? ['hit'] : []), 'stand']) {
      await sleep(between(600, 1600) / this.opts.rateScale);
      const at = performance.now();
      const ack = await this.socket?.timeout(10_000).emitWithAck('game:action', {
        idempotencyKey: key(),
        game: 'blackjack',
        roundId: placed,
        action,
      });
      const rtt = performance.now() - at;
      if (!ack) break;
      if (ack.ok) {
        this.rec.record(`blackjack_${action}`, 'ok', rtt);
        continue;
      }
      // `conflict` and the like: the table dealt or settled without us. Normal when shared.
      const expected = !UNEXPECTED_ERRORS.has(ack.error);
      this.rec.record(`blackjack_${action}`, expected ? 'rejected' : 'failed', rtt, ack.error);
      if (expected) break;
    }
    return between(8000, 16_000);
  }

  // -- HTTP actions

  private async http(
    op: string,
    method: 'GET' | 'POST',
    path: string,
    body?: object,
  ): Promise<unknown> {
    const at = performance.now();
    const response = await fetch(`${this.opts.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        // Behind the tunnel every player has their own address (the IP limit is per client).
        'x-forwarded-for': `10.1.${Number(this.userId.slice(-5)) >> 8}.${Number(this.userId.slice(-5)) & 255}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    const rtt = performance.now() - at;
    const text = await response.text();
    if (response.status >= 500) {
      this.rec.record(op, 'failed', rtt, `HTTP ${response.status}`);
    } else if (response.ok) {
      this.rec.record(op, 'ok', rtt);
    } else if (response.status === 401 || response.status === 403) {
      this.rec.record(op, 'failed', rtt, `HTTP ${response.status}`);
    } else {
      // 400/404/409/429: a game rule or limit said no. Counted, not a failure.
      this.rec.record(op, 'rejected', rtt);
    }
    try {
      return text.length > 0 ? (JSON.parse(text) as unknown) : null;
    } catch {
      return null;
    }
  }

  private async daily(): Promise<void> {
    await this.http('daily_status', 'GET', '/api/daily');
    await this.http('daily_claim', 'POST', '/api/daily/claim', { idempotencyKey: key() });
  }

  private async transfer(): Promise<void> {
    const others = this.peers().filter((id) => id !== this.userId);
    const receiverId = pick(others);
    const amount = between(10, 60);
    await this.http('transfer_preview', 'POST', '/api/life/transfer/preview', {
      receiverId,
      amount,
    });
    await this.http('transfer_send', 'POST', '/api/life/transfer/send', {
      idempotencyKey: key(),
      receiverId,
      amount,
    });
  }

  private async market(): Promise<void> {
    await this.http('market_view', 'GET', '/api/finance/market');
    await this.http('market_spot', 'POST', '/api/finance/market/spot', {
      idempotencyKey: key(),
      symbol: pick(SYMBOLS),
      amount: between(50, 200),
    });
  }

  private async race(): Promise<void> {
    const card = (await this.http('race_card', 'GET', '/api/horse/card')) as {
      races?: { id: number; phase: string }[];
    } | null;
    const open = card?.races?.find((race) => race.phase === 'betting');
    if (!open) return;
    await this.http('race_bet', 'POST', `/api/horse/races/${open.id}/bet`, {
      idempotencyKey: key(),
      kind: 'win',
      lanes: [between(1, 5)],
      stake: 10,
    });
  }

  private async screens(): Promise<void> {
    await this.http('me', 'GET', '/api/me');
    await this.http('casino_overview', 'GET', '/api/casino/overview');
    await this.http('inbox', 'GET', '/api/inbox');
  }
}

// ---- probe file ------------------------------------------------------------------------------

interface ProbeSample {
  t: number;
  rssMb: number;
  heapMb: number;
  cpuPct: number;
  lag: number[];
}

function readProbe(file: string): { samples: ProbeSample[]; listeningUptimeMs: number | null } {
  if (!existsSync(file)) return { samples: [], listeningUptimeMs: null };
  const samples: ProbeSample[] = [];
  let listeningUptimeMs: number | null = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.length === 0) continue;
    try {
      const record = JSON.parse(line) as { type: string; uptimeMs?: number } & ProbeSample;
      if (record.type === 'listening') listeningUptimeMs = record.uptimeMs ?? null;
      else if (record.type === 'sample') samples.push(record);
    } catch {
      // A line cut off at the end of the file.
    }
  }
  return { samples, listeningUptimeMs };
}

/** Peak memory of the container's cgroup (v2 `memory.peak`, else v1), in MB. */
function cgroupPeakMb(container: string): number | null {
  for (const file of [
    '/sys/fs/cgroup/memory.peak',
    '/sys/fs/cgroup/memory/memory.max_usage_in_bytes',
  ]) {
    try {
      const bytes = Number(
        execFileSync('docker', ['exec', container, 'cat', file], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim(),
      );
      if (Number.isFinite(bytes) && bytes > 0) return round(bytes / 1048576);
    } catch {
      // not this cgroup version
    }
  }
  return null;
}

const within = (samples: readonly ProbeSample[], from: number, to: number): ProbeSample[] =>
  samples.filter((s) => s.t >= from && s.t <= to);

function summarize(values: readonly number[]): {
  p50: number;
  p95: number;
  p99: number;
  max: number;
} {
  const sorted = sortedCopy(values);
  return {
    p50: round(percentile(sorted, 50), 2),
    p95: round(percentile(sorted, 95), 2),
    p99: round(percentile(sorted, 99), 2),
    max: round(sorted.at(-1) ?? NaN, 2),
  };
}

// ---- result ----------------------------------------------------------------------------------

interface Check {
  name: string;
  value: number | null;
  limit: number;
  /** The target is "at most" (RSS) or "below" (latency, start). */
  inclusive: boolean;
  unit: string;
  pass: boolean;
}

function check(
  name: string,
  value: number | null,
  limit: number,
  unit: string,
  inclusive: boolean,
): Check {
  const pass =
    value !== null && Number.isFinite(value) && (inclusive ? value <= limit : value < limit);
  return { name, value, limit, inclusive, unit, pass };
}

export interface PerfResult {
  label: string;
  players: number;
  durationS: number;
  checks: Check[];
  idleRssMb: number | null;
  loadRssPeakMb: number | null;
  loadRssSteadyMb: number | null;
  cgroupPeakMb: number | null;
  cpuPct: { mean: number; p95: number } | null;
  eventLoopLagMs: { idle: ReturnType<typeof summarize>; load: ReturnType<typeof summarize> } | null;
  socketRttMs: ReturnType<typeof summarize>;
  coldStartMs: number | null;
  serverListenMs: number | null;
  ops: Record<string, { ok: number; rejected: number; failed: number; p95Ms: number }>;
  failures: string[];
  disconnects: number;
  pass: boolean;
}

function markdown(result: PerfResult): string {
  const fmt = (n: number | null, unit = ''): string => (n === null ? 'n/a' : `${n}${unit}`);
  const lines = [
    `### ${result.label}`,
    '',
    `${result.players} players, ${result.durationS} s of load.`,
    '',
    '| Metric | Value | Target | |',
    '| --- | --- | --- | --- |',
    ...result.checks.map(
      (c) =>
        `| ${c.name} | ${fmt(c.value, ` ${c.unit}`)} | ${c.inclusive ? '≤' : '<'} ${c.limit} ${c.unit} | ${c.pass ? 'pass' : 'FAIL'} |`,
    ),
    '',
    '| Other | Value |',
    '| --- | --- |',
    `| RSS under load, steady (median of the second half) | ${fmt(result.loadRssSteadyMb, ' MB')} |`,
    `| Container memory peak (cgroup) | ${fmt(result.cgroupPeakMb, ' MB')} |`,
    `| CPU, mean / p95 (% of one core, 2 cores available) | ${result.cpuPct ? `${result.cpuPct.mean} / ${result.cpuPct.p95}` : 'n/a'} |`,
    `| Event-loop lag idle, p50 / p95 / p99 | ${result.eventLoopLagMs ? `${result.eventLoopLagMs.idle.p50} / ${result.eventLoopLagMs.idle.p95} / ${result.eventLoopLagMs.idle.p99} ms` : 'n/a'} |`,
    `| Event-loop lag under load, p50 / p95 / p99 | ${result.eventLoopLagMs ? `${result.eventLoopLagMs.load.p50} / ${result.eventLoopLagMs.load.p95} / ${result.eventLoopLagMs.load.p99} ms` : 'n/a'} |`,
    `| Socket round trip, p50 / p95 / p99 | ${result.socketRttMs.p50} / ${result.socketRttMs.p95} / ${result.socketRttMs.p99} ms |`,
    `| Server start to listening (inside the process) | ${fmt(result.serverListenMs, ' ms')} |`,
    '',
    '| Operation | ok | refused by a rule | failed | p95 |',
    '| --- | --- | --- | --- | --- |',
    ...Object.entries(result.ops).map(
      ([op, s]) => `| ${op} | ${s.ok} | ${s.rejected} | ${s.failed} | ${s.p95Ms} ms |`,
    ),
    '',
  ];
  return lines.join('\n');
}

// ---- main ------------------------------------------------------------------------------------

async function waitForHealth(url: string): Promise<void> {
  const until = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > until) throw new Error('server did not answer /api/health within 60 s');
    await sleep(250);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const log = (message: string): void => {
    process.stderr.write(`[load] ${message}\n`);
  };

  await waitForHealth(opts.url);
  log(`server up at ${opts.url}`);

  const idleFrom = Date.now();
  if (opts.idleS > 0) {
    log(`idle window ${opts.idleS} s`);
    await sleep(opts.idleS * 1000);
  }
  const idleTo = Date.now();

  const ids = Array.from(
    { length: opts.players },
    (_, i) => `9000000000000${String(i).padStart(5, '0')}`,
  );
  const ttl = Math.ceil(opts.durationS + 120);
  const rec = new Recorder();
  const players = ids.map(
    (id) => new Player(id, sessionToken(opts.secret, id, ttl), opts, rec, () => ids),
  );
  log(`connecting ${players.length} players`);
  await Promise.all(players.map((p) => p.connect()));

  // The first request per player creates the member (start balance), outside the measured window.
  rec.start();
  const loadFrom = Date.now();
  for (const player of players) player.start();
  log(`load for ${opts.durationS} s`);
  await sleep(opts.durationS * 1000);
  const loadTo = Date.now();
  for (const player of players) player.stop();
  rec.stop();
  await sleep(1500);

  const probe = opts.probe ? readProbe(opts.probe) : { samples: [], listeningUptimeMs: null };
  const idle = within(probe.samples, idleFrom, idleTo);
  const load = within(probe.samples, loadFrom, loadTo);
  const haveProbe = idle.length > 0 && load.length > 0;
  const median = (values: number[]): number => percentile(sortedCopy(values), 50);

  const idleRssMb = haveProbe ? round(median(idle.map((s) => s.rssMb))) : null;
  const loadRssPeakMb = haveProbe ? round(Math.max(...load.map((s) => s.rssMb))) : null;
  const loadRssSteadyMb = haveProbe
    ? round(median(load.slice(Math.floor(load.length / 2)).map((s) => s.rssMb)))
    : null;
  const cpu = load.map((s) => s.cpuPct);
  const rtt = summarize(rec.pingRtt);

  const checks: Check[] = [
    check('Idle RSS after boot', idleRssMb, TARGETS.idleRssMb, 'MB', true),
    check('RSS under load, peak', loadRssPeakMb, TARGETS.loadRssMb, 'MB', true),
    check('Socket round trip p95 (loopback)', rtt.p95, TARGETS.socketRttP95Ms, 'ms', false),
    check('Cold start to listening', opts.coldStartMs, TARGETS.coldStartMs, 'ms', false),
  ];
  const failedOps = [...rec.ops.values()].reduce((sum, s) => sum + s.failed, 0);
  checks.push(check('Unexpected failures (5xx, internal, 401)', failedOps, 0, '', true));
  checks.push(check('Unexpected disconnects', rec.disconnects, 0, '', true));

  const result: PerfResult = {
    label: opts.label,
    players: opts.players,
    durationS: opts.durationS,
    checks,
    idleRssMb,
    loadRssPeakMb,
    loadRssSteadyMb,
    cgroupPeakMb: opts.container === null ? null : cgroupPeakMb(opts.container),
    cpuPct: haveProbe
      ? {
          mean: round(cpu.reduce((a, b) => a + b, 0) / cpu.length),
          p95: round(percentile(sortedCopy(cpu), 95)),
        }
      : null,
    eventLoopLagMs: haveProbe
      ? {
          idle: summarize(idle.flatMap((s) => s.lag)),
          load: summarize(load.flatMap((s) => s.lag)),
        }
      : null,
    socketRttMs: rtt,
    coldStartMs: opts.coldStartMs,
    serverListenMs: probe.listeningUptimeMs,
    ops: Object.fromEntries(
      [...rec.ops.entries()].map(([op, s]) => [
        op,
        {
          ok: s.ok,
          rejected: s.rejected,
          failed: s.failed,
          p95Ms: round(percentile(sortedCopy(s.rttMs), 95)),
        },
      ]),
    ),
    failures: rec.failures,
    disconnects: rec.disconnects,
    pass: checks.every((c) => c.pass),
  };

  const table = markdown(result);
  process.stdout.write(`${table}\n`);
  if (result.failures.length > 0)
    process.stdout.write(`First failures:\n${result.failures.join('\n')}\n`);
  if (opts.json) writeFileSync(opts.json, `${JSON.stringify(result, null, 2)}\n`);
  if (opts.markdown) writeFileSync(opts.markdown, `${table}\n`);
  if (!result.pass && opts.gate) {
    process.stderr.write('[load] a target was missed\n');
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[load] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(2);
});
