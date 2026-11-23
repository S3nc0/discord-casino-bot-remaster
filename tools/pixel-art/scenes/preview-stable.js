// Preview of the stall and paddock with portraits (not shipped): both themes, 2x and 4x.
import { P, out } from '../lib/env.js';
import { stall, paddock, STALL_HEAD, PADDOCK_HEADS } from './stable.js';
import { portrait, withOutline, colour } from './portrait.js';
import { paste, flipX } from './kit.js';

const head = withOutline(portrait());
// the neck goes dark where it meets the shadow of the stall
function compose(scene, heads) {
  const b = new P.Buf(scene.back.w, scene.back.h);
  b.px.set(scene.back.px);
  for (const h of heads) paste(b, h.flip ? flipX(h.buf) : h.buf, h.x, h.y);
  paste(b, scene.front, 0, 0);
  return b;
}
const items = [];
const shots = {};
for (const th of ['light', 'dark']) {
  const s = stall(th),
    pd = paddock(th);
  const st = compose(s, [{ buf: colour(head, 'kage', 'blue'), ...STALL_HEAD }]);
  const pk = compose(pd, [
    { buf: colour(head, 'kage', 'blue'), ...PADDOCK_HEADS.left },
    { buf: colour(head, 'ashige', 'green'), ...PADDOCK_HEADS.right },
  ]);
  items.push(
    { buf: st, label: `stall ${th}`, scale: 4 },
    { buf: pk, label: `paddock ${th}`, scale: 4 },
  );
  P.save(st, out(`px/stall_${th}.png`));
  P.save(pk, out(`px/paddock_${th}.png`));
  P.save(
    compose(s, [{ buf: colour(head, 'ashige', 'green'), ...STALL_HEAD }]),
    out(`px/stall2_${th}.png`),
  );
  shots[th] = { st, pk };
}
P.save(P.sheet(items, { cols: 2 }), out('stable_sheet.png'));
