import { useT } from '../../shell/i18n.ts';
import type { ChinchiroRollView } from '@casino/shared';
import { useTumble } from './anim.ts';
import { PixelScene, Pixels } from './art/PixelArt.tsx';
import {
  DEALER_SEAT_ART,
  DICE_SHADOWS,
  DICE_SPOTS,
  SEAT_ART,
  SEAT_SIZE,
} from './art/chinchiro-art.ts';
import { Die } from './Die.tsx';

/** How high a tumbling die is above its spot, by die and frame. */
const lift = (i: number, face: number) => 3 + ((face + i * 2) % 3);

export function handLabel(
  t: (key: string, params?: Record<string, string | number>) => string,
  roll: ChinchiroRollView,
): string {
  return t(`screen.casino.chinchiro.hand.${roll.hand.kind}`, { value: roll.hand.value });
}

export interface DiceRowProps {
  /** The roll to show; null = three blank dice. */
  roll: ChinchiroRollView | null;
  /** Changes with every throw so the same dice tumble again. */
  rollKey: string;
  caption?: string;
  /** The dealer's bowl, on the lacquer tray with the bank. */
  dealer?: boolean;
}

/** Three dice that tumble in steps and then show the hand. */
export function DiceRow({ roll, rollKey, caption, dealer = false }: DiceRowProps) {
  const t = useT();
  const { faces, rolling } = useTumble(roll ? roll.dice : null, rollKey);
  const who = dealer ? 'dealer' : 'player';
  const spots = DICE_SPOTS[who];
  const shadows = DICE_SHADOWS[who][rolling ? 'air' : 'rest'];
  return (
    <div className="cc-dice" data-rolling={rolling ? 'true' : 'false'} data-dealer={dealer}>
      <div className="cc-dice__row">
        <PixelScene w={SEAT_SIZE.w} h={SEAT_SIZE.h} className="cc-bowl">
          <Pixels sprite={dealer ? DEALER_SEAT_ART : SEAT_ART} />
          {(faces.length === 3 ? faces : [0, 0, 0]).map((face, i) => {
            const [x, y] = spots[i] ?? [0, 0];
            const shadow = shadows[i];
            return (
              <g key={i}>
                {shadow ? <Pixels sprite={shadow} /> : null}
                <Die face={face} rolling={rolling} x={x} y={rolling ? y - lift(i, face) : y} />
              </g>
            );
          })}
        </PixelScene>
      </div>
      <p className="cc-dice__hand" aria-live="polite">
        {caption ? <span className="cc-dice__caption">{caption} </span> : null}
        {roll && !rolling ? handLabel(t, roll) : roll ? t('screen.casino.chinchiro.rolling') : ''}
      </p>
    </div>
  );
}
