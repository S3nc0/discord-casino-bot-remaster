import type { Api } from './api.ts';
import { useSettingsStore } from './stores/settings.ts';
import { useToastStore } from './stores/toasts.ts';

export const SETTINGS_SAVE_DEBOUNCE_MS = 400;

export interface SettingsSyncOptions {
  api: Api;
  debounceMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Settings live on the server. The store is the working copy: edits apply at once and are
 * saved (debounced, newest wins) through the API; the server's reply is not re-applied so a
 * slider is not fought over while it is dragged.
 */
export class SettingsSync {
  private timer: unknown = null;
  private lastRevision = useSettingsStore.getState().revision;
  private off: (() => void) | null = null;
  private readonly debounceMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private readonly options: SettingsSyncOptions;

  constructor(options: SettingsSyncOptions) {
    this.options = options;
    this.debounceMs = options.debounceMs ?? SETTINGS_SAVE_DEBOUNCE_MS;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Fetch the saved settings. On failure the defaults stay and the screen still works. */
  async load(): Promise<void> {
    try {
      useSettingsStore.getState().hydrate(await this.options.api.getSettings());
    } catch {
      useSettingsStore.getState().hydrate(useSettingsStore.getState().snapshot());
    }
    this.lastRevision = useSettingsStore.getState().revision;
  }

  start(): void {
    if (this.off) return;
    this.lastRevision = useSettingsStore.getState().revision;
    this.off = useSettingsStore.subscribe((s) => {
      if (s.revision === this.lastRevision) return;
      this.lastRevision = s.revision;
      if (this.timer !== null) this.clearTimer(this.timer);
      this.timer = this.setTimer(() => void this.flush(), this.debounceMs);
    });
  }

  stop(): void {
    this.off?.();
    this.off = null;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  async flush(): Promise<void> {
    this.timer = null;
    try {
      await this.options.api.saveSettings(useSettingsStore.getState().snapshot());
    } catch {
      useToastStore.getState().push({ tone: 'error', messageKey: 'settings.saveFailed' });
    }
  }
}
