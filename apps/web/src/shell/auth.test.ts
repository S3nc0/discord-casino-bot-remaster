import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenRequest } from '@casino/shared';
import { ApiError, createHttpApi } from './api.ts';
import { AuthController } from './auth.ts';
import { screenForIntent } from './launch.ts';
import { useSessionStore } from './stores/session.ts';
import { defaultSettings } from './stores/settings.ts';
import { GUILD, INSTANCE, USER_ID, fakeSdk, resetStores, tokenResponse } from './testing/fakes.ts';

beforeEach(resetStores);

function mockFetch(
  handler: (url: string, init: RequestInit) => { status?: number; body: unknown },
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const { status = 200, body } = handler(url, init ?? {});
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('auth flow', () => {
  it('runs ready → authorize → POST /api/token → authenticate and stores the session', async () => {
    const sdk = fakeSdk({ locale: 'ja' });
    const http = mockFetch(() => ({
      body: tokenResponse({ sessionToken: 'sess-abc', locale: 'ja' }),
    }));
    const api = createHttpApi({
      prefix: '/.proxy',
      getSessionToken: () => useSessionStore.getState().sessionToken,
      fetchImpl: http.impl,
    });

    const result = await new AuthController({ sdk, api }).start();

    expect(sdk.calls).toEqual(['ready', 'authorize', 'authenticate:discord-access']);
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]?.url).toBe('/.proxy/api/token');
    expect(http.calls[0]?.init.method).toBe('POST');
    const sent = JSON.parse(String(http.calls[0]?.init.body)) as TokenRequest;
    expect(sent).toEqual({
      code: 'oauth-code',
      guildId: GUILD,
      instanceId: INSTANCE,
      clientLocale: 'ja',
    });
    expect((http.calls[0]?.init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(result.sessionToken).toBe('sess-abc');
    expect(useSessionStore.getState()).toMatchObject({
      status: 'ready',
      sessionToken: 'sess-abc',
      guildId: GUILD,
      instanceId: INSTANCE,
      sdkLocale: 'ja',
      guildLocale: 'ja',
    });
    expect(useSessionStore.getState().user?.id).toBe(USER_ID);
  });

  it('maps a server error code into the session store', async () => {
    const http = mockFetch(() => ({ status: 403, body: { error: 'guild_not_allowed' } }));
    const api = createHttpApi({ prefix: '', getSessionToken: () => null, fetchImpl: http.impl });
    await expect(new AuthController({ sdk: fakeSdk(), api }).start()).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(useSessionStore.getState()).toMatchObject({
      status: 'error',
      error: 'guild_not_allowed',
    });
  });

  it('fails with no_guild when started outside a server, without calling the API', async () => {
    const token = vi.fn();
    const controller = new AuthController({
      sdk: fakeSdk({ guildId: null }),
      api: { token } as never,
    });
    await expect(controller.start()).rejects.toThrow('no_guild');
    expect(token).not.toHaveBeenCalled();
    expect(useSessionStore.getState().error).toBe('no_guild');
  });

  it('renews silently and shares one run between concurrent refreshes', async () => {
    const sdk = fakeSdk();
    let n = 0;
    const http = mockFetch(() => ({ body: tokenResponse({ sessionToken: `sess-${++n}` }) }));
    const api = createHttpApi({ prefix: '', getSessionToken: () => null, fetchImpl: http.impl });
    const auth = new AuthController({ sdk, api });
    await auth.start();
    const [a, b] = await Promise.all([auth.refresh(), auth.refresh()]);
    expect(a).toBe(b);
    expect(http.calls).toHaveLength(2); // start + one shared refresh
    expect(sdk.calls.filter((c) => c === 'ready')).toHaveLength(1);
    expect(useSessionStore.getState().sessionToken).toBe('sess-2');
  });

  it('sends the session token as a bearer and reads the balance from /api/me', async () => {
    const http = mockFetch(() => ({
      body: { balance: 5, localeHints: { setting: 'auto', guild: 'ja' } },
    }));
    const api = createHttpApi({
      prefix: '',
      getSessionToken: () => 'sess-x',
      fetchImpl: http.impl,
    });
    expect((await api.getMe()).balance).toBe(5);
    expect(http.calls[0]?.url).toBe('/api/me');
    expect((http.calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sess-x',
    );
  });

  it('saves the whole settings document with PUT /api/settings', async () => {
    const doc = defaultSettings();
    const http = mockFetch((_url, init) => ({ body: JSON.parse(String(init.body)) }));
    const api = createHttpApi({
      prefix: '/.proxy',
      getSessionToken: () => 't',
      fetchImpl: http.impl,
    });
    const stored = await api.saveSettings({ ...doc, motion: 'reduced' });
    expect(http.calls[0]?.url).toBe('/.proxy/api/settings');
    expect(http.calls[0]?.init.method).toBe('PUT');
    expect(JSON.parse(String(http.calls[0]?.init.body))).toEqual({ ...doc, motion: 'reduced' });
    expect(stored.motion).toBe('reduced');
  });

  it('asks the inbox for a page and marks everything read with { all: true }', async () => {
    const http = mockFetch((url) =>
      url.startsWith('/api/inbox/read')
        ? { body: { unread: 0 } }
        : { body: { items: [], unread: 3, nextBefore: null } },
    );
    const api = createHttpApi({ prefix: '', getSessionToken: () => 't', fetchImpl: http.impl });
    expect((await api.getInbox({ before: 40, unreadOnly: true })).unread).toBe(3);
    expect(http.calls[0]?.url).toBe('/api/inbox?before=40&limit=50&unread=1');
    expect((await api.markInboxRead({ all: true })).unread).toBe(0);
    expect(http.calls[1]?.url).toBe('/api/inbox/read');
    expect(JSON.parse(String(http.calls[1]?.init.body))).toEqual({ all: true });
  });
});

describe('launch intent routing', () => {
  const session = { userId: USER_ID, guildId: GUILD };
  const intent = (screen: string, patch: object = {}) => ({
    userId: USER_ID,
    guildId: GUILD,
    screen: screen as never,
    expires: 1,
    ...patch,
  });

  it('routes straight to the intent screen', () => {
    expect(screenForIntent(intent('blackjack'), session)).toBe('blackjack');
    expect(screenForIntent(intent('inbox'), session)).toBe('inbox');
  });

  it('falls back to home without an intent, for someone else, another guild or an unknown screen', () => {
    expect(screenForIntent(null, session)).toBe('home');
    expect(screenForIntent(undefined, session)).toBe('home');
    expect(screenForIntent(intent('slots', { userId: '300000000000000009' }), session)).toBe(
      'home',
    );
    expect(screenForIntent(intent('slots', { guildId: '300000000000000009' }), session)).toBe(
      'home',
    );
    expect(screenForIntent(intent('casino-of-the-future'), session)).toBe('home');
  });
});
