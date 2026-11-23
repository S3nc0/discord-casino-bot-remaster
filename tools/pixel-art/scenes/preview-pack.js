// Review pack (not shipped): 4x sprite sheets of every new sprite on navy and cream, and gifs of
// the small loops (race dust, torch flames, the miner's swing, the arena bout).
import fs from 'node:fs';
import { P, out } from '../lib/env.js';
import { FIGHTERS, fighter, outlined } from './fighters.js';
import { miner, outlinedMiner, SWING } from './miner.js';
import { find, ORES, RELICS } from './finds.js';
import { dust } from './race.js';
import { pitFrames } from './arena.js';
import { onBg as bgOf, NAVY, CREAM } from '../lib/show.js';
const onBg = (b, bg) => bgOf(b, bg === 'navy' ? NAVY : CREAM, 1, 2);

const both = (buf, label) =>
  ['navy', 'cream'].map((bg) => ({ buf: onBg(buf, bg), label: `${label} ${bg[0]}`, scale: 4 }));
const fighters = FIGHTERS.flatMap((f, i) =>
  ['idle', 'attack'].map((pose) => ({
    buf: outlined(fighter(f, pose)),
    label: `${i} ${pose}`,
    scale: 4,
  })),
);
P.save(P.sheet(fighters, { cols: 8 }), out('sheet_fighters_4x.png'));
P.save(
  P.sheet(
    SWING.flatMap((s) => both(outlinedMiner(miner(s)), s)),
    { cols: 4 },
  ),
  out('sheet_miner_4x.png'),
);
P.save(
  P.sheet(
    [...ORES, ...RELICS].flatMap((id) => both(find(id), id.replace('relic_', ''))),
    { cols: 8 },
  ),
  out('sheet_finds_4x.png'),
);
for (const th of ['light', 'dark'])
  fs.writeFileSync(
    out(`dust_${th}.gif`),
    P.gif(
      dust(th).map((b) => onBg(b, th === 'dark' ? 'navy' : 'cream')),
      { delay: 90, scale: 6 },
    ),
  );
fs.writeFileSync(
  out('torch.gif'),
  P.gif(
    pitFrames().map((b) => P.crop(b, 70, 0, 40, 36)),
    { delay: 140, scale: 6 },
  ),
);
