import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from './api.ts';
import { createMockApi } from './mockApi.ts';
import { SettingsSync } from './settingsSync.ts';
import { useSettingsStore } from './stores/settings.ts';
import { useToastStore } from './stores/toasts.ts';
import { flush, resetStores } from './testing/fakes.ts';

beforeEach(resetStores);

function make(api: Api) {
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const sync = new SettingsSync({
    api,
    debounceMs: 400,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms, live: true });
      return timers.length - 1;
    },
    clearTimer: (h) => {
      const t = timers[h as number];
      if (t) t.live = false;
    },
  });
  return { sync, timers };
}

describe('settings sync (server API, not localStorage)', () => {
  it('loads the saved copy without treating it as an edit', async () => {
    const api = createMockApi();
    await api.saveSettings({ ...useSettingsStore.getState().snapshot(), language: 'ja' });
    const { sync, timers } = make(api);
    sync.start();
    await sync.load();
    expect(useSettingsStore.getState()).toMatchObject({ language: 'ja', loaded: true });
    expect(timers).toHaveLength(0);
  });

  it('saves the newest state once after a burst of edits', async () => {
    const api = createMockApi();
    const save = vi.spyOn(api, 'saveSettings');
    const { sync, timers } = make(api);
    sync.start();
    useSettingsStore.getState().update({ sound: { sfxVolume: 10 } });
    useSettingsStore.getState().update({ sound: { sfxVolume: 20 } });
    useSettingsStore.getState().update({ theme: 'dark' });
    const live = timers.filter((t) => t.live);
    expect(live).toHaveLength(1);
    expect(live[0]?.ms).toBe(400);
    live[0]?.fn();
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({ theme: 'dark', sound: { sfxVolume: 20 } });
    expect((await api.getSettings()).theme).toBe('dark');
  });

  it('keeps defaults when loading fails and shows a toast when saving fails', async () => {
    const api = createMockApi();
    api.getSettings = () => Promise.reject(new Error('404'));
    api.saveSettings = () => Promise.reject(new Error('500'));
    const { sync } = make(api);
    await sync.load();
    expect(useSettingsStore.getState().loaded).toBe(true);
    await sync.flush();
    expect(useToastStore.getState().toasts.map((t) => t.messageKey)).toEqual([
      'settings.saveFailed',
    ]);
  });
});
