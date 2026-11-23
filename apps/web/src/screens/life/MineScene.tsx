import { useEffect, useState } from 'react';
import { isReducedMotionActive, PixelScene, SceneLayer, useTheme } from '@casino/ui';
import { FIND_ART, MINE, MINER, MINER_SPOT } from './mine-art.ts';

/*
 * The mine behind the Dig button: a miner at the rock face who swings the pick once for every dig
 * (raise, down swing, strike with chips flying, back). Under reduced motion the miner stays still.
 * Decorative: the result of a dig is in the text.
 */
const SWING: ReadonlyArray<readonly [frame: number, at: number]> = [
  [1, 0],
  [2, 200],
  [3, 290],
  [0, 650],
];

export function MineScene({ swings }: { swings: number }) {
  const { reducedMotion } = useTheme();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (swings === 0 || reducedMotion || isReducedMotionActive()) return undefined;
    const ids = SWING.map(([f, at]) => setTimeout(() => setFrame(f), at));
    return () => ids.forEach(clearTimeout);
  }, [swings, reducedMotion]);
  return (
    <div className="life-mine">
      <PixelScene art={MINE} frame={frame === 3 ? 1 : 0} scale={2}>
        <SceneLayer art={MINER} frame={frame} x={MINER_SPOT.x} y={MINER_SPOT.y} />
      </PixelScene>
    </div>
  );
}

/** A dug-up ore or relic, 16 by 16 art pixels at 2 CSS px each; nothing for an unknown id. */
export function FindSprite({ id }: { id: string }) {
  const art = (FIND_ART as Readonly<Record<string, (typeof FIND_ART)['coal']>>)[id];
  return art ? <PixelScene art={art} scale={2} className="life-find" /> : null;
}
