import { renderSfxBuffer, type SfxName } from './sfx.ts';
import { ZZFX_DEFAULT_SAMPLE_RATE } from './zzfx.ts';

export const DEFAULT_SOUND_VOLUME = 30;

export interface SoundSettings {
  enabled: boolean;
  sfxVolume: number;
  musicVolume: number;
}

export const DEFAULT_SOUND_SETTINGS: Readonly<SoundSettings> = Object.freeze({
  enabled: true,
  sfxVolume: DEFAULT_SOUND_VOLUME,
  musicVolume: DEFAULT_SOUND_VOLUME,
});

export interface AudioBufferLike {
  readonly length: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioParamLike {
  value: number;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): AudioNodeLike;
  disconnect?(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  readonly playbackRate: AudioParamLike;
  start(when?: number): void;
  stop?(when?: number): void;
}

export interface AudioContextLike {
  readonly state?: string;
  readonly sampleRate?: number;
  readonly destination: AudioNodeLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createGain(): GainNodeLike;
  resume?(): Promise<void> | void;
  close?(): Promise<void> | void;
}

export interface MusicTrack {
  start(ctx: AudioContextLike, destination: GainNodeLike): (() => void) | void;
}

export interface PlaySfxOptions {
  /** Optional per-call relative gain scale in [0, 1]. Defaults to 1. */
  volume?: number;
  /** Optional playback rate multiplier. Defaults to 1. */
  pitch?: number;
  /** Optional deterministic RNG for preset randomization. */
  rng?: () => number;
}

export interface AudioManagerOptions {
  settings?: Partial<SoundSettings>;
  createAudioContext?: () => AudioContextLike | null;
  sampleRate?: number;
  gestureTarget?: EventTarget | null;
  autoAttachGestureListeners?: boolean;
}

export interface AudioSnapshot {
  readonly unlocked: boolean;
  readonly settings: Readonly<SoundSettings>;
  readonly musicPlaying: boolean;
  readonly sfxGain: number;
  readonly musicGain: number;
}

const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'click'] as const;

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return value;
}

export function volumeToGain(volumePercent: number, enabled = true): number {
  if (!enabled) return 0;
  return clampVolume(volumePercent) / 100;
}

export function computeSfxGain(
  settings: Readonly<SoundSettings>,
  unlocked: boolean,
  scale = 1,
): number {
  if (!unlocked || !settings.enabled) return 0;
  const clampedScale = Number.isFinite(scale) ? Math.min(1, Math.max(0, scale)) : 1;
  return volumeToGain(settings.sfxVolume, true) * clampedScale;
}

export function computeMusicGain(settings: Readonly<SoundSettings>, unlocked: boolean): number {
  if (!unlocked || !settings.enabled) return 0;
  return volumeToGain(settings.musicVolume, true);
}

function defaultCreateAudioContext(): AudioContextLike | null {
  if (typeof window === 'undefined') return null;
  const ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext;
  if (typeof ctor !== 'function') return null;
  try {
    return new ctor() as unknown as AudioContextLike;
  } catch {
    return null;
  }
}

export class AudioManager {
  private settings: SoundSettings;
  private unlocked = false;
  private context: AudioContextLike | null = null;
  private sfxGainNode: GainNodeLike | null = null;
  private musicGainNode: GainNodeLike | null = null;
  private readonly createAudioContext: () => AudioContextLike | null;
  private readonly sampleRate: number;
  private readonly gestureTarget: EventTarget | null;
  private gestureAttached = false;
  private readonly bufferCache = new Map<SfxName, Float32Array>();
  private musicTrack: MusicTrack | null = null;
  private musicCleanup: (() => void) | null = null;
  private musicPlaying = false;
  private readonly listeners = new Set<() => void>();
  private snapshot: AudioSnapshot;

