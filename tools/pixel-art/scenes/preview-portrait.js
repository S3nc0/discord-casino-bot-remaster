// Preview of the horse portrait (not shipped): the reference next to six coats at 4x.
import { P, out, ref } from '../lib/env.js';
import { portrait, withOutline, colour } from './portrait.js';

const photo = P.resize(P.load(ref('head_tb.png')), 176);
const b = withOutline(portrait());
const items = [{ buf: photo, label: 'reference (CC0)', scale: 1 }];
for (const [k, s] of [
  ['kage', 'blue'],
  ['kurige', 'red'],
  ['aoge', 'yellow'],
  ['ashige', 'green'],
  ['tsukige', 'violet'],
  ['shirage', 'black'],
])
  items.push({ buf: colour(b, k, s), label: k, scale: 4 });
P.save(P.sheet(items, { cols: 4 }), out('portrait_steps.png'));
