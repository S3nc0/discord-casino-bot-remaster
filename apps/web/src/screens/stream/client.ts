import {
  ERROR_CODES,
  LIFE_ROUTES,
  STREAM_ROUTES,
  type AckResult,
  type DomainEvent,
  type ErrorCode,
  type StreamBetResponse,
  type StreamEndResponse,
  type StreamList,
  type StreamSettleResponse,
  type StreamSide,
  type StreamStartResponse,
  type StreamTipResponse,
  type StreamView,
  type StreamWriteResponse,
  type TransferView,
} from '@casino/shared';
import type { CasinoSocket } from '../../shell/socket.ts';

/** A refusal from a stream route: generic `code` plus the `rule` (and `params`) that said no. */
export class StreamApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly rule: string | undefined;
  readonly params: Record<string, string | number> | undefined;
  readonly retryAfterMs: number | undefined;
  constructor(
    code: ErrorCode,
    status: number,
    extra: { rule?: string; params?: Record<string, string | number>; retryAfterMs?: number } = {},
  ) {
    super(extra.rule ?? code);
    this.name = 'StreamApiError';
    this.code = code;
    this.status = status;
    this.rule = extra.rule;
    this.params = extra.params;
    this.retryAfterMs = extra.retryAfterMs;
  }
  /** The server may not have seen the request (offline, proxy or 5xx): safe to retry with the same key. */
  get transient(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export type StreamDomainEvent = Extract<
  DomainEvent,
  {
    type:
      | 'StreamStarted'
      | 'StreamTipped'
      | 'StreamBetPlaced'
      | 'StreamRoundOpened'
      | 'StreamRoundLocked'
      | 'StreamRoundSettled'
      | 'StreamEnded';
  }
>;

const STREAM_EVENT_TYPES = new Set<string>([
  'StreamStarted',
  'StreamTipped',
  'StreamBetPlaced',
  'StreamRoundOpened',
  'StreamRoundLocked',
  'StreamRoundSettled',
  'StreamEnded',
]);

export function isStreamDomainEvent(event: DomainEvent): event is StreamDomainEvent {
  return STREAM_EVENT_TYPES.has(event.type);
}

/** HTTP routes the stream screen calls. Writes take their idempotency key last. */
export interface StreamApi {
  streams(): Promise<StreamList>;
  view(streamId: number): Promise<StreamView>;
  /** Shared transfer limits (fee rate, daily cap remaining, confirmation threshold). */
  transfer(): Promise<TransferView>;
  start(input: { title: string; url?: string }, key: string): Promise<StreamStartResponse>;
  tip(
    input: { streamId: number; amount: number; message?: string },
    key: string,
  ): Promise<StreamTipResponse>;
  bet(
    input: { streamId: number; roundId: number; side: StreamSide; amount: number },
    key: string,
  ): Promise<StreamBetResponse>;
  openRound(input: { streamId: number; label?: string }, key: string): Promise<StreamWriteResponse>;
  lock(input: { streamId: number; roundId: number }, key: string): Promise<StreamWriteResponse>;
  settle(
    input: { streamId: number; roundId: number; winner: StreamSide },
    key: string,
  ): Promise<StreamSettleResponse>;
  voidRound(
    input: { streamId: number; roundId: number },
    key: string,
  ): Promise<StreamSettleResponse>;
  end(input: { streamId: number }, key: string): Promise<StreamEndResponse>;
}

/** Live room join/leave and guild/stream domain events over Socket.io. */
export interface StreamSocket {
  /** Join `stream:{guild}:{id}` and deliver the ack snapshot; returns a leave callback. */
  join(streamId: number, onSnapshot: (view: StreamView) => void): () => void;
  /** Subscribe to stream domain events of the active guild. */
  onEvent(listener: (event: StreamDomainEvent) => void): () => void;
}

export interface HttpStreamApiOptions {
  prefix: string;
  getSessionToken: () => string | null;
  fetchImpl?: typeof fetch;
}

const isErrorCode = (v: unknown): v is ErrorCode =>
  typeof v === 'string' && (ERROR_CODES as readonly string[]).includes(v);

export function createHttpStreamApi({
  prefix,
  getSessionToken,
  fetchImpl,
}: HttpStreamApiOptions): StreamApi {
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    let response: Response;
    try {
      response = await (fetchImpl ?? fetch)(`${prefix}${path}`, init);
    } catch {
      throw new StreamApiError('internal', 0);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const p = (payload ?? {}) as {
        error?: unknown;
        rule?: unknown;
        params?: unknown;
        retryAfterMs?: unknown;
      };
      const code: ErrorCode = isErrorCode(p.error)
        ? p.error
        : response.status === 401
          ? 'unauthorized'
          : 'internal';
      throw new StreamApiError(code, response.status, {
        ...(typeof p.rule === 'string' ? { rule: p.rule } : {}),
        ...(p.params && typeof p.params === 'object'
          ? { params: p.params as Record<string, string | number> }
          : {}),
        ...(typeof p.retryAfterMs === 'number' ? { retryAfterMs: p.retryAfterMs } : {}),
      });
    }
    return payload as T;
  }

  const post = <T>(path: string, body: object) => call<T>('POST', path, body);

  return {
    streams: () => call<StreamList>('GET', STREAM_ROUTES.streams),
    view: (streamId) =>
      call<StreamView>('GET', `${STREAM_ROUTES.view}?streamId=${encodeURIComponent(streamId)}`),
    transfer: () => call<TransferView>('GET', LIFE_ROUTES.transfer),
    start: ({ title, url }, key) =>
      post(STREAM_ROUTES.start, {
        idempotencyKey: key,
        title,
        ...(url !== undefined && url !== '' ? { url } : {}),
      }),
    tip: ({ streamId, amount, message }, key) =>
      post(STREAM_ROUTES.tip, {
        idempotencyKey: key,
        streamId,
        amount,
        ...(message !== undefined && message !== '' ? { message } : {}),
      }),
    bet: ({ streamId, roundId, side, amount }, key) =>
      post(STREAM_ROUTES.bet, { idempotencyKey: key, streamId, roundId, side, amount }),
    openRound: ({ streamId, label }, key) =>
      post(STREAM_ROUTES.open, {
        idempotencyKey: key,
        streamId,
        ...(label !== undefined && label !== '' ? { label } : {}),
      }),
    lock: ({ streamId, roundId }, key) =>
      post(STREAM_ROUTES.lock, { idempotencyKey: key, streamId, roundId }),
    settle: ({ streamId, roundId, winner }, key) =>
      post(STREAM_ROUTES.settle, { idempotencyKey: key, streamId, roundId, winner }),
    voidRound: ({ streamId, roundId }, key) =>
      post(STREAM_ROUTES.void, { idempotencyKey: key, streamId, roundId }),
    end: ({ streamId }, key) => post(STREAM_ROUTES.end, { idempotencyKey: key, streamId }),
  };
}

