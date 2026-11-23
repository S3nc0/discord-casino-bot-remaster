// Sprite sheet preview at 4x on navy and cream, plus the GIFs of the moving sprites:
//   ART_OUT=/some/folder node tools/pixel-art/finance/sheet.js
import { P } from './lib.js';
import { pair } from '../lib/show.js';
import { out } from '../lib/env.js';
import {
  COINS,
  gavelFrames,
  spinFrames,
  badgeWithGlyph as badge,
  BADGE_SHAPES,
  BADGE_HUES,
} from './sprites.js';

const items = [];
for (const [k, f] of Object.entries(COINS)) items.push({ buf: pair(f(), 4), label: k });
gavelFrames().forEach((b, i) => items.push({ buf: pair(b, 4), label: `gavel ${i}` }));
spinFrames().forEach((b, i) => items.push({ buf: pair(b, 4), label: `dividend ${i}` }));
BADGE_SHAPES.forEach((s, i) =>
  items.push({
    buf: pair(badge(s, i % 2 ? 'mine' : 'farm', BADGE_HUES[i]), 4),
    label: `badge ${s}`,
  }),
);
items.push({ buf: pair(badge('crest', 'mine', 'violet'), 4), label: 'badge crest mine' });
items.push({ buf: pair(badge('hex', 'farm', 'orange'), 4), label: 'badge hex farm' });
P.save(P.sheet(items, { cols: 4, gap: 6 }), out('sprites-4x.png'));
