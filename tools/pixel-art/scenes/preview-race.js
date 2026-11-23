// Preview of the race scene pieces (not shipped): sheet at 4x, both themes, and the dust gif.
import fs from 'node:fs';
import { P, out } from '../lib/env.js';
import { stand, lane, laneDark, innerRail, gate, dust } from './race.js';
import { themed, decode } from './kit.js';

const arts = {
  stand: themed(stand),
  lane: themed(lane),
  laneDark: themed(laneDark),
  rail: themed(innerRail),
  gate: themed(gate),
  dust: themed(dust),
};
for (const [k, a] of Object.entries(arts))
  console.log(k, a.w, a.h, Object.keys(a.legend).length, 'colours');
const items = [];
for (const th of ['light', 'dark']) {
  items.push({ buf: decode(arts.stand, th), label: `stand ${th}`, scale: 2 });
}
for (const th of ['light', 'dark']) {
  items.push({ buf: decode(arts.lane, th), label: `lane ${th}`, scale: 4 });
  items.push({ buf: decode(arts.gate, th), label: `gate ${th}`, scale: 4 });
  for (let f = 0; f < 4; f++)
    items.push({ buf: decode(arts.dust, th, f), label: `dust ${f}`, scale: 4 });
}
P.save(P.sheet(items, { cols: 6 }), out('race_sheet.png'));
for (const [k, a] of Object.entries(arts))
  for (const th of ['light', 'dark'])
    for (let f = 0; f < a.frames.length; f++)
      P.save(decode(a, th, f), out(`px/race_${k}_${th}_${f}.png`));
fs.writeFileSync(out('px/race.json'), JSON.stringify(arts));
