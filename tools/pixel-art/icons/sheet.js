import { P, out } from '../lib/env.js';
import { make, REG } from './kit.js';
import { onBg, NAVY, CREAM } from '../lib/show.js';
import './games.js';
import './more.js';
import './life.js';
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(REG);
const items = [];
for (const n of names) {
  const { buf } = make(n);
  items.push({ buf: onBg(buf, NAVY, 1, 1), label: n, scale: 9 });
  items.push({ buf: onBg(buf, CREAM, 1, 1), label: n + ' c', scale: 9 });
}
P.save(P.sheet(items, { cols: 6, scale: 9 }), out('try_icons.png'));
