import { create } from 'zustand';
import type { ErrorCode, PublicUser } from '@casino/shared';
import type { Locale } from '@casino/shared/i18n';

export type SessionStatus = 'idle' | 'authenticating' | 'ready' | 'error';

/** Failures that do not come from the server API. */
export type ShellError = ErrorCode | 'not_in_discord' | 'no_guild';

export interface SessionState {
  status: SessionStatus;
  error: ShellError | null;
  user: PublicUser | null;
  guildId: string | null;
  instanceId: string | null;
  sessionToken: string | null;
  /** Epoch ms. */
  expiresAt: number | null;
  /** Locale resolved by the server (user setting, client locale, guild locale). */
  serverLocale: Locale | null;
  /** Raw Discord client locale from the SDK, e.g. `ja` or `en-US`. */
  sdkLocale: string | null;
  participants: PublicUser[];
  begin: () => void;
  authenticated: (input: {
    user: PublicUser;
    guildId: string;
    instanceId: string;
    sessionToken: string;
    expiresAt: number;
    serverLocale: Locale;
  }) => void;
  fail: (error: ShellError) => void;
  setSdkLocale: (locale: string | null) => void;
  setParticipants: (users: PublicUser[]) => void;
  reset: () => void;
}

const initial = {
  status: 'idle',
  error: null,
  user: null,
  guildId: null,
  instanceId: null,
  sessionToken: null,
  expiresAt: null,
  serverLocale: null,
  sdkLocale: null,
  participants: [],
} as const satisfies Partial<SessionState>;

export const useSessionStore = create<SessionState>()((set) => ({
  ...initial,
  participants: [],
  begin: () => set({ status: 'authenticating', error: null }),
  authenticated: (input) => set({ ...input, status: 'ready', error: null }),
  fail: (error) => set({ status: 'error', error, sessionToken: null }),
  setSdkLocale: (sdkLocale) => set({ sdkLocale }),
  setParticipants: (participants) => set({ participants }),
  reset: () => set({ ...initial, participants: [] }),
}));
