// Preview of ores and relics (not shipped): 4x on navy and cream.
import { P, out } from '../lib/env.js';
import { pair } from '../lib/show.js';
import { ORES, RELICS, find } from './finds.js';

const items = [...ORES, ...RELICS].map((id) => ({
  buf: pair(find(id), 4, 1),
  label: id.replace('relic_', ''),
  scale: 1,
}));
P.save(P.sheet(items, { cols: 6 }), out('finds_sheet.png'));
[...ORES, ...RELICS].forEach((id) => P.save(find(id), out(`px/find_${id}.png`)));
