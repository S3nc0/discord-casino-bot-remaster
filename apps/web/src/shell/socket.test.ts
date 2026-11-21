import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxItem } from '@casino/shared';
import { REFRESH_MARGIN_MS, SocketController, type SocketFactory } from './socket.ts';
import { useBalanceStore } from './stores/balance.ts';
import { useConnectionStore } from './stores/connection.ts';
import { useInboxStore } from './stores/inbox.ts';
import { useSessionStore } from './stores/session.ts';
import { useToastStore } from './stores/toasts.ts';
import { FakeSocket, GUILD, INSTANCE, USER_ID, flush, resetStores } from './testing/fakes.ts';

beforeEach(() => {
  resetStores();
  useSessionStore.getState().authenticated({
    user: { id: USER_ID, username: 'u', globalName: null, avatar: null },
    guildId: GUILD,
    instanceId: INSTANCE,
    sessionToken: 'sess-1',
    expiresAt: 1_000_000,
    guildLocale: 'en',
  });
});

function setup() {
  const socket = new FakeSocket();
  let captured: Parameters<SocketFactory>[1] | undefined;
  let url = '';
  const factory: SocketFactory = (u, options) => {
    url = u;
    captured = options;
    return socket.asSocket();
  };
  const timers: { fn: () => void; ms: number }[] = [];
  const auth = {
    refresh: vi.fn(() => {
      useSessionStore.setState({ sessionToken: 'sess-2', expiresAt: 5_000_000 });
      return Promise.resolve({} as never);
    }),
  };
  const controller = new SocketController({
    origin: 'https://app.example',
    proxyPrefix: '/.proxy',
    auth,
    factory,
    now: () => 0,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  return { socket, controller, auth, timers, options: () => captured!, url: () => url };
}

describe('socket controller', () => {
  it('connects websocket-only on the proxied path with the token read at handshake time', () => {
    const s = setup();
    s.controller.connect();
    expect(s.url()).toBe('https://app.example');
    expect(s.options()).toMatchObject({
      path: '/.proxy/api/socket.io',
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 15000,
    });
    const tokens: string[] = [];
    s.options().auth((d) => tokens.push(d.token));
    useSessionStore.setState({ sessionToken: 'sess-9' });
    s.options().auth((d) => tokens.push(d.token));
    expect(tokens).toEqual(['sess-1', 'sess-9']);
    expect(useConnectionStore.getState().status).toBe('connecting');
  });

  it('tracks connection state and reconnect attempts', () => {
    const s = setup();
    s.controller.connect();
    s.socket.trigger('connect');
    expect(useConnectionStore.getState().status).toBe('online');
    s.socket.trigger('disconnect', 'transport close');
    expect(useConnectionStore.getState().status).toBe('reconnecting');
    s.socket.triggerManager('reconnect_attempt', 2);
    expect(useConnectionStore.getState()).toMatchObject({ status: 'reconnecting', attempt: 2 });
    expect(s.auth.refresh).not.toHaveBeenCalled(); // socket.io retries by itself
  });

  it('re-authenticates and reconnects when the server reports an expired session', async () => {
    const s = setup();
    s.controller.connect();
    s.socket.trigger('session:error', { error: 'expired' });
    await flush();
    expect(s.auth.refresh).toHaveBeenCalledTimes(1);
    expect(s.socket.disconnectCalls).toBe(1);
    expect(s.socket.connectCalls).toBe(1);
  });

  it('re-authenticates after a server-side disconnect and after a refused handshake', async () => {
    const s = setup();
    s.controller.connect();
    s.socket.trigger('disconnect', 'io server disconnect');
    await flush();
    expect(s.auth.refresh).toHaveBeenCalledTimes(1);
    s.socket.active = false;
    s.socket.trigger('connect_error', new Error('unauthorized'));
    await flush();
    expect(s.auth.refresh).toHaveBeenCalledTimes(2);
  });

  it('renews ahead of expiry', async () => {
    const s = setup();
    s.controller.connect();
    expect(s.timers).toHaveLength(1);
    expect(s.timers[0]?.ms).toBe(1_000_000 - REFRESH_MARGIN_MS);
    s.timers[0]?.fn();
    await flush();
    expect(s.auth.refresh).toHaveBeenCalled();
    expect(s.timers.at(-1)?.ms).toBe(5_000_000 - REFRESH_MARGIN_MS);
  });

  it('stays offline when renewal fails', async () => {
    const s = setup();
    s.auth.refresh.mockRejectedValueOnce(new Error('nope'));
    s.controller.connect();
    s.socket.trigger('session:error', { error: 'expired' });
    await flush();
    expect(useConnectionStore.getState().status).toBe('offline');
    expect(s.socket.connectCalls).toBe(0);
  });

  it('feeds balance, inbox and toast events into the stores, ignoring other guilds and users', () => {
    const s = setup();
    s.controller.connect();
    s.socket.trigger('balance:update', {
      guildId: GUILD,
      userId: USER_ID,
      balance: 700,
      delta: 200,
      reason: 'game_payout',
      ledgerId: 3,
    });
    s.socket.trigger('balance:update', {
      guildId: GUILD,
      userId: '999999999999999999',
      balance: 1,
      delta: 1,
      reason: 'game_payout',
      ledgerId: 4,
    });
    s.socket.trigger('balance:update', {
      guildId: '300000000000000000',
      userId: USER_ID,
      balance: 2,
      delta: 1,
      reason: 'game_payout',
      ledgerId: 5,
    });
    expect(useBalanceStore.getState().balance).toBe(700);

    const item = {
      id: 1,
      guildId: GUILD,
      kind: 'loan_due',
      event: {},
      createdAt: 1,
      readAt: null,
    } as unknown as InboxItem;
    s.socket.trigger('inbox:new', item);
    s.socket.trigger('inbox:new', { ...item, id: 2, guildId: '300000000000000000' });
    expect(useInboxStore.getState().items.map((i) => i.id)).toEqual([1]);
    expect(useToastStore.getState().toasts.map((t) => t.messageKey)).toEqual([
      'inbox.kind.loan_due',
    ]);

    s.socket.trigger('toast', { guildId: GUILD, tone: 'success', messageKey: 'common.ok' });
    s.socket.trigger('toast', {
      guildId: '300000000000000000',
      tone: 'error',
      messageKey: 'common.ok',
    });
    expect(useToastStore.getState().toasts).toHaveLength(2);

    const user = { id: USER_ID, username: 'u', globalName: null, avatar: null };
    s.socket.trigger('instance:participants', {
      guildId: GUILD,
      instanceId: INSTANCE,
      users: [user],
    });
    s.socket.trigger('instance:participants', { guildId: GUILD, instanceId: 'other', users: [] });
    expect(useSessionStore.getState().participants).toEqual([user]);
  });

  it('follows the server unread count for this guild only', () => {
    const s = setup();
    s.controller.connect();
    s.socket.trigger('inbox:unread', { guildId: GUILD, unread: 4 });
    s.socket.trigger('inbox:unread', { guildId: '300000000000000000', unread: 99 });
    expect(useInboxStore.getState().unread).toBe(4);
  });

  it('emits the screen only while connected', () => {
    const s = setup();
    s.controller.connect();
    s.controller.emitScreen('slots');
    expect(s.socket.emitted).toHaveLength(0);
    s.socket.connected = true;
    s.controller.emitScreen('slots');
    expect(s.socket.emitted[0]).toEqual({ event: 'presence:screen', args: [{ screen: 'slots' }] });
  });
});
