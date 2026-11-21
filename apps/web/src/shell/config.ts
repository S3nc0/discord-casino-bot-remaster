import { DISCORD_CDN_ORIGIN, DISCORD_CDN_PREFIX, isScreenId, type ScreenId } from '@casino/shared';

export interface ShellEnv {
  VITE_DISCORD_CLIENT_ID?: string | undefined;
  VITE_MOCK_DISCORD?: string | undefined;
  VITE_API_HOST?: string | undefined;
}

export interface ShellConfig {
  /** `discord`: inside the Activity frame. `mock`: DiscordSDKMock and an in-memory API. `none`: neither. */
  mode: 'discord' | 'mock' | 'none';
  clientId: string;
  /** `/.proxy` inside Discord (every request goes through the mapped proxy), empty in dev. */
  proxyPrefix: string;
  /** Where avatar paths are served from: the mapped CDN path in Discord, the CDN itself in dev. */
  cdnBase: string;
  apiHost: string | null;
  /** Mock mode only: `?screen=blackjack` fakes a launch intent, `?locale=ja` the client locale. */
  mockScreen: ScreenId | null;
  mockLocale: string | null;
}

export function readConfig(search: string, env: ShellEnv): ShellConfig {
  const params = new URLSearchParams(search);
  const inFrame = params.has('frame_id') && params.has('instance_id');
  const mockFlag = env.VITE_MOCK_DISCORD === '1';
  const mode = inFrame ? 'discord' : mockFlag ? 'mock' : 'none';
  const proxyPrefix = mode === 'discord' ? '/.proxy' : '';
  const screen = params.get('screen');
  return {
    mode,
    clientId: env.VITE_DISCORD_CLIENT_ID ?? '',
    proxyPrefix,
    cdnBase: mode === 'discord' ? `${proxyPrefix}${DISCORD_CDN_PREFIX}` : DISCORD_CDN_ORIGIN,
    apiHost: env.VITE_API_HOST ? env.VITE_API_HOST : null,
    mockScreen: mode === 'mock' && screen && isScreenId(screen) ? screen : null,
    mockLocale: mode === 'mock' ? params.get('locale') : null,
  };
}
