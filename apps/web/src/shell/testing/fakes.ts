import type { PublicUser, TokenResponse } from '@casino/shared';
import type { ActivitySdk, PresenceActivity } from '../sdk.ts';
import type { CasinoSocket } from '../socket.ts';
import { useBalanceStore } from '../stores/balance.ts';
import { useConnectionStore } from '../stores/connection.ts';
import { useInboxStore } from '../stores/inbox.ts';
import { useNavStore } from '../stores/nav.ts';
import { useSessionStore } from '../stores/session.ts';
import { defaultSettings, useSettingsStore } from '../stores/settings.ts';
import { useToastStore } from '../stores/toasts.ts';

export const GUILD = '100000000000000001';
export const USER_ID = '200000000000000001';
export const INSTANCE = 'i-1234';

export function resetStores(): void {
  useSessionStore.getState().reset();
  useBalanceStore.getState().reset();
  useInboxStore.getState().reset();
  useConnectionStore.setState({ status: 'offline', attempt: 0 });
  useNavStore.setState({ screen: 'home' });
  useToastStore.getState().clear();
  useSettingsStore.setState({ ...structuredClone(defaultSettings()), loaded: false, revision: 0 });
}

export function tokenResponse(patch: Partial<TokenResponse> = {}): TokenResponse {
  return {
    accessToken: 'discord-access',
    sessionToken: 'session-1',
    expiresAt: 10_000_000,
    user: { id: USER_ID, username: 'p', globalName: 'Player', avatar: null },
    guildId: GUILD,
    locale: 'en',
    launchIntent: null,
    ...patch,
  };
}

export interface FakeSdk extends ActivitySdk {
  calls: string[];
  activities: PresenceActivity[];
  emitParticipants(users: PublicUser[]): void;
}

export function fakeSdk(opts: { guildId?: string | null; locale?: string | null } = {}): FakeSdk {
  const calls: string[] = [];
  const activities: PresenceActivity[] = [];
  const listeners: ((u: PublicUser[]) => void)[] = [];
  return {
    mode: 'mock',
    instanceId: INSTANCE,
    guildId: opts.guildId === undefined ? GUILD : opts.guildId,
    calls,
    activities,
    ready: () => {
      calls.push('ready');
      return Promise.resolve();
    },
    authorize: () => {
      calls.push('authorize');
      return Promise.resolve('oauth-code');
    },
    authenticate: (token) => {
      calls.push(`authenticate:${token}`);
      return Promise.resolve();
    },
    getLocale: () => Promise.resolve(opts.locale === undefined ? 'ja' : opts.locale),
    getParticipants: () => Promise.resolve([]),
    onParticipantsUpdate: (l) => {
      listeners.push(l);
      return Promise.resolve(() => undefined);
    },
    setActivity: (a) => {
      activities.push(a);
      return Promise.resolve();
    },
    emitParticipants: (users) => listeners.forEach((l) => l(users)),
  };
}

type Handler = (...args: never[]) => void;

/** Just enough of a socket.io client for the controller: events in, emits recorded. */
export class FakeSocket {
  connected = false;
  active = true;
  handlers = new Map<string, Handler[]>();
  managerHandlers = new Map<string, Handler[]>();
  emitted: { event: string; args: unknown[] }[] = [];
  connectCalls = 0;
  disconnectCalls = 0;
  io = {
    on: (event: string, handler: Handler) => {
      this.managerHandlers.set(event, [...(this.managerHandlers.get(event) ?? []), handler]);
    },
  };
  on(event: string, handler: Handler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  off(event: string, handler: Handler): this {
    this.handlers.set(
      event,
      (this.handlers.get(event) ?? []).filter((h) => h !== handler),
    );
    return this;
  }
  emit(event: string, ...args: unknown[]): this {
    this.emitted.push({ event, args });
    return this;
  }
  connect(): this {
    this.connectCalls++;
    return this;
  }
  disconnect(): this {
    this.disconnectCalls++;
    this.connected = false;
    return this;
  }
  trigger(event: string, ...args: unknown[]): void {
    for (const h of this.handlers.get(event) ?? []) (h as (...a: unknown[]) => void)(...args);
  }
  triggerManager(event: string, ...args: unknown[]): void {
    for (const h of this.managerHandlers.get(event) ?? [])
      (h as (...a: unknown[]) => void)(...args);
  }
  asSocket(): CasinoSocket {
    return this as unknown as CasinoSocket;
  }
}

export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
