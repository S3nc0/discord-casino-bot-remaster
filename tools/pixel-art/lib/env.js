import path from 'node:path';

/** Output folder for previews and sheets (never inside the repo tree by default). */
const OUT = process.env.ART_OUT || path.join(process.cwd(), 'art-out');
/** Folder holding the downloaded reference images (see CREDITS.md for what they are). */
const REF = process.env.ART_REF || path.join(OUT, 'ref');
import P from '../vendor/pixel.js';

const out = (f) => path.join(OUT, f);
const ref = (f) => path.join(REF, f);
export { P, OUT, REF, out, ref };
