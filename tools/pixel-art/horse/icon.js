import { pathToFileURL } from 'node:url';
// The 16 by 16 horse icon: a head and neck bust. The outline follows the proportions of the head in
// the reference (plate frame 12) because that head is only 100 px tall there; the lighting, mane
// and eye are the same pipeline as the race sprite.
import { P, out } from '../lib/env.js';
import { Hi, selectiveOutline } from '../lib/hi.js';
import { ramp, COATS, tok } from '../lib/palette.js';

function horseHead(coatKey) {
  const coat = COATS[coatKey];
  const body = ramp(coat.body),
    mane = ramp(coat.mane);
  const hi = new Hi(16, 16);
  const B = hi.part(body.slice(1), { round: 2.2, flat: 0.5 });
  const M = hi.part(coat.points ? ramp(coat.mane) : mane.slice(1), { round: 1.0 });
  // neck, head, ear, in one silhouette
  hi.poly(B, [
    [3.0, 15],
    [3.4, 9.5],
    [4.6, 5.2],
    [5.8, 1.8],
    [7.2, 4.0],
    [9.4, 4.6],
    [13.4, 8.0],
    [14.6, 9.4],
    [14.2, 11.2],
    [12.2, 11.5],
    [10.2, 10.8],
    [8.6, 12.0],
    [9.2, 15],
  ]);
  // mane along the back of the neck, under the ear
  hi.poly(M, [
    [2.4, 15],
    [2.8, 9.4],
    [4.0, 4.4],
    [5.2, 2.2],
    [6.2, 3.8],
    [6.0, 7.0],
    [5.6, 10.0],
    [5.8, 15],
  ]);
  const { buf, owner } = hi.render({ cover: 0.45 });
  // eye and nostril
  const eye = coat.points || coatKey === 'aoge' ? tok('neutral-70') : tok('neutral-6');
  buf.px[6 * 16 + 9] = P.col(eye);
  owner[6 * 16 + 9] = B;
  buf.px[9 * 16 + 14] = P.col(body[0]);
  owner[9 * 16 + 14] = B;
  return selectiveOutline(buf, owner, hi.parts);
}
export { horseHead };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const items = ['kage', 'kurige', 'ashige', 'aoge'].map((k) => ({
    buf: horseHead(k),
    label: k,
    scale: 10,
  }));
  P.save(P.sheet(items, { cols: 4, scale: 10 }), out('try_head2.png'));
}
