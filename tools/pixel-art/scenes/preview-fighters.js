// Preview of the arena fighters (not shipped): every fighter, idle and attack, both directions.
import { P, out } from '../lib/env.js';
import { FIGHTERS, fighter, outlined } from './fighters.js';

const items = [];
for (const f of FIGHTERS) {
  for (const pose of ['idle', 'attack'])
    items.push({
      buf: outlined(fighter(f, pose)),
      label: `${f.name.slice(0, 7)} ${pose[0]}`,
      scale: 3,
    });
}
P.save(P.sheet(items, { cols: 8 }), out('fighters_sheet.png'));
const one = FIGHTERS.slice(0, 2).flatMap((f) =>
  [false, true].flatMap((fl) =>
    ['idle', 'attack'].map((pose) => ({
      buf: outlined(fighter(f, pose, fl)),
      label: `${pose} ${fl ? 'L' : 'R'}`,
      scale: 6,
    })),
  ),
);
P.save(P.sheet(one, { cols: 4 }), out('fighters_zoom.png'));
