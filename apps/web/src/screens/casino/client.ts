import type {
  Ack,
  AckResult,
  ActionIntent,
  BetIntent,
  ErrorCode,
  GameId,
  IntentAck,
  TableSnapshot,
} from '@casino/shared';
import type { CasinoSocket } from '../../shell/socket.ts';

/** A refused or failed game call. `code` maps to the i18n key `error.<code>`. */
export class GameError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterMs: number | undefined;
  /** The socket was not connected: nothing reached the server. */
  readonly offline: boolean;
  constructor(code: ErrorCode, options: { retryAfterMs?: number; offline?: boolean } = {}) {
    super(code);
    this.name = 'GameError';
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
    this.offline = options.offline ?? false;
  }
}

export interface BetOutcome<T> {
  /** Balance in this guild after the intent. */
  balance: number;
  roundId: string | undefined;
  result: T;
  /** true when the server answered a repeated key from its store. */
  replayed: boolean;
}

export interface BetRequest {
  stake: number;
  bets?: BetIntent['bets'];
  roundId?: string;
  args?: BetIntent['args'];
}

export type TableListener = (snapshot: TableSnapshot) => void;

/**
 * What the screens need from the casino socket: intents with an acknowledgement, and the
 * live state of a shared table. The real one wraps the shell's socket; mock mode swaps in an
 * in-memory table so the screens run without a server.
 */
export interface CasinoClient {
  bet<T>(game: GameId, request: BetRequest): Promise<BetOutcome<T>>;
  action<T>(
    game: GameId,
    roundId: string,
    action: string,
    args?: ActionIntent['args'],
  ): Promise<BetOutcome<T>>;
  /** Join the table room and hear `table:state` until the returned function is called. */
  watchTable(game: GameId, listener: TableListener): () => void;
  /** Server clock minus local clock, in ms (0 when unknown). */
  clockOffsetMs(): number;
}

export const ACK_TIMEOUT_MS = 10_000;

/** A fresh idempotency key (16..64 chars of `[A-Za-z0-9_-]`). */
export function newKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  let out = '';
  for (let i = 0; i < 32; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

function settle<T>(ack: IntentAck): BetOutcome<T> {
  if (!ack.ok) {
    throw new GameError(
      ack.error,
      ack.retryAfterMs === undefined ? {} : { retryAfterMs: ack.retryAfterMs },
    );
  }
  return {
    balance: ack.balance,
    roundId: ack.roundId,
    result: ack.result as T,
    replayed: ack.replayed,
  };
}

export interface SocketClientOptions {
  getSocket: () => CasinoSocket | null;
  /** The instance the session belongs to; table snapshots of other instances are ignored. */
  getInstanceId: () => string | null;
  now?: () => number;
}

/** The client over the shell's Socket.io connection (`game:bet`, `game:action`, `table:*`). */
export function createSocketClient(options: SocketClientOptions): CasinoClient {
  const now = options.now ?? (() => Date.now());
  let offset = 0;
  let probed = false;

  const emitWithAck = <R>(
    send: (socket: CasinoSocket, done: (response: R) => void) => void,
  ): Promise<R> =>
    new Promise<R>((resolve, reject) => {
      const socket = options.getSocket();
      if (!socket || !socket.connected) {
        reject(new GameError('internal', { offline: true }));
        return;
      }
      const timer = setTimeout(() => reject(new GameError('internal')), ACK_TIMEOUT_MS);
      send(socket, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
    });

  const probeClock = (socket: CasinoSocket): void => {
    if (probed) return;
    probed = true;
    const sent = now();
    socket.emit('time:ping', (serverNow) => {
      const received = now();
      offset = serverNow - Math.round((sent + received) / 2);
    });
  };

  const watchers = new Map<GameId, Set<TableListener>>();
  let bound: CasinoSocket | null = null;

  const onState = (snapshot: TableSnapshot): void => {
    const instance = options.getInstanceId();
    if (instance !== null && snapshot.instanceId !== instance) return;
    for (const listener of watchers.get(snapshot.game) ?? []) listener(snapshot);
  };

  const join = (socket: CasinoSocket, game: GameId): void => {
    socket.emit('table:join', { game }, (response: AckResult<TableSnapshot>) => {
      if (response.ok) onState(response.data);
    });
  };

  const bind = (socket: CasinoSocket): void => {
    if (bound === socket) return;
    bound = socket;
    socket.on('table:state', onState);
    // After a reconnect the server forgot our rooms: join the watched tables again.
    socket.on('connect', () => {
      for (const game of watchers.keys()) join(socket, game);
    });
  };

  return {
    bet<T>(game: GameId, request: BetRequest) {
      const intent: BetIntent = {
        idempotencyKey: newKey(),
        game,
        stake: request.stake,
        ...(request.bets === undefined ? {} : { bets: request.bets }),
        ...(request.roundId === undefined ? {} : { roundId: request.roundId }),
        ...(request.args === undefined ? {} : { args: request.args }),
      };
      return emitWithAck<IntentAck>((socket, done) => {
        probeClock(socket);
        socket.emit('game:bet', intent, done);
      }).then((ack) => settle<T>(ack));
    },
    action<T>(game: GameId, roundId: string, action: string, args?: ActionIntent['args']) {
      const intent: ActionIntent = {
        idempotencyKey: newKey(),
        game,
        roundId,
        action,
        ...(args === undefined ? {} : { args }),
      };
      return emitWithAck<IntentAck>((socket, done) =>
        socket.emit('game:action', intent, done),
      ).then((ack) => settle<T>(ack));
    },
    watchTable(game, listener) {
      const socket = options.getSocket();
      const set = watchers.get(game) ?? new Set<TableListener>();
      const first = set.size === 0;
      set.add(listener);
      watchers.set(game, set);
      if (socket) {
        bind(socket);
        if (first && socket.connected) {
          probeClock(socket);
          join(socket, game);
        }
      }
      return () => {
        set.delete(listener);
        if (set.size > 0) return;
        watchers.delete(game);
        const live = options.getSocket();
        if (live?.connected) live.emit('table:leave', { game });
      };
    },
    clockOffsetMs: () => offset,
  };
}

export type { Ack };
