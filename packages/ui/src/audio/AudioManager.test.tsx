import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AudioManager,
  AudioProvider,
  clampVolume,
  computeMusicGain,
  computeSfxGain,
  DEFAULT_SOUND_SETTINGS,
  useSfx,
  volumeToGain,
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioContextLike,
  type GainNodeLike,
  type MusicTrack,
} from '../index.ts';

function createMockAudioContext() {
  const gainNodes: GainNodeLike[] = [];
  const sources: AudioBufferSourceNodeLike[] = [];
  const resume = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);

  const ctx: AudioContextLike = {
    state: 'suspended',
    sampleRate: 44100,
    destination: {
      connect: vi.fn((d) => d),
    },
    createBuffer(_channels: number, length: number, sampleRate: number): AudioBufferLike {
      const data = new Float32Array(length);
      return {
        length,
        sampleRate,
        getChannelData: () => data,
      };
    },
    createBufferSource(): AudioBufferSourceNodeLike {
      const source: AudioBufferSourceNodeLike = {
        buffer: null,
        playbackRate: { value: 1 },
        connect: vi.fn((d) => d),
        start: vi.fn(),
        stop: vi.fn(),
      };
      sources.push(source);
      return source;
    },
    createGain(): GainNodeLike {
      const node: GainNodeLike = {
        gain: { value: 1 },
        connect: vi.fn((d) => d),
      };
      gainNodes.push(node);
      return node;
    },
    resume,
    close,
  };

  return { ctx, gainNodes, sources, resume, close };
}

