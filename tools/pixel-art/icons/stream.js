import { icon } from './kit.js';

/** Broadcast monitor with rabbit-ear antennas, a screen play mark and a red on-air lamp. */
icon('stream', (hi, part) => {
  const ant = part('steel', { fixed: 2 });
  hi.line(ant, 4.4, 1.2, 7.2, 4.0, 0.9).line(ant, 11.6, 1.2, 8.8, 4.0, 0.9);
  const tip = part('red', { fixed: 3 });
  hi.ellipse(tip, 4.2, 1.2, 0.9, 0.9).ellipse(tip, 11.8, 1.2, 0.9, 0.9);

  const body = part('ink', { bevel: true, steps: [1, 2, 3] });
  hi.rect(body, 1.0, 3.8, 14.0, 9.6);

  const screen = part('sky', { bevel: true, steps: [1, 2, 3] });
  hi.rect(screen, 2.4, 5.2, 11.2, 6.8);

  const play = part('paper', { fixed: 4 });
  hi.poly(play, [
    [6.0, 6.6],
    [10.4, 8.6],
    [6.0, 10.6],
  ]);

  const live = part('red', { fixed: 2 });
  hi.rect(live, 11.4, 5.6, 1.8, 1.8);

  const foot = part('steel', { fixed: 1 });
  hi.rect(foot, 3.0, 13.4, 2.6, 1.6).rect(foot, 10.4, 13.4, 2.6, 1.6);
});
