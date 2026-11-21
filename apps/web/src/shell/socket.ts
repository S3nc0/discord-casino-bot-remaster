import { io, type Socket } from 'socket.io-client';
import {
  SOCKET_PATH,
  type ClientToServerEvents,
  type ScreenId,
  type ServerToClientEvents,
} from '@casino/shared';
import type { AuthController } from './auth.ts';
import { useBalanceStore } from './stores/balance.ts';
import { useConnectionStore } from './stores/connection.ts';
import { useInboxStore } from './stores/inbox.ts';
import { useSessionStore } from './stores/session.ts';
import { useToastStore } from './stores/toasts.ts';

export type CasinoSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type SocketFactory = (
  url: string,
  options: {
    path: string;
    transports: ['websocket'];
    auth: (cb: (data: { token: string }) => void) => void;
    reconnection: true;
    reconnectionDelay: number;
    reconnectionDelayMax: number;
    randomizationFactor: number;
  },
) => CasinoSocket;

export const RECONNECT_DELAY_MS = 1_000;
export const RECONNECT_DELAY_MAX_MS = 15_000;
/** Renew this long before the session token expires. */
export const REFRESH_MARGIN_MS = 60_000;

export interface SocketControllerOptions {
  origin: string;
  /** Path prefix in front of the socket path, `/.proxy` inside Discord. */
  proxyPrefix: string;
  auth: Pick<AuthController, 'refresh'>;
  factory?: SocketFactory;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Socket.io link: websocket only, session token in the handshake (read again on every
 * reconnect), exponential backoff with jitter, and silent re-auth when the session expires.
 * The server puts the socket in `guild:`, `instance:` and `user:` rooms itself on connect.
 */
export class SocketController {
  private socket: CasinoSocket | null = null;
  private refreshTimer: unknown = null;
  private stopped = false;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private readonly options: SocketControllerOptions;

  constructor(options: SocketControllerOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get raw(): CasinoSocket | null {
    return this.socket;
  }

  connect(): void {
    if (this.socket) return;
    this.stopped = false;
    const connection = useConnectionStore.getState();
    connection.setStatus('connecting');
    const factory: SocketFactory =
      this.options.factory ?? ((url, opts) => io(url, opts) as CasinoSocket);
    const socket = factory(this.options.origin, {
      path: `${this.options.proxyPrefix}${SOCKET_PATH}`,
      transports: ['websocket'],
      auth: (cb) => cb({ token: useSessionStore.getState().sessionToken ?? '' }),
      reconnection: true,
      reconnectionDelay: RECONNECT_DELAY_MS,
      reconnectionDelayMax: RECONNECT_DELAY_MAX_MS,
      randomizationFactor: 0.5,
    });
    this.socket = socket;
    this.bind(socket);
    this.scheduleRefresh();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.refreshTimer !== null) this.clearTimer(this.refreshTimer);
    this.refreshTimer = null;
    this.socket?.disconnect();
    this.socket = null;
    useConnectionStore.getState().setStatus('offline');
  }

  /** Tell the server which screen we are on (presence for other clients). */
  emitScreen(screen: ScreenId): void {
    if (this.socket?.connected) this.socket.emit('presence:screen', { screen });
  }

  /** Renew the session and reconnect with the new token. */
  async reauthenticate(): Promise<void> {
    const socket = this.socket;
    try {
      await this.options.auth.refresh();
    } catch {
      // `refresh` recorded the error in the session store; stay offline.
      useConnectionStore.getState().setStatus('offline');
      return;
    }
    this.scheduleRefresh();
    if (this.stopped || !socket) return;
    socket.disconnect();
    socket.connect();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) this.clearTimer(this.refreshTimer);
    this.refreshTimer = null;
    const expiresAt = useSessionStore.getState().expiresAt;
    if (expiresAt === null || this.stopped) return;
    const wait = Math.max(0, expiresAt - REFRESH_MARGIN_MS - this.now());
    // setTimeout cannot hold more than 2^31 ms.
    this.refreshTimer = this.setTimer(
      () => void this.reauthenticate(),
      Math.min(wait, 2 ** 31 - 1),
    );
  }

  private bind(socket: CasinoSocket): void {
    const connection = useConnectionStore.getState;
    socket.on('connect', () => connection().setStatus('online'));
    socket.on('disconnect', (reason) => {
      if (this.stopped) return;
      connection().setStatus('reconnecting');
      // The server hung up (expiry): socket.io does not retry those by itself.
      if (reason === 'io server disconnect') void this.reauthenticate();
    });
    socket.on('connect_error', () => {
      // A refused handshake (bad or expired token) is not retried by socket.io.
      if (!socket.active && !this.stopped) void this.reauthenticate();
    });
    socket.io.on('reconnect_attempt', (attempt: number) => connection().attempted(attempt));

    socket.on('session:error', ({ error }) => {
      if (error === 'expired' || error === 'unauthorized') void this.reauthenticate();
    });
    socket.on('balance:update', (update) => {
      const { user, guildId } = useSessionStore.getState();
      if (update.guildId !== guildId || update.userId !== user?.id) return;
      useBalanceStore.getState().apply(update);
    });
    socket.on('inbox:new', (item) => {
      if (item.guildId !== useSessionStore.getState().guildId) return;
      useInboxStore.getState().add(item);
      useToastStore.getState().push({ tone: 'info', messageKey: `inbox.kind.${item.kind}` });
    });
    socket.on('inbox:unread', ({ guildId, unread }) => {
      if (guildId === useSessionStore.getState().guildId)
        useInboxStore.getState().setUnread(unread);
    });
    socket.on('toast', (toast) => {
      if (toast.guildId !== useSessionStore.getState().guildId) return;
      useToastStore
        .getState()
        .push({ tone: toast.tone, messageKey: toast.messageKey, params: toast.params });
    });
    socket.on('instance:participants', (p) => {
      const session = useSessionStore.getState();
      if (p.guildId === session.guildId && p.instanceId === session.instanceId) {
        session.setParticipants(p.users);
      }
    });
  }
}
