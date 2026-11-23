// Animation previews (GIF, 3x) and their frame sheets:
//   ART_OUT=/some/folder node tools/pixel-art/finance/anim.js
// Shipped motion is CSS on small overlay layers; these show the timing and the look.
import { P, Scene } from './lib.js';
import { out } from '../lib/env.js';
import * as bank from './bank.js';
import * as loans from './loans.js';
import * as kyosai from './kyosai.js';
import * as stocks from './stocks.js';
import * as crypto from './crypto.js';
import * as companies from './companies.js';
import { spinFrames, gavelFrames } from './sprites.js';
import { R } from './props.js';

const theme = process.env.ART_THEME || 'night';
const scene = (mod, fn, opt) => {
  const S = new Scene(mod.W, mod.H, theme);
  fn(S, opt);
  return S;
};
const save = (name, frames, delay) => {
  P.save(
    P.sheet(
      frames.map((b, i) => ({ buf: b, label: String(i) })),
      { cols: 4, scale: 2, gap: 4 },
    ),
    out(`anim-${name}-frames.png`),
  );
  require_fs().writeFileSync(out(`anim-${name}-${theme}.gif`), P.gif(frames, { delay, scale: 3 }));
};
import fs from 'node:fs';
const require_fs = () => fs;
const paste = (dst, b, x0, y0) => {
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const p = b.px[y * b.w + x];
      if (p >>> 24 && x0 + x >= 0 && x0 + x < dst.w && y0 + y >= 0 && y0 + y < dst.h)
        dst.px[(y0 + y) * dst.w + x0 + x] = p;
    }
};

// stocks: the ticker scrolls one art pixel per frame, the last candle flashes on a new price
{
  const text = [
    ['CS 1033.85', '+8.14', true],
    ['TEIO 1315.48', '+4.93', true],
    ['NUMA 423.85', '-1.20', false],
    ['GOLD 2038.66', '+0.76', true],
  ];
  const strip = new Scene(400, 5, theme);
  let x = 0;
  for (const [a, ch, up] of text) {
    strip.text(x, 0, a, 'amber-70');
    x += a.length * 4 + 2;
    strip.text(x, 0, ch, up ? 'green-70' : 'red-70');
    x += ch.length * 4 + 10;
  }
  const period = x;
  const frames = [];
  for (let f = 0; f < 24; f++) {
    const S = scene(stocks, stocks.stocks, { tickerText: false });
    for (let i = 2; i < 126; i++) {
      const sx = (i + f * 2) % period;
      for (let j = 0; j < 5; j++) {
        const t = strip.get(sx, j);
        if (t) S.set(i, 3 + j, t);
      }
    }
    // last candle on the left wall screen flashes white then settles
    if (f % 12 < 2) S.frame(34, 16, 5, 12, 'paper-99');
    frames.push(S.toBuf());
  }
  save('stocks', frames, 80);
}

// crypto: rack lights blink in four phases
{
  const frames = [];
  for (let f = 0; f < 8; f++) {
    const S = scene(crypto, crypto.crypto);
    for (const [lx, ly, , ph] of crypto.LIGHTS)
      if ((f + ph) % 4 === 0 || (f * 3 + ph * 5) % 7 === 0) S.set(lx, ly, 'neutral-17');
    frames.push(S.toBuf());
  }
  save('crypto', frames, 160);
}

// kyosai: rain falls past the window, two pixels a frame
{
  const frames = [];
  for (let f = 0; f < 9; f++) frames.push(scene(kyosai, kyosai.kyosai, { t: f }).toBuf());
  save('kyosai', frames, 90);
}

// bank: repay turns the vault wheel a sixth and two coins hop from the counter to the vault
{
  const frames = [];
  const spin = spinFrames();
  for (let f = 0; f < 12; f++) {
    const a = P.ease ? Math.min(1, f / 8) : f / 8;
    const S = scene(bank, bank.bank, { wheel: (Math.PI / 3) * (1 - (1 - a) ** 2) });
    const b = S.toBuf();
    for (const [k, start] of [
      [0, 0],
      [1, 2],
    ]) {
      const t = (f - start) / 7;
      if (t < 0 || t > 1) continue;
      const x = 22 + (100 - 22) * t,
        y = 26 - Math.sin(t * Math.PI) * 18;
      paste(b, spin[(f + k) % 4], Math.round(x - 4), Math.round(y - 4));
    }
    frames.push(b);
  }
  save('bank', frames, 90);
}

// loans: the stamp lifts, presses the contract and leaves the seal
{
  const seq = [1, 1, 2, 3, 3, 4, 0, 0];
  save(
    'loans',
    seq.map((s) => scene(loans, loans.loans, { stamp: s }).toBuf()),
    140,
  );
}

// companies: dividend coins fall from a roof badge, spinning, and land on the street
{
  const spin = spinFrames();
  const frames = [];
  for (let f = 0; f < 12; f++) {
    const b = scene(companies, companies.companies).toBuf();
    const [px, py] = companies.PLATES[2];
    for (let k = 0; k < 3; k++) {
      const t = ((f + k * 4) % 12) / 11;
      const x = px + 2 + (k - 1) * 9,
        y = py + 12 + t * t * (40 - py - 12);
      paste(b, spin[(f + k) % 4], Math.round(x), Math.round(y));
    }
    frames.push(b);
  }
  save('companies', frames, 90);
}

// market: the gavel strikes and the outbid row flashes red twice
{
  const [up, hit] = gavelFrames();
  const r = R(new Scene(1, 1, theme));
  const frames = [];
  for (let f = 0; f < 8; f++) {
    const S = new Scene(64, 24, theme);
    S.rect(0, 0, 64, 24, theme === 'night' ? 'neutral-10' : 'paper-96');
    const flash = f === 2 || f === 4;
    S.frame(1, 1, 62, 22, flash ? 'red-60' : theme === 'night' ? 'neutral-30' : 'neutral-80');
    if (flash) S.frame(2, 2, 60, 20, 'red-40');
    S.text(22, 6, 'OUTBID', flash ? 'red-60' : r.paper[1]);
    S.text(22, 13, '6510', r.gold[3]);
    const b = S.toBuf();
    paste(b, f === 1 || f === 2 ? hit : up, 4, 4);
    frames.push(b);
  }
  save('market', frames, 140);
}
console.log('gifs in', out(''));