export interface StreamSocketOptions {
  getSocket: () => CasinoSocket | null;
  getGuildId: () => string | null;
}

/** Wraps the shell Socket.io link for `stream:join` / `stream:leave` and stream `domain:event`s. */
export function createStreamSocket({ getSocket, getGuildId }: StreamSocketOptions): StreamSocket {
  const joined = new Map<number, Set<(view: StreamView) => void>>();
  const eventListeners = new Set<(event: StreamDomainEvent) => void>();
  let bound: CasinoSocket | null = null;

  const emitJoin = (socket: CasinoSocket, streamId: number): void => {
    socket.emit('stream:join', { streamId }, (ack: AckResult<StreamView>) => {
      if (!ack.ok) return;
      for (const cb of joined.get(streamId) ?? []) cb(ack.data);
    });
  };

  const onDomain = (event: DomainEvent): void => {
    const guildId = getGuildId();
    if (guildId !== null && event.guildId !== guildId) return;
    if (!isStreamDomainEvent(event)) return;
    for (const listener of eventListeners) listener(event);
  };

  const onConnect = (): void => {
    const socket = getSocket();
    if (!socket) return;
    for (const streamId of joined.keys()) emitJoin(socket, streamId);
  };

  const ensureBound = (): CasinoSocket | null => {
    const socket = getSocket();
    if (!socket) return null;
    if (bound !== socket) {
      bound?.off('domain:event', onDomain);
      bound?.off('connect', onConnect);
      bound = socket;
      socket.on('domain:event', onDomain);
      socket.on('connect', onConnect);
    }
    return socket;
  };

  return {
    join(streamId, onSnapshot) {
      let set = joined.get(streamId);
      const first = !set;
      if (!set) joined.set(streamId, (set = new Set()));
      set.add(onSnapshot);
      const socket = ensureBound();
      if (socket && socket.connected && first) emitJoin(socket, streamId);
      return () => {
        const current = joined.get(streamId);
        if (!current) return;
        current.delete(onSnapshot);
        if (current.size === 0) {
          joined.delete(streamId);
          const active = getSocket();
          if (active?.connected) active.emit('stream:leave', { streamId });
        }
      };
    },
    onEvent(listener) {
      eventListeners.add(listener);
      ensureBound();
      return () => {
        eventListeners.delete(listener);
      };
    },
  };
}
