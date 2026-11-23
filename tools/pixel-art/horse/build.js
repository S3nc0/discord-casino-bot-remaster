import { pathToFileURL } from 'node:url';
// Stage 1 preview: step sheet, gallop gif, eight coats, the 16 by 16 icon. Writes into ART_OUT.
import fs from 'node:fs';
import { P, OUT, out } from '../lib/env.js';
import { geometry, cut, paint, addEye, finish, parts } from './render.js';
import { onBg, NAVY, CREAM, paste } from '../lib/show.js';
import { COAT_OF } from '../lib/palette.js';
import { horseHead } from './icon.js';
import { cells as plateCells } from './cells.js';

fs.mkdirSync(OUT, { recursive: true });
const W = 46,
  H = 30;
const geo = geometry(W, H);
const cutFrames = parts.map((f) => cut(f, W, H, geo));

function frame(i, coat, silks) {
  const b = paint(cutFrames[i], W, H, coat, silks);
  addEye(b, cutFrames[i], W, H, coat);
  return finish(b, coat);
}
export { frame };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // ---- step sheet (one frame through every step) ----
  const k = 3; // plate frame 6
  const refCell = plateCells[parts[k].id - 1];
  const f = parts[k];
  const mask = new P.Buf(f.w, f.h),
    tint = new P.Buf(f.w, f.h);
  const T = {
    1: [200, 90, 60],
    2: [150, 80, 200],
    3: [240, 220, 60],
    4: [60, 200, 120],
    5: [120, 120, 130],
    6: [60, 160, 220],
    7: [90, 90, 100],
    8: [250, 250, 250],
    9: [20, 80, 160],
  };
  for (let i = 0; i < f.w * f.h; i++)
    if (f.lab[i]) {
      mask.px[i] = P.rgb(30, 30, 40);
      const c = T[f.lab[i]];
      tint.px[i] = P.rgb(c[0], c[1], c[2]);
    }
  const px = frame(k, 'kage', 'red');
  const fit = (b, h) => P.resize(b, Math.round((b.w * h) / b.h), h);
  const steps = [
    { buf: fit(refCell, 150), label: '1 reference (public domain)', scale: 1 },
    { buf: fit(mask, 150), label: '2 background removed', scale: 1 },
    { buf: fit(tint, 150), label: '3 parts: rider body mane tail points', scale: 1 },
    { buf: px, label: '4 pixels 48x32 lit top left', scale: 5 },
  ];
  P.save(P.sheet(steps, { cols: 4, scale: 1, gap: 8 }), out('horse_steps.png'));

  // ---- gallop: 8 frames ----
  const bay = Array.from({ length: 8 }, (_, i) => frame(i, 'kage', 'red'));
  P.save(
    P.sheet(
      bay.map((b, i) => ({
        buf: onBg(b, NAVY, 1, 2),
        label: 'frame ' + (i + 1) + ' (plate ' + parts[i].id + ')',
        scale: 4,
      })),
      { cols: 4, scale: 4 },
    ),
    out('horse_gallop_frames.png'),
  );
  const gifFrames = bay.map((b) => onBg(b, NAVY, 1, 4));
  fs.writeFileSync(out('horse_gallop.gif'), P.gif(gifFrames, { delay: 70, scale: 8 }));
  const gifCream = bay.map((b) => onBg(b, CREAM, 1, 4));
  fs.writeFileSync(out('horse_gallop_cream.gif'), P.gif(gifCream, { delay: 70, scale: 8 }));
  // loop seam: last next to first
  P.save(
    P.sheet(
      [
        { buf: onBg(bay[7], NAVY, 1, 2), label: 'last (8)', scale: 5 },
        { buf: onBg(bay[0], NAVY, 1, 2), label: 'first (1)', scale: 5 },
      ],
      { cols: 2, scale: 5 },
    ),
    out('horse_loop_seam.png'),
  );

  // ---- eight coats ----
  const COATS = ['栗毛', '鹿毛', '黒鹿毛', '青毛', '芦毛', '白毛', '栃栗毛', '月毛'];
  const SILKS = ['red', 'blue', 'yellow', 'green', 'orange', 'violet', 'white', 'black'];
  const NAMES = [
    'kurige chestnut',
    'kage bay',
    'kurokage dark bay',
    'aoge black',
    'ashige grey',
    'shirage white',
    'tochiguri liver',
    'tsukige palomino',
  ];
  const coatItems = COATS.map((c, i) => ({
    buf: onBg(frame(3, COAT_OF[c], SILKS[i]), NAVY, 1, 2),
    label: NAMES[i],
    scale: 5,
  }));
  const coatItemsC = COATS.map((c, i) => ({
    buf: onBg(frame(3, COAT_OF[c], SILKS[i]), CREAM, 1, 2),
    label: NAMES[i],
    scale: 5,
  }));
  P.save(P.sheet(coatItems, { cols: 4, scale: 5 }), out('horse_coats_navy.png'));
  P.save(P.sheet(coatItemsC, { cols: 4, scale: 5 }), out('horse_coats_cream.png'));
  // one race: eight lanes at 1x and 3x, as the lanes would look
  const lane = new P.Buf(48 * 4 + 8, 32 * 2 + 8);
  lane.px.fill(P.col(NAVY));
  COATS.forEach((c, i) =>
    paste(lane, frame((i * 3) % 8, COAT_OF[c], SILKS[i]), 4 + (i % 4) * 48, 4 + ((i / 4) | 0) * 32),
  );
  P.save(
    P.sheet(
      [
        { buf: lane, label: 'eight horses at 1x', scale: 1 },
        { buf: lane, label: 'same at 3x', scale: 3 },
      ],
      { cols: 1, scale: 1 },
    ),
    out('horse_race_8.png'),
  );

  // ---- the same horse at 36x24 (the current lane size) next to 48x32 ----
  {
    const g2 = geometry(34, 22),
      c2 = parts.map((f) => cut(f, 34, 22, g2));
    const small = (i) => {
      const b = P.cleanup(paint(c2[i], 34, 22, 'kage', 'red'), { tol: 20, keepLone: true });
      addEye(b, c2[i], 34, 22, 'kage');
      return finish(b, 'kage');
    };
    P.save(
      P.sheet(
        [
          { buf: onBg(small(3), NAVY, 1, 2), label: '36x24 (lane size today)', scale: 6 },
          { buf: onBg(bay[3], NAVY, 1, 2), label: '48x32', scale: 6 },
          { buf: onBg(small(3), CREAM, 1, 2), label: '36x24 cream', scale: 6 },
          { buf: onBg(bay[3], CREAM, 1, 2), label: '48x32 cream', scale: 6 },
        ],
        { cols: 2, scale: 6 },
      ),
      out('horse_size_compare.png'),
    );
  }

  // ---- 16 by 16 icon ----
  const icons = ['kurige', 'kage', 'ashige', 'aoge'].map((c) => horseHead(c));
  P.save(
    P.sheet(
      icons.flatMap((b, i) => [
        { buf: onBg(b, NAVY, 1, 0), label: 'navy ' + i, scale: 8 },
        { buf: onBg(b, CREAM, 1, 0), label: 'cream ' + i, scale: 8 },
      ]),
      { cols: 4, scale: 8 },
    ),
    out('horse_icon16.png'),
  );

  // ---- checks ----
  const stats = bay.map((b, i) => ({
    i: i + 1,
    edge: P.edgeCheck(b),
    colors: P.colorCount(b).length,
  }));
  console.log(
    JSON.stringify(
      stats.map((s) => ({
        f: s.i,
        nubs: s.edge.nubs.length,
        strips: s.edge.strips.length,
        holes: s.edge.holes.length,
        colors: s.colors,
      })),
    ),
  );
}