describe('AudioManager volume maths and autoplay rules', () => {
  const managers: AudioManager[] = [];

  afterEach(() => {
    while (managers.length > 0) {
      managers.pop()?.dispose();
    }
  });

  it('computes and clamps SFX/music gains accurately', () => {
    expect(DEFAULT_SOUND_SETTINGS).toEqual({
      enabled: true,
      sfxVolume: 30,
      musicVolume: 30,
    });

    expect(clampVolume(-20)).toBe(0);
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(30)).toBe(30);
    expect(clampVolume(100)).toBe(100);
    expect(clampVolume(180)).toBe(100);
    expect(clampVolume(Number.NaN)).toBe(0);

    expect(volumeToGain(30, true)).toBeCloseTo(0.3, 5);
    expect(volumeToGain(30, false)).toBe(0);
    expect(volumeToGain(100, true)).toBe(1);

    expect(computeSfxGain({ enabled: true, sfxVolume: 30, musicVolume: 80 }, false)).toBe(0);
    expect(computeSfxGain({ enabled: false, sfxVolume: 90, musicVolume: 80 }, true)).toBe(0);
    expect(
      computeSfxGain({ enabled: true, sfxVolume: 60, musicVolume: 80 }, true, 0.5),
    ).toBeCloseTo(0.3, 5);

    expect(computeMusicGain({ enabled: true, sfxVolume: 60, musicVolume: 40 }, false)).toBe(0);
    expect(computeMusicGain({ enabled: false, sfxVolume: 60, musicVolume: 40 }, true)).toBe(0);
    expect(computeMusicGain({ enabled: true, sfxVolume: 60, musicVolume: 40 }, true)).toBeCloseTo(
      0.4,
      5,
    );
  });

  it('stays muted with lazy AudioContext until the first user gesture', () => {
    const mock = createMockAudioContext();
    const factory = vi.fn(() => mock.ctx);
    const target = new EventTarget();

    const manager = new AudioManager({
      createAudioContext: factory,
      gestureTarget: target,
    });
    managers.push(manager);

    expect(manager.isUnlocked()).toBe(false);
    expect(manager.hasAudioContext()).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    expect(manager.getEffectiveVolumes()).toEqual({ sfx: 0, music: 0 });

    // Playing before gesture must stay silent and not create AudioContext
    expect(manager.play('click')).toBe(false);
    expect(factory).not.toHaveBeenCalled();

    // First user gesture unlocks manager (still lazy until play/music)
    target.dispatchEvent(new Event('pointerdown'));
    expect(manager.isUnlocked()).toBe(true);
    expect(factory).not.toHaveBeenCalled();
    expect(manager.getEffectiveVolumes()).toEqual({ sfx: 0.3, music: 0.3 });

    // Playing after unlock creates AudioContext lazily and starts buffer source
    expect(manager.play('coin')).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(manager.hasAudioContext()).toBe(true);
    expect(mock.sources).toHaveLength(1);
    expect(mock.sources[0]!.start).toHaveBeenCalledTimes(1);
    // Separate SFX and music gain nodes created at default 30%
    expect(mock.gainNodes[0]!.gain.value).toBeCloseTo(0.3, 5);
    expect(mock.gainNodes[1]!.gain.value).toBeCloseTo(0.3, 5);
  });

  it('updates separate SFX/music gains and silences output when sound is disabled', async () => {
    const mock = createMockAudioContext();
    const manager = new AudioManager({
      createAudioContext: () => mock.ctx,
      autoAttachGestureListeners: false,
    });
    managers.push(manager);

    await manager.unlock();
    expect(manager.play('chip')).toBe(true);

    const sfxGain = mock.gainNodes[0]!;
    const musicGain = mock.gainNodes[1]!;

    manager.setSettings({ sfxVolume: 75 });
    expect(sfxGain.gain.value).toBeCloseTo(0.75, 5);
    expect(musicGain.gain.value).toBeCloseTo(0.3, 5);

    manager.setSettings({ musicVolume: 15 });
    expect(sfxGain.gain.value).toBeCloseTo(0.75, 5);
    expect(musicGain.gain.value).toBeCloseTo(0.15, 5);

    manager.setSettings({ enabled: false });
    expect(sfxGain.gain.value).toBe(0);
    expect(musicGain.gain.value).toBe(0);
    expect(manager.play('click')).toBe(false);
    expect(mock.sources).toHaveLength(1);

    manager.setSettings({ enabled: true });
    expect(sfxGain.gain.value).toBeCloseTo(0.75, 5);
    expect(musicGain.gain.value).toBeCloseTo(0.15, 5);
    expect(manager.play('click')).toBe(true);
    expect(mock.sources).toHaveLength(2);
  });

  it('keeps optional music hook off by default and supports start/stop', async () => {
    const mock = createMockAudioContext();
    const stopSpy = vi.fn();
    const track: MusicTrack = {
      start: vi.fn(() => stopSpy),
    };

    const manager = new AudioManager({
      createAudioContext: () => mock.ctx,
      autoAttachGestureListeners: false,
    });
    managers.push(manager);

    manager.setMusicTrack(track);
    expect(manager.isMusicPlaying()).toBe(false);
    expect(track.start).not.toHaveBeenCalled();

    // Cannot start before unlock
    expect(manager.startMusic()).toBe(false);

    await manager.unlock();
    expect(manager.isMusicPlaying()).toBe(false);
    expect(manager.startMusic()).toBe(true);
    expect(manager.isMusicPlaying()).toBe(true);
    expect(track.start).toHaveBeenCalledTimes(1);

    manager.stopMusic();
    expect(manager.isMusicPlaying()).toBe(false);
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('syncs UserSettings sound via AudioProvider and useSfx', async () => {
    const mock = createMockAudioContext();
    const manager = new AudioManager({
      createAudioContext: () => mock.ctx,
      autoAttachGestureListeners: false,
    });
    managers.push(manager);

    function SoundProbe() {
      const sfx = useSfx();
      return (
        <div>
          <span data-testid="state">
            {String(sfx.unlocked)}:{String(sfx.settings.enabled)}:{sfx.settings.sfxVolume}:
            {sfx.settings.musicVolume}
          </span>
          <button
            type="button"
            onClick={() => {
              void sfx.unlock().then(() => {
                sfx.play('smallWin');
              });
            }}
          >
            Play
          </button>
        </div>
      );
    }

    const { rerender } = render(
      <AudioProvider manager={manager} sound={{ enabled: true, sfxVolume: 50, musicVolume: 20 }}>
        <SoundProbe />
      </AudioProvider>,
    );

    expect(screen.getByTestId('state').textContent).toBe('false:true:50:20');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    });

    expect(screen.getByTestId('state').textContent).toBe('true:true:50:20');
    expect(mock.sources).toHaveLength(1);

    rerender(
      <AudioProvider manager={manager} sound={{ enabled: false, sfxVolume: 50, musicVolume: 20 }}>
        <SoundProbe />
      </AudioProvider>,
    );

    expect(screen.getByTestId('state').textContent).toBe('true:false:50:20');
    expect(mock.gainNodes[0]!.gain.value).toBe(0);
  });
});
