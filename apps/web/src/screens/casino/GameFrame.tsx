import type { ReactNode } from 'react';
import { Surface } from '@casino/ui';
import type { ScreenId } from '@casino/shared';
import { screenName, useLocale } from '../../shell/i18n.ts';
import { Jackpot } from './RecentRounds.tsx';
import './games.css';

export interface GameFrameProps {
  screen: ScreenId;
  /** Jackpot pool to show next to the title; omit to hide it. */
  jackpot?: number | null;
  children: ReactNode;
}

/** Title row and the shared page rhythm of every casino screen. */
export function GameFrame({ screen, jackpot, children }: GameFrameProps) {
  const locale = useLocale();
  const name = screenName(locale, screen);
  return (
    <Surface label={name}>
      <div className="cc-screen" data-screen={screen}>
        <header className="cc-head">
          <h1 className="cc-head__title">{name}</h1>
          {jackpot === undefined ? null : <Jackpot pool={jackpot} />}
        </header>
        {children}
      </div>
    </Surface>
  );
}
