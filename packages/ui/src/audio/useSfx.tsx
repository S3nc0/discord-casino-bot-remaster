import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  getDefaultAudioManager,
  type AudioManager,
  type MusicTrack,
  type PlaySfxOptions,
  type SoundSettings,
} from './AudioManager.ts';
import type { SfxName } from './sfx.ts';

const AudioManagerContext = createContext<AudioManager | null>(null);

export interface AudioProviderProps {
  children: ReactNode;
  /** Sound settings synced from UserSettings (enabled, sfxVolume, musicVolume). */
  sound?: Partial<SoundSettings>;
  /** Optional custom AudioManager instance (useful in tests). */
  manager?: AudioManager;
  /** Optional music track hook (stays off until start() is called). */
  musicTrack?: MusicTrack | null;
}

export function AudioProvider({ children, sound, manager, musicTrack }: AudioProviderProps) {
  const resolvedManager = useMemo(() => manager ?? getDefaultAudioManager(), [manager]);

  const soundEnabled = sound?.enabled;
  const sfxVolume = sound?.sfxVolume;
  const musicVolume = sound?.musicVolume;

  useEffect(() => {
    if (soundEnabled === undefined && sfxVolume === undefined && musicVolume === undefined) {
      return;
    }
    resolvedManager.setSettings({
      ...(soundEnabled !== undefined ? { enabled: soundEnabled } : {}),
      ...(sfxVolume !== undefined ? { sfxVolume } : {}),
      ...(musicVolume !== undefined ? { musicVolume } : {}),
    });
  }, [resolvedManager, soundEnabled, sfxVolume, musicVolume]);

  useEffect(() => {
    if (musicTrack === undefined) return;
    resolvedManager.setMusicTrack(musicTrack);
  }, [resolvedManager, musicTrack]);

  return (
    <AudioManagerContext.Provider value={resolvedManager}>{children}</AudioManagerContext.Provider>
  );
}

export interface UseSfxResult {
  play: (name: SfxName, options?: PlaySfxOptions) => boolean;
  unlock: () => Promise<boolean>;
  unlocked: boolean;
  settings: Readonly<SoundSettings>;
  setSettings: (next: Partial<SoundSettings>) => void;
  sfxGain: number;
  musicGain: number;
  music: {
    playing: boolean;
    start: () => boolean;
    stop: () => void;
  };
}

export function useSfx(overrideManager?: AudioManager): UseSfxResult {
  const contextManager = useContext(AudioManagerContext);
  const manager = overrideManager ?? contextManager ?? getDefaultAudioManager();

  const snapshot = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );

  const play = useCallback(
    (name: SfxName, options?: PlaySfxOptions) => manager.play(name, options),
    [manager],
  );

  const unlock = useCallback(() => manager.unlock(), [manager]);

  const setSettings = useCallback(
    (next: Partial<SoundSettings>) => manager.setSettings(next),
    [manager],
  );

  const startMusic = useCallback(() => manager.startMusic(), [manager]);
  const stopMusic = useCallback(() => manager.stopMusic(), [manager]);

  const music = useMemo(
    () => ({
      playing: snapshot.musicPlaying,
      start: startMusic,
      stop: stopMusic,
    }),
    [snapshot.musicPlaying, startMusic, stopMusic],
  );

  return useMemo(
    () => ({
      play,
      unlock,
      unlocked: snapshot.unlocked,
      settings: snapshot.settings,
      setSettings,
      sfxGain: snapshot.sfxGain,
      musicGain: snapshot.musicGain,
      music,
    }),
    [
      play,
      unlock,
      snapshot.unlocked,
      snapshot.settings,
      setSettings,
      snapshot.sfxGain,
      snapshot.musicGain,
      music,
    ],
  );
}
