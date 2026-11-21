import type { TokenResponse } from '@casino/shared';
import { ApiError, type Api } from './api.ts';
import type { ActivitySdk } from './sdk.ts';
import type { ShellError } from './stores/session.ts';
import { useSessionStore } from './stores/session.ts';

export interface AuthDeps {
  sdk: ActivitySdk;
  api: Api;
}

export function toShellError(error: unknown): ShellError {
  return error instanceof ApiError ? error.code : 'internal';
}

/**
 * Activity auth flow (docs/ARCHITECTURE.md): ready → authorize → POST /api/token →
 * authenticate with the Discord token → session token into the store.
 * `silent` skips `ready()` and the loading state; used to renew an expiring session.
 */
export class AuthController {
  private inflight: Promise<TokenResponse> | null = null;
  private readyDone = false;

  private readonly deps: AuthDeps;

  constructor(deps: AuthDeps) {
    this.deps = deps;
  }

  /** First sign-in. Resolves with the token response or throws after recording the error. */
  async start(): Promise<TokenResponse> {
    const store = useSessionStore.getState();
    store.begin();
    const { sdk } = this.deps;
    if (!sdk.guildId) {
      store.fail('no_guild');
      throw new Error('no_guild');
    }
    try {
      await this.ensureReady();
      useSessionStore.getState().setSdkLocale(await sdk.getLocale());
      return await this.exchange();
    } catch (error) {
      useSessionStore.getState().fail(toShellError(error));
      throw error;
    }
  }

  /** Renew the session token without UI. Concurrent calls share one run. */
  refresh(): Promise<TokenResponse> {
    this.inflight ??= this.exchange()
      .catch((error: unknown) => {
        useSessionStore.getState().fail(toShellError(error));
        throw error;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async ensureReady(): Promise<void> {
    if (this.readyDone) return;
    await this.deps.sdk.ready();
    this.readyDone = true;
  }

  private async exchange(): Promise<TokenResponse> {
    const { sdk, api } = this.deps;
    const guildId = sdk.guildId;
    if (!guildId) throw new ApiError('forbidden', 0);
    const code = await sdk.authorize();
    const clientLocale = useSessionStore.getState().sdkLocale ?? undefined;
    const response = await api.token({
      code,
      guildId,
      instanceId: sdk.instanceId,
      ...(clientLocale ? { clientLocale } : {}),
    });
    await sdk.authenticate(response.accessToken);
    useSessionStore.getState().authenticated({
      user: response.user,
      guildId: response.guildId,
      instanceId: sdk.instanceId,
      sessionToken: response.sessionToken,
      expiresAt: response.expiresAt,
      guildLocale: response.locale,
    });
    return response;
  }
}
