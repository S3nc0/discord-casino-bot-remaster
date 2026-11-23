import type { CSSProperties } from 'react';
import { BANK_ART, BANK_COIN_PATH } from '../art/bank.ts';
import { artBox, PixelScene, usePlayback, useStill } from '../PixelScene.tsx';
import { SpinCoin } from '../sprites.tsx';

const WHEEL = [0, 1, 2, -1, 0, 1, 2, -1, 0, 1, 2, -1];

/**
 * Teiai Bank hall. Each time `paid` goes up (a repayment went through) the vault wheel turns and
 * two coins hop from the counter into the vault.
 */
export function BankScene({ paid }: { paid: number }) {
  const frame = usePlayback(WHEEL, 70, paid);
  const still = useStill();
  const [fx, fy] = BANK_COIN_PATH.from;
  const [tx, ty] = BANK_COIN_PATH.to;
  return (
    <PixelScene
      art={BANK_ART}
      name="bank"
      frame={frame}
      overlay={
        paid > 0 && !still ? (
          <span key={paid} className="fx-hops">
            {[0, 1].map((k) => (
              <span
                key={k}
                className="fx-hop"
                style={
                  {
                    ...artBox(fx, fy),
                    '--fx-dx': tx - fx,
                    '--fx-dy': ty - fy,
                    animationDelay: `${k * 160}ms`,
                  } as CSSProperties
                }
              >
                <SpinCoin size={3} />
              </span>
            ))}
          </span>
        ) : null
      }
    />
  );
}