  constructor(options: AudioManagerOptions = {}) {
    this.settings = {
      enabled: options.settings?.enabled ?? DEFAULT_SOUND_SETTINGS.enabled,
      sfxVolume: clampVolume(options.settings?.sfxVolume ?? DEFAULT_SOUND_SETTINGS.sfxVolume),
      musicVolume: clampVolume(options.settings?.musicVolume ?? DEFAULT_SOUND_SETTINGS.musicVolume),
    };
    this.createAudioContext = options.createAudioContext ?? defaultCreateAudioContext;
    this.sampleRate = options.sampleRate ?? ZZFX_DEFAULT_SAMPLE_RATE;
    this.gestureTarget =
      options.gestureTarget !== undefined
        ? options.gestureTarget
        : typeof window !== 'undefined'
          ? window
          : null;
    this.snapshot = this.buildSnapshot();

    if (options.autoAttachGestureListeners !== false) {
      this.attachGestureListeners();
    }
  }

  private readonly onUserGesture = (): void => {
    void this.unlock();
  };

  private attachGestureListeners(): void {
    if (this.gestureAttached || this.unlocked || !this.gestureTarget) return;
    this.gestureAttached = true;
    for (const eventName of GESTURE_EVENTS) {
      this.gestureTarget.addEventListener(eventName, this.onUserGesture, {
        capture: true,
        passive: true,
      });
    }
  }

  private detachGestureListeners(): void {
    if (!this.gestureAttached || !this.gestureTarget) return;
    this.gestureAttached = false;
    for (const eventName of GESTURE_EVENTS) {
      this.gestureTarget.removeEventListener(eventName, this.onUserGesture, { capture: true });
    }
  }

  private buildSnapshot(): AudioSnapshot {
    return Object.freeze({
      unlocked: this.unlocked,
      settings: Object.freeze({ ...this.settings }),
      musicPlaying: this.musicPlaying,
      sfxGain: computeSfxGain(this.settings, this.unlocked),
      musicGain: computeMusicGain(this.settings, this.unlocked),
    });
  }

  private notify(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AudioSnapshot => {
    return this.snapshot;
  };

  isUnlocked(): boolean {
    return this.unlocked;
  }

  hasAudioContext(): boolean {
    return this.context !== null;
  }

  getSettings(): Readonly<SoundSettings> {
    return this.snapshot.settings;
  }

  getEffectiveVolumes(): { sfx: number; music: number } {
    return {
      sfx: computeSfxGain(this.settings, this.unlocked),
      music: computeMusicGain(this.settings, this.unlocked),
    };
  }

  setSettings(next: Partial<SoundSettings>): void {
    const updated: SoundSettings = {
      enabled: next.enabled ?? this.settings.enabled,
      sfxVolume:
        next.sfxVolume !== undefined ? clampVolume(next.sfxVolume) : this.settings.sfxVolume,
      musicVolume:
        next.musicVolume !== undefined ? clampVolume(next.musicVolume) : this.settings.musicVolume,
    };

    const changed =
      updated.enabled !== this.settings.enabled ||
      updated.sfxVolume !== this.settings.sfxVolume ||
      updated.musicVolume !== this.settings.musicVolume;

    if (!changed) return;

    this.settings = updated;
    this.syncGainNodes();
    this.notify();
  }

  private syncGainNodes(): void {
    if (this.sfxGainNode) {
      this.sfxGainNode.gain.value = computeSfxGain(this.settings, this.unlocked);
    }
    if (this.musicGainNode) {
      this.musicGainNode.gain.value = computeMusicGain(this.settings, this.unlocked);
    }
  }

  private ensureContext(): AudioContextLike | null {
    if (this.context) {
      if (this.context.state === 'suspended' && typeof this.context.resume === 'function') {
        void Promise.resolve(this.context.resume()).catch(() => {});
      }
      return this.context;
    }

    const ctx = this.createAudioContext();
    if (!ctx) return null;

    this.context = ctx;
    this.sfxGainNode = ctx.createGain();
    this.sfxGainNode.connect(ctx.destination);
    this.musicGainNode = ctx.createGain();
    this.musicGainNode.connect(ctx.destination);
    this.syncGainNodes();

    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      void Promise.resolve(ctx.resume()).catch(() => {});
    }

    return ctx;
  }

