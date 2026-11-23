// A small full-body character, 26 by 32, drawn as lit parts (no reference: kept small and simple).
// Colours and the right arm's pose change per scene; `flip` mirrors it to face left.
import { prop } from './kit.js';

const COATS = {
  violet: ['violet-20', 'violet-30', 'violet-40', 'violet-50', 'violet-60'],
  teal: ['teal-20', 'teal-30', 'teal-40', 'teal-50', 'teal-70'],
  red: ['red-20', 'red-30', 'red-40', 'red-50', 'red-60'],
  green: ['green-20', 'green-30', 'green-40', 'green-50', 'green-70'],
  orange: ['red-30', 'orange-40', 'orange-50', 'orange-60', 'orange-70'],
  sky: ['blue-20', 'blue-30', 'sky-40', 'sky-50', 'sky-70'],
};
const HAIR = {
  brown: ['brown-10', 'brown-20', 'brown-30', 'brown-40', 'brown-60'],
  black: ['neutral-4', 'neutral-10', 'neutral-17', 'neutral-25', 'neutral-40'],
  blond: ['amber-40', 'amber-50', 'amber-60', 'amber-70', 'yellow-90'],
  red: ['red-10', 'red-20', 'red-30', 'red-40', 'orange-60'],
};
const PANTS = ['neutral-10', 'neutral-17', 'neutral-24', 'neutral-30', 'neutral-40'];

/**
 * `pose`: 'down' (arms at the sides), 'up' (right hand raised), 'out' (right hand held out
 * forward at chest height), 'mic' (holding a microphone up).
 */
function person({ coat = 'violet', hair = 'brown', pose = 'down', legs = true } = {}) {
  return prop(26, legs ? 32 : 26, (hi, part) => {
    const COAT = COATS[coat];
    if (legs) {
      const pants = part(PANTS, { round: 0.9 });
      hi.rect(pants, 9, 24, 3, 5).rect(pants, 14, 24, 3, 5);
      const shoe = part('ink', { bevel: true, steps: [1, 2, 3] });
      hi.rect(shoe, 8, 29, 4, 2).rect(shoe, 14, 29, 4, 2);
    }
    const body = part(COAT, { round: 2.2 });
    hi.rrect(body, 6, 14, 14, 11, 3.5);
    const arm = part(COAT, { round: 1.0 });
    hi.line(arm, 7.4, 16, 5.6, 22.5, 2.8);
    const skin = part('skin', { round: 2.4, steps: [1, 2, 3] });
    const hand = part('skin', { round: 0.9, steps: [1, 2, 3] });
    hi.ellipse(hand, 5.4, 23.4, 1.5, 1.5);
    if (pose === 'down') {
      hi.line(arm, 18.6, 16, 20.4, 22.5, 2.8);
      hi.ellipse(hand, 20.6, 23.4, 1.5, 1.5);
    } else if (pose === 'up' || pose === 'mic') {
      hi.line(arm, 18.4, 16.4, 21.8, 10.6, 3.0);
      hi.ellipse(hand, 22.2, 10.0, 1.8, 1.8);
    } else if (pose === 'out') {
      hi.line(arm, 18.4, 16.4, 23.0, 17.0, 3.0);
      hi.ellipse(hand, 23.4, 17.0, 1.7, 1.7);
    }
    const collar = part('paper', { fixed: 4, outline: false });
    hi.poly(collar, [
      [10.4, 14],
      [15.6, 14],
      [13, 17.4],
    ]);
    hi.ellipse(skin, 13, 8.4, 5.4, 5.6);
    hi.ellipse(skin, 7.6, 9, 1.2, 1.6).ellipse(skin, 18.4, 9, 1.2, 1.6);
    const h = part(HAIR[hair], { round: 1.6 });
    hi.ellipse(h, 13, 4.4, 6.0, 3.1).rect(h, 7.0, 4.4, 1.6, 3.6).rect(h, 17.4, 4.4, 1.6, 2.0);
    if (pose === 'mic') {
      const stick = part('ink', { fixed: 2 });
      hi.rect(stick, 21.8, 5.8, 1, 3.4);
      const mic = part('steel', { round: 1.0, steps: [1, 3, 4] });
      hi.ellipse(mic, 22.4, 4.4, 2.0, 2.0);
    }
    const eye = part('ink', { fixed: 0, outline: false });
    hi.rect(eye, 10, 8, 1, 2).rect(eye, 15, 8, 1, 2);
    const cheek = part('red', { fixed: 3, outline: false });
    hi.rect(cheek, 9, 10, 1, 1).rect(cheek, 16, 10, 1, 1);
    const mouth = part('red', { fixed: 1, outline: false });
    hi.rect(mouth, 12, 11, 3, 1);
  });
}

export { person, COATS, HAIR };
