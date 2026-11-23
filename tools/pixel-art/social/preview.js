// Previews for review: every scene on navy and on cream, the sprite sheets at 4x and the
// animations as GIFs. Writes into $ART_OUT (never the repository):
//   ART_OUT=/some/folder node tools/pixel-art/social/preview.js
import fs from 'node:fs';
import path from 'node:path';
import { P, OUT } from '../lib/env.js';
import { onBg, NAVY, CREAM } from '../lib/show.js';
import { clone } from './kit.js';
import * as quiz from './quiz.js';
import * as lottery from './lottery.js';
import * as poll from './poll.js';
import * as missions from './missions.js';
import * as ranking from './ranking.js';
import * as relics from './relics.js';
import * as transfer from './transfer.js';
import * as daily from './daily.js';
import * as history from './history.js';
import * as profile from './profile.js';
import * as fx from './fx.js';

const sheets = path.join(OUT, 'sheets'),
  anim = path.join(OUT, 'anim');
fs.mkdirSync(sheets, { recursive: true });
fs.mkdirSync(anim, { recursive: true });

/** Sprites of one screen, packed on a clear sheet and scaled 4x, plus a labelled look sheet. */
function sheet(name, sprites) {
  const items = Object.entries(sprites).flatMap(([label, list]) =>
    (Array.isArray(list) ? list : [list]).map((buf, i) => ({
      buf,
      label: `${label}${Array.isArray(list) && list.length > 1 ? ' ' + i : ''}`.toUpperCase(),
      scale: 4,
    })),
  );
  P.save(
    P.sheet(items, { cols: items.length > 3 ? 3 : items.length }),
    path.join(sheets, `${name}_sheet_4x.png`),
  );
}
/** Animation on navy and on cream side by side, 2x, as a GIF. */
function gif(name, frames, delay) {
  const both = frames.map((f) => {
    const a = onBg(f, NAVY, 2, 4),
      b = onBg(f, CREAM, 2, 4);
    const o = new P.Buf(a.w, a.h + b.h);
    o.px.set(a.px, 0);
    o.px.set(b.px, a.px.length);
    return o;
  });
  fs.writeFileSync(path.join(anim, `${name}.gif`), P.gif(both, { delay }));
}

const q = quiz.quizScene();
const qf = [0, 1].map((g) => quiz.bulbs(clone(q.buf), q, g));
sheet('quiz', {
  stage: qf[0],
  host: quiz.host(),
  podium: quiz.podium(),
  buzzer: [quiz.buzzer('red'), quiz.buzzer('sky')],
  right: fx.right(),
  wrong: fx.wrong(),
});
gif('quiz_bulbs', qf, 400);
gif('quiz_right', fx.right(), [90, 90, 90, 900]);
gif('quiz_wrong', fx.wrong(), [90, 70, 70, 900]);

const lf = lottery.preview(6);
sheet('lottery', {
  counter: lf[0],
  ticket: lottery.ticket(),
  drawn: lottery.bigBall(7, 'red'),
  balls: ['red', 'sky', 'gold', 'green', 'violet', 'orange'].map(lottery.ball),
});
gif('lottery_tumble', lf, 120);

const pf = poll.preview(8);
sheet('poll', { hall: pf[0], ballot: poll.ballot() });
gif('poll_ballot', pf, 140);

sheet('missions', {
  board: missions.missionsBase(),
  pins: ['red', 'sky', 'green', 'gold'].map((h) => missions.pin(h)),
  stamp: missions.stamp(),
});

const rf = ranking.preview(8);
sheet('ranking', {
  podium: rf[0],
  trophy: ranking.trophy(),
  medals: [ranking.medal('gold', 1), ranking.medal('silver', 2), ranking.medal('bronze', 3)],
});
gif('ranking_shine', rf, 110);

{
  const mf = relics.preview(2);
  sheet('relics', { hall: mf[0], empty: relics.museumBase() });
  gif('relics_twinkle', mf, 500);
}

const tf = transfer.preview(8);
sheet('transfer', { street: tf[0], envelope: transfer.envelope(), coin: transfer.coin() });
gif('transfer_send', tf, 110);

const df = daily.preview();
sheet('daily', { room: df[0], gift: [0, 1, 2, 3, 4, 5].map(daily.gift), stamp: daily.dayStamp() });
gif('daily_gift', df, [500, 90, 90, 120, 260, 260]);

sheet('history', { ledger: history.historyScene() });
sheet('profile', { card: profile.profileCard() });
console.log('previews in', OUT);
