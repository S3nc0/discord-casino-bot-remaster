import { createContext, useContext } from 'react';
import { createHttpApi, type Api } from './api.ts';
import { AuthController } from './auth.ts';
import { readConfig, type ShellConfig } from './config.ts';
import { screenForIntent } from './launch.ts';
import { createMockApi } from './mockApi.ts';
import { PresenceController } from './presence.ts';
import { createActivitySdk, type ActivitySdk } from './sdk.ts';
import { SettingsSync } from './settingsSync.ts';
import { SocketController, type SocketFactory } from './socket.ts';
import { useBalanceStore, useInboxStore, useNavStore, useSessionStore } from './stores/index.ts';

export interface RuntimeDeps {
  config: ShellConfig;
  sdk: ActivitySdk;
  api: Api;
  origin: string;
  socketFactory?: SocketFactory;
}

/** Everything the shell wires together. Built once in `main.tsx`; tests build it from fakes. */
export class ShellRuntime {
  readonly config: ShellConfig;
  readonly sdk: ActivitySdk;
  readonly api: Api;
  readonly auth: AuthController;
  readonly socket: SocketController;
  readonly presence: PresenceController;
  readonly settings: SettingsSync;
  private booting: Promise<void> | null = null;

  constructor(deps: RuntimeDeps) {
    this.config = deps.config;
    this.sdk = deps.sdk;
    this.api = deps.api;
    this.auth = new AuthController({ sdk: deps.sdk, api: deps.api });
    this.socket = new SocketController({
      origin: deps.origin,
      proxyPrefix: deps.config.proxyPrefix,
      auth: this.auth,
      ...(deps.socketFactory ? { factory: deps.socketFactory } : {}),
    });
    this.presence = new PresenceController({
      sdk: deps.sdk,
      onScreen: (screen) => this.socket.emitScreen(screen),
    });
    this.settings = new SettingsSync({ api: deps.api });
  }

  /** Authenticate, route the launch intent, connect and load. Safe to call twice. */
  boot(): Promise<void> {
    this.booting ??= this.run();
    return this.booting;
  }

  /** Try again after a failed boot. */
  retry(): Promise<void> {
    this.booting = null;
    return this.boot();
  }

  private async run(): Promise<void> {
    let response;
    try {
      response = await this.auth.start();
    } catch {
      return; // the session store holds the error
    }
    useNavStore.getState().go(
      screenForIntent(response.launchIntent, {
        userId: response.user.id,
        guildId: response.guildId,
      }),
    );

    this.socket.connect();
    // Settings and balance first, so the first presence line already has the right language
    // and amount.
    await Promise.allSettled([
      this.settings.load(),
      this.api.getMe().then((me) => {
        useSessionStore.getState().setGuildLocale(me.localeHints.guild);
        if (useBalanceStore.getState().ledgerId === 0) useBalanceStore.getState().set(me.balance);
      }),
    ]);
    this.settings.start();
    this.presence.start();

    await Promise.allSettled([
      this.api.getInbox().then((page) => useInboxStore.getState().set(page.items, page.unread)),
      this.sdk.getParticipants().then((users) => useSessionStore.getState().setParticipants(users)),
      this.sdk.onParticipantsUpdate((users) => useSessionStore.getState().setParticipants(users)),
    ]);
  }
}

export function createRuntime(search: string, origin: string, env: ImportMetaEnv): ShellRuntime {
  const config = readConfig(search, env);
  const sdk = createActivitySdk(config);
  const api =
    config.mode === 'mock'
      ? createMockApi({ launchScreen: config.mockScreen })
      : createHttpApi({
          prefix: config.proxyPrefix,
          getSessionToken: () => useSessionStore.getState().sessionToken,
        });
  return new ShellRuntime({ config, sdk, api, origin });
}

export const RuntimeContext = createContext<ShellRuntime | null>(null);

export function useRuntime(): ShellRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('ShellRuntime missing');
  return runtime;
}
