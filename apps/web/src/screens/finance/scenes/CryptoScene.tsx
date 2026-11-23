import type { CSSProperties } from 'react';
import { CRYPTO_ART, CRYPTO_LIGHTS } from '../art/crypto.ts';
import { FinanceScene } from '../FinanceScene.tsx';

/** The mining room. Rack lights blink out now and then (CSS; still under reduced motion). */
export function CryptoScene({
  flash,
}: {
  flash?: { n: number; tone: 'buy' | 'sell' } | undefined;
}) {
  return (
    <FinanceScene art={CRYPTO_ART} name="crypto" flash={flash}>
      <g className="fx-leds">
        {CRYPTO_LIGHTS.map(([x, y, phase]) => (
          <rect
            key={`${x},${y}`}
            x={x}
            y={y}
            width={1}
            height={1}
            style={{ '--fx-phase': phase } as CSSProperties}
          />
        ))}
      </g>
    </FinanceScene>
  );
}
