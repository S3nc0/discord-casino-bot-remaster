import { describe, expect, it } from 'vitest';
import {
  buildSamples,
  getNote,
  getSfxPreset,
  renderSfxBuffer,
  SFX_NAMES,
  SFX_PRESETS,
  ZZFX_DEFAULT_SAMPLE_RATE,
} from '../index.ts';

const REQUIRED_PRESETS = [
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

describe('ZzFX synth & SFX presets', () => {
  it('defines all 16 required presets', () => {
    expect([...SFX_NAMES].sort()).toEqual([...REQUIRED_PRESETS].sort());
    for (const name of REQUIRED_PRESETS) {
      expect(SFX_PRESETS[name]).toBeDefined();
      expect(getSfxPreset(name)).toBe(SFX_PRESETS[name]);
    }
  });

  it.each(REQUIRED_PRESETS)(
    'preset "%s" generates a finite, non-silent, short, soft-attack sample buffer',
    (name) => {
      const buffer = renderSfxBuffer(name, ZZFX_DEFAULT_SAMPLE_RATE, () => 0.5);
      expect(buffer).toBeInstanceOf(Float32Array);
      expect(buffer.length).toBeGreaterThan(200);
      // Short retro SFX: under 1 second at 44.1 kHz
      expect(buffer.length).toBeLessThan(ZZFX_DEFAULT_SAMPLE_RATE);

      let peak = 0;
      let energy = 0;
      for (let i = 0; i < buffer.length; i++) {
        const sample = buffer[i]!;
        expect(Number.isFinite(sample)).toBe(true);
        expect(Math.abs(sample)).toBeLessThanOrEqual(1);
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
        energy += sample * sample;
      }

      expect(peak).toBeGreaterThan(0.05);
      expect(energy / buffer.length).toBeGreaterThan(1e-5);
      // Soft attack: starts at 0 and ramps up gently without a full-scale step at sample 0/1
      expect(buffer[0]).toBe(0);
      expect(Math.abs(buffer[1] ?? 0)).toBeLessThan(0.25);

      // Mid-range, soft-attack preset checks: attack >= 8ms, base freq <= 700Hz, LPF applied
      const preset = getSfxPreset(name);
      expect(preset[3] ?? 0).toBeGreaterThanOrEqual(0.008);
      expect(preset[2] ?? 220).toBeLessThanOrEqual(700);
      expect(preset[20] ?? 0).toBeLessThan(0);
    },
  );

  it('handles zero volume, invalid sample rate, and getNote helpers safely', () => {
    const silent = buildSamples([0, 0, 440, 0.01, 0.05, 0.05]);
    expect(silent.length).toBeGreaterThan(0);
    expect(silent.every((s) => s === 0)).toBe(true);

    expect(buildSamples([1], 0).length).toBe(0);
    expect(buildSamples([1], -44100).length).toBe(0);

    expect(getNote(0, 440)).toBe(440);
    expect(getNote(12, 440)).toBeCloseTo(880, 5);
  });
});
