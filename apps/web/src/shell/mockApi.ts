import type { InboxItem, TokenRequest, TokenResponse } from '@casino/shared';
import type { Api } from './api.ts';
import { DEFAULT_SETTINGS, parseSettings, type Settings } from './stores/settings.ts';
import type { ScreenId } from '@casino/shared';

export interface MockApiOptions {
  /** Screen returned as the launch intent on the token call. */
  launchScreen?: ScreenId | null;
  locale?: 'en' | 'ja';
  balance?: number;
  now?: () => number;
}

const MOCK_USER_ID = '200000000000000001';

/** In-memory stand-in for the server. Used by `VITE_MOCK_DISCORD=1` and by tests. */
export function createMockApi(options: MockApiOptions = {}): Api {
  const now = options.now ?? (() => Date.now());
  let settings: Settings = structuredClone(DEFAULT_SETTINGS);
  const inbox: InboxItem[] = [];
  return {
    token: (request: TokenRequest): Promise<TokenResponse> => {
      const issued = now();
      return Promise.resolve({
        accessToken: 'mock-access-token',
        sessionToken: 'mock-session-token',
        expiresAt: issued + 60 * 60 * 1000,
        user: {
          id: MOCK_USER_ID,
          username: 'mock_player',
          globalName: 'Mock Player',
          avatar: null,
        },
        guildId: request.guildId,
        locale: options.locale ?? 'en',
        launchIntent: options.launchScreen
          ? {
              userId: MOCK_USER_ID,
              guildId: request.guildId,
              screen: options.launchScreen,
              expires: issued + 2 * 60 * 1000,
            }
          : null,
      });
    },
    getSettings: () => Promise.resolve(structuredClone(settings)),
    saveSettings: (next) => {
      settings = parseSettings(next);
      return Promise.resolve(structuredClone(settings));
    },
    getInbox: () => Promise.resolve([...inbox]),
    getBalance: () => Promise.resolve(options.balance ?? 12_400),
  };
}