  /**
   * Unlocks audio playback after a user gesture. Safe to call multiple times.
   * Does not eagerly instantiate an AudioContext unless one already exists.
   */
  async unlock(): Promise<boolean> {
    if (!this.unlocked) {
      this.unlocked = true;
      this.detachGestureListeners();
      this.syncGainNodes();
      this.notify();
    }
    if (this.context?.state === 'suspended' && typeof this.context.resume === 'function') {
      try {
        await this.context.resume();
      } catch {
        // Ignore browser autoplay resume rejection; next gesture can retry.
      }
    }
    return this.unlocked;
  }

  play(name: SfxName, options: PlaySfxOptions = {}): boolean {
    const effectiveGain = computeSfxGain(this.settings, this.unlocked, options.volume ?? 1);
    if (effectiveGain <= 0) {
      return false;
    }

    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGainNode) {
      return false;
    }

    const samples = this.getSamples(name, options.rng);
    if (samples.length === 0) {
      return false;
    }

    const rate = ctx.sampleRate && ctx.sampleRate > 0 ? ctx.sampleRate : this.sampleRate;
    const renderSamples =
      rate === this.sampleRate ? samples : renderSfxBuffer(name, rate, options.rng);

    const buffer = ctx.createBuffer(1, renderSamples.length, rate);
    buffer.getChannelData(0).set(renderSamples);

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const pitch = options.pitch ?? 1;
    if (Number.isFinite(pitch) && pitch > 0) {
      source.playbackRate.value = pitch;
    }

    if (options.volume !== undefined && options.volume !== 1) {
      const perPlayGain = ctx.createGain();
      perPlayGain.gain.value = Math.min(1, Math.max(0, options.volume));
      source.connect(perPlayGain);
      perPlayGain.connect(this.sfxGainNode);
    } else {
      source.connect(this.sfxGainNode);
    }

    source.start(0);
    return true;
  }

  private getSamples(name: SfxName, rng?: () => number): Float32Array {
    if (rng) {
      return renderSfxBuffer(name, this.sampleRate, rng);
    }
    let cached = this.bufferCache.get(name);
    if (!cached) {
      cached = renderSfxBuffer(name, this.sampleRate, () => 0.5);
      this.bufferCache.set(name, cached);
    }
    return cached;
  }

  /** Optional music hook (off by default). */
  setMusicTrack(track: MusicTrack | null): void {
    if (this.musicTrack === track) return;
    this.stopMusic();
    this.musicTrack = track;
  }

  isMusicPlaying(): boolean {
    return this.musicPlaying;
  }

  startMusic(): boolean {
    if (!this.musicTrack || !this.unlocked || !this.settings.enabled) {
      return false;
    }
    if (this.musicPlaying) {
      return true;
    }

    const ctx = this.ensureContext();
    if (!ctx || !this.musicGainNode) {
      return false;
    }

    const cleanup = this.musicTrack.start(ctx, this.musicGainNode);
    this.musicCleanup = typeof cleanup === 'function' ? cleanup : null;
    this.musicPlaying = true;
    this.notify();
    return true;
  }

  stopMusic(): void {
    if (!this.musicPlaying && !this.musicCleanup) return;
    const cleanup = this.musicCleanup;
    this.musicCleanup = null;
    this.musicPlaying = false;
    cleanup?.();
    this.notify();
  }

  dispose(): void {
    this.stopMusic();
    this.detachGestureListeners();
    this.bufferCache.clear();
    if (this.context && typeof this.context.close === 'function') {
      void Promise.resolve(this.context.close()).catch(() => {});
    }
    this.context = null;
    this.sfxGainNode = null;
    this.musicGainNode = null;
    this.listeners.clear();
  }
}

let defaultAudioManager: AudioManager | null = null;

export function getDefaultAudioManager(): AudioManager {
  if (!defaultAudioManager) {
    defaultAudioManager = new AudioManager();
  }
  return defaultAudioManager;
}
