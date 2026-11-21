import type {
  InboxItem,
  MeResponse,
  ScreenId,
  TokenRequest,
  TokenResponse,
  UserSettings,
} from '@casino/shared';
import type { Api } from './api.ts';
import { defaultSettings, parseSettings } from './stores/settings.ts';

export interface MockApiOptions {
  /** Screen returned as the launch intent on the token call. */
  launchScreen?: ScreenId | null;
  locale?: 'en' | 'ja';
  balance?: number;
  now?: () => number;
}

const MOCK_USER_ID = '200000000000000001';
const MOCK_USER = {
  id: MOCK_USER_ID,
  username: 'mock_player',
  globalName: 'Mock Player',
  avatar: null,
};

/** In-memory stand-in for the server. Used by `VITE_MOCK_DISCORD=1` and by tests. */
export function createMockApi(options: MockApiOptions = {}): Api {
  const now = options.now ?? (() => Date.now());
  const locale = options.locale ?? 'en';
  let settings: UserSettings = defaultSettings();
  let guildId = '100000000000000001';
  let instanceId = 'mock-instance';
  const inbox: InboxItem[] = [];
  const unread = () => inbox.filter((i) => i.readAt === null).length;
  return {
    token: (request: TokenRequest): Promise<TokenResponse> => {
      const issued = now();
      guildId = request.guildId;
      instanceId = request.instanceId;
      return Promise.resolve({
        accessToken: 'mock-access-token',
        sessionToken: 'mock-session-token',
        expiresAt: issued + 60 * 60 * 1000,
        user: MOCK_USER,
        guildId: request.guildId,
        locale,
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
    getMe: (): Promise<MeResponse> =>
      Promise.resolve({
        user: MOCK_USER,
        guild: { id: guildId, name: 'Mock guild' },
        instanceId,
        balance: options.balance ?? 12_400,
        locale,
        localeHints: { setting: settings.language, guild: locale },
        expiresAt: now() + 60 * 60 * 1000,
      }),
    getSettings: () => Promise.resolve(structuredClone(settings)),
    saveSettings: (next) => {
      settings = parseSettings(next);
      return Promise.resolve(structuredClone(settings));
    },
    getInbox: () =>
      Promise.resolve({ items: structuredClone(inbox), unread: unread(), nextBefore: null }),
    markInboxRead: (request) => {
      const at = now();
      for (const item of inbox) {
        if (item.readAt === null && ('all' in request || request.ids.includes(item.id))) {
          item.readAt = at;
        }
      }
      return Promise.resolve({ unread: unread() });
    },
  };
}
