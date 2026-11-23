// Preview of one or more scenes, day and night, on the page colours (cream and navy):
//   ART_OUT=/some/folder node tools/pixel-art/finance/preview.js bank stocks
import { P, both } from './lib.js';
import { onBg, NAVY, CREAM } from '../lib/show.js';
import { out } from '../lib/env.js';
import { SCENES } from './scenes.js';

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
for (const name of names) {
  const { W, H, draw } = SCENES[name];
  const { day, night } = both(W, H, draw);
  const holes = day.tk.filter((t) => !t).length;
  if (holes) console.warn(name, 'has', holes, 'empty pixels');
  const d = day.toBuf(),
    n = night.toBuf();
  const items = [
    { buf: onBg(d, CREAM, 4, 2), label: `${name} day 4x` },
    { buf: onBg(n, NAVY, 4, 2), label: `${name} night 4x` },
    { buf: onBg(d, CREAM, 1, 4), label: '1x' },
    { buf: onBg(n, NAVY, 1, 4), label: '1x' },
  ];
  P.save(P.sheet(items, { cols: 2, gap: 6 }), out(`scene-${name}.png`));
  P.save(onBg(n, NAVY, 6, 0), out(`zoom-${name}-night.png`));
  P.save(onBg(d, CREAM, 6, 0), out(`zoom-${name}-day.png`));
  const cc = P.colorCount(n).length,
    cd = P.colorCount(d).length;
  console.log(name, `${W}x${H}`, 'colours day', cd, 'night', cc);
}
