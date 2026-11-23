// Socket.io test clients on top of `startStack`: log in through POST /api/token like an Activity
// does, connect with the session token, and record everything the server pushes.
import { io as connect, type Socket } from 'socket.io-client';
import {
  SOCKET_PATH,
  type BalanceUpdate,
  type ClientToServerEvents,
  type DomainEvent,
  type IntentAck,
  type Participants,
  type ServerToClientEvents,
  type TableSnapshot,
  type TokenResponse,
} from '../../../packages/shared/src/index.ts';
import type { GameId } from '../../../packages/shared/src/index.ts';
import { GUILD_A, INSTANCE_A1, type Person, type Stack } from './stack.ts';

export type RawSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let counter = 0;
/** A fresh, valid idempotency key. */
export const newKey = (label = 'k'): string =>
  `${label}-${String(++counter).padStart(8, '0')}-${Math.random().toString(36).slice(2, 10)}`;

export interface Seen {
  tables: TableSnapshot[];
  balances: BalanceUpdate[];
  domain: DomainEvent[];
  participants: Participants[];
}

export interface TestClient {
  person: Person;
  guildId: string;
  instanceId: string;
  socket: RawSocket;
  token: TokenResponse;
  seen: Seen;
  /** Authorization + proxy headers for HTTP calls. */
  headers(): Record<string, string>;
  join(game: GameId): Promise<TableSnapshot>;
  leave(game: GameId): void;
  bet(
    game: GameId,
    stake: number,
    extra?: { bets?: { kind: string; targets: (number | string)[]; stake: number }[]; roundId?: string; args?: Record<string, string | number | boolean>; key?: string },
  ): Promise<IntentAck>;
  action(
    game: GameId,
    roundId: string,
    action: string,
    extra?: { args?: Record<string, string | number | boolean>; key?: string },
  ): Promise<IntentAck>;
  /** Latest snapshot of a game's table this client received. */
  lastTable(game: GameId): TableSnapshot | undefined;
  /** Resolves with the first `table:state` (already seen or still to come) that satisfies `test`. */
  waitTable(game: GameId, test: (s: TableSnapshot) => boolean, ms?: number): Promise<TableSnapshot>;
  waitFor(test: () => boolean, label: string, ms?: number): Promise<void>;
  balance(): Promise<number>;
  close(): void;
}

export interface ConnectOptions {
  guildId?: string;
  instanceId?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll `test` until it holds; throws with `label` after `ms`. */
export async function until(test: () => boolean, label: string, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await sleep(5);
  }
}

/** Let in-flight pushes land: for asserting that something did NOT arrive. */
export const settle = (ms = 120): Promise<void> => sleep(ms);

export async function login(
  stack: Stack,
  person: Person,
  options: ConnectOptions = {},
): Promise<TokenResponse> {
  const res = await stack.app.inject({
    method: 'POST',
    url: '/api/token',
    headers: stack.signed(),
    payload: {
      code: person.id,
      guildId: options.guildId ?? GUILD_A,
      instanceId: options.instanceId ?? INSTANCE_A1,
    },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return res.json<TokenResponse>();
}

/** Log in and connect a socket; resolves once the connection is up. */
export async function connectClient(
  stack: Stack,
  person: Person,
  options: ConnectOptions = {},
): Promise<TestClient> {
  const guildId = options.guildId ?? GUILD_A;
  const instanceId = options.instanceId ?? INSTANCE_A1;
  const token = await login(stack, person, { guildId, instanceId });
  const seen: Seen = { tables: [], balances: [], domain: [], participants: [] };
  const socket: RawSocket = connect(stack.url, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    auth: { token: token.sessionToken },
    extraHeaders: stack.signed(),
    reconnection: false,
    forceNew: true,
  });
  socket.on('table:state', (s) => seen.tables.push(s));
  socket.on('balance:update', (u) => seen.balances.push(u));
  socket.on('domain:event', (e) => seen.domain.push(e));
  socket.on('instance:participants', (p) => seen.participants.push(p));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });

  const client: TestClient = {
    person,
    guildId,
    instanceId,
    socket,
    token,
    seen,
    headers: () => ({
      ...stack.signed(),
      authorization: `Bearer ${token.sessionToken}`,
    }),
    async join(game) {
      const res = await socket.emitWithAck('table:join', { game });
      if (!res.ok) throw new Error(`table:join ${game}: ${res.error}`);
      seen.tables.push(res.data);
      return res.data;
    },
    leave(game) {
      socket.emit('table:leave', { game });
    },
    bet(game, stake, extra = {}) {
      return socket.emitWithAck('game:bet', {
        idempotencyKey: extra.key ?? newKey('bet'),
        game,
        stake,
        ...(extra.bets === undefined ? {} : { bets: extra.bets }),
        ...(extra.roundId === undefined ? {} : { roundId: extra.roundId }),
        ...(extra.args === undefined ? {} : { args: extra.args }),
      });
    },
    action(game, roundId, action, extra = {}) {
      return socket.emitWithAck('game:action', {
        idempotencyKey: extra.key ?? newKey('act'),
        game,
        roundId,
        action,
        ...(extra.args === undefined ? {} : { args: extra.args }),
      });
    },
    lastTable: (game) => [...seen.tables].reverse().find((s) => s.game === game),
    async waitTable(game, test, ms = 3000) {
      let found: TableSnapshot | undefined;
      await until(
        () => {
          found = seen.tables.find((s) => s.game === game && test(s));
          return found !== undefined;
        },
        `${person.username}: a ${game} table state`,
        ms,
      );
      return found as TableSnapshot;
    },
    waitFor: (test, label, ms) => until(test, `${person.username}: ${label}`, ms),
    async balance() {
      const res = await stack.app.inject({ url: '/api/me', headers: client.headers() });
      return res.json<{ balance: number }>().balance;
    },
    close() {
      socket.close();
    },
  };
  return client;
}
