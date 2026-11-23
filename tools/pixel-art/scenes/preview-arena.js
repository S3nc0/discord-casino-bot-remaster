// Preview of the pit with two fighters (not shipped): frames, gif, 1x pngs for the mockups.
import fs from 'node:fs';
import { P, out } from '../lib/env.js';
import { pit, PIT_SLOTS, PIT_FLOOR } from './arena.js';
import { FIGHTERS, fighter, outlined, FW, FH } from './fighters.js';
import { paste } from './kit.js';

const scene = (f, a, bIdx, poseA, poseB) => {
  const b = pit(f);
  const A = outlined(fighter(FIGHTERS[a], poseA)),
    B = outlined(fighter(FIGHTERS[bIdx], poseB, true));
  paste(b, A, PIT_SLOTS.left - 17, PIT_FLOOR - FH + 2);
  paste(b, B, PIT_SLOTS.right - (FW - 17), PIT_FLOOR - FH + 2);
  return b;
};
// a short exchange: both on guard, left punches, both on guard, right punches
const seq = [
  ['idle', 'idle'],
  ['idle', 'idle'],
  ['attack', 'idle'],
  ['idle', 'idle'],
  ['idle', 'idle'],
  ['idle', 'attack'],
];
const frames = seq.map(([a, b], i) => scene(i % 3, 0, 2, a, b));
P.save(
  P.sheet(
    frames.map((buf, i) => ({ buf, label: `${i}`, scale: 3 })),
    { cols: 2 },
  ),
  out('arena_frames.png'),
);
fs.writeFileSync(
  out('arena_bout.gif'),
  P.gif(frames, { delay: [300, 300, 220, 300, 300, 220], scale: 3 }),
);
P.save(frames[2], out('px/arena_pit.png'));
P.save(pit(0), out('px/arena_empty.png'));
FIGHTERS.forEach((f, i) => P.save(outlined(fighter(f, 'idle')), out(`px/fighter_${i}_idle.png`)));
FIGHTERS.forEach((f, i) =>
  P.save(outlined(fighter(f, 'attack')), out(`px/fighter_${i}_attack.png`)),
);
