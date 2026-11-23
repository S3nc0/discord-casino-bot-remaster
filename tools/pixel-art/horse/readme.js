// The small gallop gif for the README: the same eight frames the race uses, on the dark navy of
// the app. Run from the repo root (needs the reference plate, see tools/pixel-art/README.md):
//   node tools/pixel-art/horse/readme.js [outFile]
import fs from 'node:fs';
import path from 'node:path';
import { P } from '../lib/env.js';
import { onBg, NAVY } from '../lib/show.js';
import { frame } from './build.js';

const file = path.resolve(process.argv[2] ?? 'docs/images/readme/horse-gallop.gif');
const frames = Array.from({ length: 8 }, (_, i) => onBg(frame(i, 'kage', 'red'), NAVY, 1, 3));
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, P.gif(frames, { delay: 80, scale: 4 }));
console.log(file, fs.statSync(file).size, 'bytes');
