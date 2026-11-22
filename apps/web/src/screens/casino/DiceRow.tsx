import { useT } from '../../shell/i18n.ts';
import type { ChinchiroRollView } from '@casino/shared';
import { useTumble } from './anim.ts';
import { Die } from './Die.tsx';

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
}

/** Three dice that tumble in steps and then show the hand. */
export function DiceRow({ roll, rollKey, caption }: DiceRowProps) {
  const t = useT();
  const { faces, rolling } = useTumble(roll ? roll.dice : null, rollKey);
  const shown = faces.length === 3 ? faces : [0, 0, 0];
  return (
    <div className="cc-dice" data-rolling={rolling ? 'true' : 'false'}>
      <div className="cc-dice__row">
        {shown.map((face, i) => (
          <Die key={i} face={face} rolling={rolling} />
        ))}
      </div>
      <p className="cc-dice__hand" aria-live="polite">
        {caption ? <span className="cc-dice__caption">{caption} </span> : null}
        {roll && !rolling ? handLabel(t, roll) : roll ? t('screen.casino.chinchiro.rolling') : ''}
      </p>
    </div>
  );
}
