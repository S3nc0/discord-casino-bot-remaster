// Preview of the mine with the miner's swing (not shipped): frame sheet, gif, 1x pngs.
import fs from 'node:fs';
import { P, out } from '../lib/env.js';
import { mine, MINER_X, MINE_FLOOR } from './mine.js';
import { miner, outlinedMiner, SWING, MH } from './miner.js';
import { paste } from './kit.js';

const frames = SWING.map((pose) => {
  const b = mine(pose === 'strike');
  paste(b, outlinedMiner(miner(pose)), MINER_X, MINE_FLOOR - MH + 2);
  return b;
});
const poses = SWING.map((pose) => ({ buf: outlinedMiner(miner(pose)), label: pose, scale: 5 }));
P.save(
  P.sheet([...frames.map((buf, i) => ({ buf, label: `${i} ${SWING[i]}`, scale: 3 })), ...poses], {
    cols: 4,
  }),
  out('mine_frames.png'),
);
fs.writeFileSync(out('mine_swing.gif'), P.gif(frames, { delay: [260, 200, 90, 360], scale: 3 }));
frames.forEach((b, i) => P.save(b, out(`px/mine_${i}.png`)));
