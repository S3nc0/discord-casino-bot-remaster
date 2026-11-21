import { buildSamples, ZZFX_DEFAULT_SAMPLE_RATE, type ZzfxParams } from './zzfx.ts';

/**
 * Canonical Bitbloom SFX preset names.
 * All presets target short, retro, mid-range tones with soft attacks (not shrill).
 */
export const SFX_NAMES = [
  'click',
  'chip',
  'cardDeal',
  'cardFlip',
  'diceRoll',
  'reelTick',
  'reelStop',
  'smallWin',
  'bigWin',
  'lose',
  'coin',
  'cashRegister',
  'raceGateBell',
  'raceFinish',
  'notificationPing',
  'errorBuzz',
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

/*
 * ZzFX parameter positions:
 * [0: volume, 1: randomness, 2: frequency, 3: attack, 4: sustain, 5: release,
 *  6: shape (0=sin,1=tri,2=saw,3=tan,4=noise,5=square), 7: shapeCurve,
 *  8: slide, 9: deltaSlide, 10: pitchJump, 11: pitchJumpTime, 12: repeatTime,
 *  13: noise, 14: modulation, 15: bitCrush, 16: delay, 17: sustainVolume,
 *  18: decay, 19: tremolo, 20: filter (<0 = low-pass)]
 */
export const SFX_PRESETS: Readonly<Record<SfxName, ZzfxParams>> = {
  click: [0.45, 0.04, 380, 0.008, 0.005, 0.03, 1, 1, -12, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, -1400],
  chip: [
    0.5, 0.05, 520, 0.008, 0.01, 0.05, 1, 1, 0, 0, 140, 0.018, 0, 0, 0, 0.08, 0, 0.9, 0.01, 0,
    -1600,
  ],
  cardDeal: [
    0.45, 0.06, 260, 0.012, 0.02, 0.06, 4, 0.8, 6, 0, 0, 0, 0, 0.35, 0, 0, 0, 0.8, 0.015, 0, -900,
  ],
  cardFlip: [
    0.48, 0.05, 330, 0.01, 0.015, 0.055, 1, 1, 10, 0, 0, 0, 0, 0.15, 0, 0, 0, 0.85, 0.01, 0, -1200,
  ],
  diceRoll: [
    0.5, 0.08, 240, 0.012, 0.08, 0.12, 1, 1, 0, 0, 0, 0, 0.045, 0.25, 0, 0.12, 0, 0.8, 0.02, 0.3,
    -1100,
  ],
  reelTick: [
    0.38, 0.04, 310, 0.008, 0.005, 0.025, 1, 1, -8, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, -1200,
  ],
  reelStop: [
    0.55, 0.03, 185, 0.01, 0.015, 0.08, 1, 1, -6, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.02, 0, -950,
  ],
  smallWin: [
    0.55, 0.02, 440, 0.015, 0.08, 0.18, 1, 1, 0, 0, 110, 0.075, 0, 0, 0, 0, 0.05, 0.75, 0.04, 0,
    -1600,
  ],
  bigWin: [
    0.6, 0.02, 392, 0.018, 0.18, 0.32, 5, 0.45, 0, 0, 196, 0.09, 0.14, 0, 0, 0, 0.08, 0.7, 0.06,
    0.2, -1400,
  ],
  lose: [
    0.5, 0.02, 280, 0.02, 0.06, 0.22, 1, 1, -3.5, 0, -70, 0.09, 0, 0, 0, 0, 0, 0.65, 0.05, 0, -950,
  ],
  coin: [
    0.52, 0.03, 659.25, 0.01, 0.04, 0.16, 0, 1, 0, 0, 328.5, 0.055, 0, 0, 0, 0, 0, 0.8, 0.02, 0,
    -1800,
  ],
  cashRegister: [
    0.55, 0.03, 523.25, 0.012, 0.08, 0.22, 1, 1, 0, 0, 261.6, 0.065, 0.12, 0, 0, 0.05, 0.04, 0.7,
    0.03, 0, -1650,
  ],
  raceGateBell: [
    0.55, 0.02, 587.33, 0.012, 0.12, 0.28, 0, 1, 0, 0, 0, 0, 0.09, 0, 12, 0, 0, 0.75, 0.04, 0.25,
    -1500,
  ],
  raceFinish: [
    0.58, 0.02, 440, 0.018, 0.16, 0.28, 1, 1, 0, 0, 220, 0.1, 0, 0, 0, 0, 0.06, 0.8, 0.05, 0, -1550,
  ],
  notificationPing: [
    0.45, 0.02, 523.25, 0.015, 0.04, 0.18, 0, 1, 0, 0, 130.8, 0.06, 0, 0, 0, 0, 0, 0.7, 0.03, 0,
    -1500,
  ],
  errorBuzz: [
    0.5, 0.02, 155, 0.015, 0.08, 0.14, 2, 1, 0, 0, 0, 0, 0.08, 0, 0, 0, 0, 0.7, 0.03, 0, -700,
  ],
};

export function getSfxPreset(name: SfxName): ZzfxParams {
  return SFX_PRESETS[name];
}

export function renderSfxBuffer(
  name: SfxName,
  sampleRate = ZZFX_DEFAULT_SAMPLE_RATE,
  rng: () => number = Math.random,
): Float32Array {
  return buildSamples(SFX_PRESETS[name], sampleRate, rng);
}
