import { P } from '../lib/env.js';
import { Hi, selectiveOutline } from '../lib/hi.js';
import { horseHead } from '../horse/icon.js';
import { mat, tok } from '../lib/palette.js';

const REG = {};
/** Register an icon: `draw(hi, part)` fills a 16x16 Hi; it returns optional pixel fixes `(buf, owner) => void`. */
function icon(name, draw) {
  REG[name] = draw;
}
const colour = (c) => [c];

function make(name, opt = {}) {
  if (name === 'horse') return { buf: horseHead('kurige') };
  const hi = new Hi(16, 16);
  const part = (m, o) => hi.part(typeof m === 'string' ? mat(m) : m, o);
  const fix = REG[name](hi, part, { P, mat, tok, colour });
  const { buf, owner } = hi.render({ cover: opt.cover ?? 0.5 });
  if (fix) fix(buf, owner);
  return { buf: selectiveOutline(buf, owner, hi.parts), hi, owner };
}
const px = (buf, x, y, c) => {
  buf.px[y * buf.w + x] = P.col(c);
};
export { REG, icon, make, colour, px };
