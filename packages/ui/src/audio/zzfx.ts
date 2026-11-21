/*
 * ZzFX - Zuper Zmall Zound Zynth (MIT License)
 * Copyright (c) 2019 Frank Force (KilledByAPixel)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

export const ZZFX_DEFAULT_SAMPLE_RATE = 44100;

/**
 * Positional ZzFX parameter tuple (up to 21 parameters):
 * [volume, randomness, frequency, attack, sustain, release, shape, shapeCurve,
 *  slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation,
 *  bitCrush, delay, sustainVolume, decay, tremolo, filter]
 */
export type ZzfxParams = readonly (number | undefined)[];

/** Return the frequency in Hz for a semitone offset on a 12-TET scale. */
export function getNote(semitoneOffset = 0, rootNoteFrequency = 440): number {
  return rootNoteFrequency * 2 ** (semitoneOffset / 12);
}

function clampSample(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

/**
 * Generate raw mono PCM samples for a ZzFX sound parameter tuple without
 * creating an AudioContext. Safe to call in SSR, workers, or Node tests.
 */
export function buildSamples(
  params: ZzfxParams,
  sampleRate = ZZFX_DEFAULT_SAMPLE_RATE,
  rng: () => number = Math.random,
): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return new Float32Array(0);
  }

  const volume = params[0] ?? 1;
  const randomness = params[1] ?? 0.05;
  const baseFrequency = params[2] ?? 220;
  const rawAttack = params[3] ?? 0;
  const rawSustain = params[4] ?? 0;
  const rawRelease = params[5] ?? 0.1;
  const shape = params[6] ?? 0;
  const shapeCurve = params[7] ?? 1;
  const rawSlide = params[8] ?? 0;
  const rawDeltaSlide = params[9] ?? 0;
  const rawPitchJump = params[10] ?? 0;
  const rawPitchJumpTime = params[11] ?? 0;
  const rawRepeatTime = params[12] ?? 0;
  const noise = params[13] ?? 0;
  const rawModulation = params[14] ?? 0;
  const bitCrush = params[15] ?? 0;
  const rawDelay = params[16] ?? 0;
  const sustainVolume = params[17] ?? 1;
  const rawDecay = params[18] ?? 0;
  const tremolo = params[19] ?? 0;
  const filter = params[20] ?? 0;

  const PI2 = Math.PI * 2;
  const abs = Math.abs;
  const sign = (v: number) => (v < 0 ? -1 : 1);

  let slide = (rawSlide * 500 * PI2) / sampleRate / sampleRate;
  const startSlide = slide;
  let frequency = (baseFrequency * (1 + randomness * 2 * rng() - randomness) * PI2) / sampleRate;
  let startFrequency = frequency;

  let modOffset = 0;
  let repeat = 0;
  let crush = 0;
  let jump = 1;
  let t = 0;
  let s = 0;

  // Biquad LP/HP filter coefficients
  const quality = 2;
  const w = (PI2 * abs(filter) * 2) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / 2 / quality;
  const a0 = 1 + alpha;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const b0 = (1 + sign(filter) * cos) / 2 / a0;
  const b1 = -(sign(filter) + cos) / a0;
  const b2 = b0;
  let x2 = 0;
  let x1 = 0;
  let y2 = 0;
  let y1 = 0;

  const minAttack = 9; // prevent pop if attack is 0
  const attack = rawAttack * sampleRate || minAttack;
  const decay = rawDecay * sampleRate;
  const sustain = rawSustain * sampleRate;
  const release = rawRelease * sampleRate;
  const delay = rawDelay * sampleRate;
  const deltaSlide = (rawDeltaSlide * 500 * PI2) / sampleRate ** 3;
  const modulation = (rawModulation * PI2) / sampleRate;
  const pitchJump = (rawPitchJump * PI2) / sampleRate;
  const pitchJumpTime = rawPitchJumpTime * sampleRate;
  const repeatTime = (rawRepeatTime * sampleRate) | 0;

  const length = (attack + decay + sustain + release + delay) | 0;
  const buffer = new Float32Array(length > 0 ? length : 0);
  if (length <= 0 || volume === 0) {
    return buffer;
  }

  const bitCrushStep = (bitCrush * 100) | 0;

  for (let i = 0; i < length; i++) {
    if (!(++crush % bitCrushStep)) {
      if (shape > 4) {
        s = (t / PI2) % 1 < shapeCurve / 2 ? 1 : -1;
      } else if (shape > 3) {
        s = Math.sin(t ** 3);
      } else if (shape > 2) {
        s = Math.max(Math.min(Math.tan(t), 1), -1);
      } else if (shape > 1) {
        s = 1 - (((((2 * t) / PI2) % 2) + 2) % 2);
      } else if (shape > 0) {
        s = 1 - 4 * abs(Math.round(t / PI2) - t / PI2);
      } else {
        s = Math.sin(t);
      }

      const tremoloFactor = repeatTime
        ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime)
        : 1;
      const shaped = shape > 4 ? s : sign(s) * abs(s) ** shapeCurve;

      let envelope = 0;
      if (i < attack) {
        envelope = i / attack;
      } else if (decay > 0 && i < attack + decay) {
        envelope = 1 - ((i - attack) / decay) * (1 - sustainVolume);
      } else if (i < attack + decay + sustain) {
        envelope = sustainVolume;
      } else if (release > 0 && i < length - delay) {
        envelope = ((length - i - delay) / release) * sustainVolume;
      }

      s = tremoloFactor * shaped * envelope;

      if (delay > 0) {
        const prevIdx = (i - delay) | 0;
        const echo =
          delay > i || prevIdx < 0
            ? 0
            : ((i < length - delay ? 1 : (length - i) / delay) * (buffer[prevIdx] ?? 0)) /
              2 /
              volume;
        s = s / 2 + echo;
      }

      if (filter !== 0) {
        const nextX = s;
        s = b2 * x2 + b1 * x1 + b0 * nextX - a2 * y2 - a1 * y1;
        x2 = x1;
        x1 = nextX;
        y2 = y1;
        y1 = s;
      }
    }

    buffer[i] = clampSample(s * volume);

    slide += deltaSlide;
    frequency += slide;
    const f = frequency * Math.cos(modulation * modOffset++);
    t += f + f * noise * (((i * i * PI2) % 2) - 1);

    if (jump && ++jump > pitchJumpTime) {
      frequency += pitchJump;
      startFrequency += pitchJump;
      jump = 0;
    }

    if (repeatTime && !(++repeat % repeatTime)) {
      frequency = startFrequency;
      slide = startSlide;
      jump ||= 1;
    }
  }

  return buffer;
}
