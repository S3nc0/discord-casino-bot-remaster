import { DiscordSDK, DiscordSDKMock, Events, patchUrlMappings } from '@discord/embedded-app-sdk';
import type { PublicUser } from '@casino/shared';
import type { ShellConfig } from './config.ts';

export interface PresenceActivity {
  details: string;
  /** Epoch ms of the session start, for the elapsed timer. */
  startedAt: number;
}

/** The slice of the Embedded App SDK the shell uses. Tests inject a fake. */
export interface ActivitySdk {
  readonly mode: 'discord' | 'mock';
  readonly instanceId: string;
  /** null when the Activity was not started from a server. */
  readonly guildId: string | null;
  ready(): Promise<void>;
  /** OAuth2 code for `POST /api/token` (scopes identify, guilds; prompt none). */
  authorize(): Promise<string>;
  authenticate(accessToken: string): Promise<void>;
  /** Discord client locale, e.g. `ja` or `en-US`; null if unavailable. */
  getLocale(): Promise<string | null>;
  getParticipants(): Promise<PublicUser[]>;
  /** Returns an unsubscribe function. */
  onParticipantsUpdate(listener: (users: PublicUser[]) => void): Promise<() => void>;
  setActivity(activity: PresenceActivity): Promise<void>;
}

interface Participant {
  id: string;
  username: string;
  global_name?: string | null | undefined;
  avatar?: string | null | undefined;
}

const toPublic = (p: Participant): PublicUser => ({
  id: p.id,
  username: p.username,
  globalName: p.global_name ?? null,
  avatar: p.avatar ?? null,
});

const ACTIVITY_TYPE_PLAYING = 0;

function wrap(sdk: DiscordSDK | DiscordSDKMock, mode: 'discord' | 'mock'): ActivitySdk {
  return {
    mode,
    instanceId: sdk.instanceId,
    guildId: sdk.guildId,
    ready: () => sdk.ready(),
    authorize: async () => {
      const { code } = await sdk.commands.authorize({
        client_id: sdk.clientId,
        response_type: 'code',
        state: '',
        prompt: 'none',
        scope: ['identify', 'guilds'],
      });
      return code;
    },
    authenticate: async (access_token) => {
      await sdk.commands.authenticate({ access_token });
    },
    getLocale: async () => {
      try {
        const { locale } = await sdk.commands.userSettingsGetLocale();
        return locale || null;
      } catch {
        return null;
      }
    },
    getParticipants: async () => {
      const { participants } = await sdk.commands.getInstanceConnectedParticipants();
      return participants.map(toPublic);
    },
    onParticipantsUpdate: async (listener) => {
      const handler = (event: { participants: Participant[] }) =>
        listener(event.participants.map(toPublic));
      await sdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, handler);
      return () => {
        void sdk.unsubscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, handler);
      };
    },
    setActivity: async ({ details, startedAt }) => {
      await sdk.commands.setActivity({
        activity: { type: ACTIVITY_TYPE_PLAYING, details, timestamps: { start: startedAt } },
      });
    },
  };
}

const MOCK_GUILD_ID = '100000000000000001';

export function createActivitySdk(config: ShellConfig): ActivitySdk {
  if (config.mode === 'discord') {
    const sdk = new DiscordSDK(config.clientId);
    // Libraries that build absolute URLs to the API host (socket.io-client among them) are
    // remapped onto the `/api` mapping. Our own calls already go through the proxy prefix.
    if (config.apiHost) {
      patchUrlMappings([{ prefix: '/api', target: `${config.apiHost}/api` }]);
    }
    return wrap(sdk, 'discord');
  }
  if (config.mode === 'mock') {
    const mock = new DiscordSDKMock(config.clientId || 'mock-client', MOCK_GUILD_ID, null, null);
    mock._updateCommandMocks({
      authorize: () => Promise.resolve({ code: 'mock-code' }),
      userSettingsGetLocale: () => Promise.resolve({ locale: config.mockLocale ?? 'en-US' }),
    });
    return wrap(mock, 'mock');
  }
  throw new Error('not_in_discord');
}
