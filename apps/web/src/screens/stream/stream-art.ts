import type { SceneArt } from '@casino/ui';

/**
 * Compact 12×8 pixel-art ON-AIR lamp badge, palette tokens only (no raw colour values).
 * Frame 0 is the still frame shown under reduced motion; frame 1 pulses the broadcast lamp.
 */
export const ON_AIR_BADGE: SceneArt = {
  w: 12,
  h: 8,
  legend: {
    k: ['neutral-4', 'neutral-4'],
    d: ['neutral-24', 'neutral-17'],
    r: ['red-40', 'red-40'],
    R: ['red-60', 'red-60'],
    h: ['orange-80', 'orange-80'],
    p: ['paper-99', 'paper-99'],
  },
  frames: [
    [
      '.kkkkkkkkkk.',
      'kddddddddddk',
      'kd..rRRr..dk',
      'kd.rRppRr.dk',
      'kd.rRppRr.dk',
      'kd..rRRr..dk',
      'kddddddddddk',
      '.kkkkkkkkkk.',
    ],
    [
      '.kkkkkkkkkk.',
      'kddddddddddk',
      'kd.rRhhRr.dk',
      'kd.RhppRR.dk',
      'kd.RRppRR.dk',
      'kd.rRRRRr.dk',
      'kddddddddddk',
      '.kkkkkkkkkk.',
    ],
  ],
};
