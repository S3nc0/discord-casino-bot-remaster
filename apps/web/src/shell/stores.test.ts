import { beforeEach, describe, expect, it } from 'vitest';
import type { InboxItem } from '@casino/shared';
import { useBalanceStore } from './stores/balance.ts';
import { useConnectionStore } from './stores/connection.ts';
import { selectUnread, useInboxStore } from './stores/inbox.ts';
import { useNavStore } from './stores/nav.ts';
import { useSessionStore } from './stores/session.ts';
import { defaultSettings, parseSettings, useSettingsStore } from './stores/settings.ts';
import { useToastStore } from './stores/toasts.ts';
import { GUILD, USER_ID, resetStores } from './testing/fakes.ts';

beforeEach(resetStores);

const item = (id: number, readAt: number | null = null, createdAt = id * 1000): InboxItem => ({
  id,
  guildId: GUILD,
  kind: 'daily_ready',
  event: {
    type: 'DailyReady',
    guildId: GUILD,
    at: createdAt,
    userId: USER_ID,
  } as InboxItem['event'],
  createdAt,
  readAt,
});

describe('session store', () => {
  it('goes idle → authenticating → ready, and records failures', () => {
    const s = useSessionStore.getState();
    expect(s.status).toBe('idle');
    s.begin();
    expect(useSessionStore.getState().status).toBe('authenticating');
    s.authenticated({
      user: { id: USER_ID, username: 'u', globalName: null, avatar: null },
      guildId: GUILD,
      instanceId: 'i',
      sessionToken: 'tok',
      expiresAt: 5,
      guildLocale: 'ja',
    });
    expect(useSessionStore.getState()).toMatchObject({ status: 'ready', sessionToken: 'tok' });
    s.fail('unauthorized');
    expect(useSessionStore.getState()).toMatchObject({
      status: 'error',
      error: 'unauthorized',
      sessionToken: null,
    });
  });
});

describe('balance store', () => {
  it('applies updates in ledger order and ignores stale ones', () => {
    const b = useBalanceStore.getState();
    b.set(1000);
    b.apply({ balance: 1500, delta: 500, ledgerId: 7 });
    b.apply({ balance: 900, delta: -100, ledgerId: 6 });
    expect(useBalanceStore.getState()).toMatchObject({
      balance: 1500,
      lastDelta: 500,
      ledgerId: 7,
    });
  });
});

describe('settings store', () => {
  it('merges nested sound edits and bumps the revision', () => {
    useSettingsStore.getState().update({ sound: { sfxVolume: 20 } });
    const s = useSettingsStore.getState();
    expect(s.sound).toEqual({
      enabled: true,
      sfxVolume: 20,
      musicVolume: defaultSettings().sound.musicVolume,
    });
    expect(s.revision).toBe(1);
  });

  it('starts from the shared defaults: language auto, theme discord, motion system', () => {
    expect(useSettingsStore.getState()).toMatchObject({
      language: 'auto',
      theme: 'discord',
      motion: 'system',
    });
  });

  it('hydrate does not count as an edit and clamps bad server data', () => {
    useSettingsStore
      .getState()
      .hydrate(
        parseSettings({ language: 'ja', sound: { sfxVolume: 900 }, theme: 'sepia', motion: 'x' }),
      );
    const s = useSettingsStore.getState();
    expect(s).toMatchObject({
      language: 'ja',
      theme: 'discord',
      motion: 'system',
      loaded: true,
      revision: 0,
    });
    expect(s.sound.sfxVolume).toBe(100);
  });

  it('keeps the motion tri-state', () => {
    for (const motion of ['full', 'reduced', 'system'] as const) {
      useSettingsStore.getState().update({ motion });
      expect(useSettingsStore.getState().snapshot().motion).toBe(motion);
    }
  });
});

describe('inbox store', () => {
  it('keeps newest first, de-duplicates, tracks the server unread count and marks read', () => {
    const inbox = useInboxStore.getState();
    inbox.set([item(1), item(2, 5000)], 7);
    expect(selectUnread(useInboxStore.getState())).toBe(7);
    inbox.add(item(3));
    inbox.add(item(3));
    expect(useInboxStore.getState().items.map((i) => i.id)).toEqual([3, 2, 1]);
    expect(selectUnread(useInboxStore.getState())).toBe(8);
    inbox.setUnread(2);
    inbox.markRead([1, 3, 2], 9000);
    expect(selectUnread(useInboxStore.getState())).toBe(0);
    expect(useInboxStore.getState().items.find((i) => i.id === 2)?.readAt).toBe(5000);
  });

  it('marks everything read', () => {
    const inbox = useInboxStore.getState();
    inbox.set([item(1), item(2)], 12);
    inbox.markAllRead(10);
    expect(useInboxStore.getState().unread).toBe(0);
    expect(useInboxStore.getState().items.every((i) => i.readAt === 10)).toBe(true);
  });
});

describe('connection, nav and toast stores', () => {
  it('resets the attempt counter once online', () => {
    const c = useConnectionStore.getState();
    c.attempted(3);
    expect(useConnectionStore.getState()).toMatchObject({ status: 'reconnecting', attempt: 3 });
    c.setStatus('online');
    expect(useConnectionStore.getState()).toMatchObject({ status: 'online', attempt: 0 });
  });

  it('navigates', () => {
    useNavStore.getState().go('slots');
    expect(useNavStore.getState().screen).toBe('slots');
  });

  it('caps visible toasts and dismisses by id', () => {
    const t = useToastStore.getState();
    const ids = [1, 2, 3, 4, 5].map(() => t.push({ tone: 'info', messageKey: 'common.ok' }));
    expect(useToastStore.getState().toasts).toHaveLength(4);
    t.dismiss(ids[4]!);
    expect(useToastStore.getState().toasts).toHaveLength(3);
  });
});
