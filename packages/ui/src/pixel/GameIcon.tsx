import type { SVGProps } from 'react';
import { cx } from '../utils.ts';
import { GAME_ICON_ROWS, type GameIconName } from './art.ts';
import { rowsToPaths } from './paths.ts';

export interface GameIconProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> {
  name: GameIconName;
  /** Accessible name. Leave out when a visible label sits next to the icon (decorative). */
  label?: string;
  /** Coin only in practice: bob up and down in two steps. Off under reduced motion. */
  bob?: boolean;
}

const PATHS: Partial<Record<GameIconName, Array<[string, string]>>> = {};

function pathsFor(name: GameIconName): Array<[string, string]> {
  return (PATHS[name] ??= rowsToPaths(GAME_ICON_ROWS[name]));
}

/** 16 by 16 pixel art game icon, 48px by default (3px per art pixel). */
export function GameIcon({ name, label, bob, className, ...props }: GameIconProps) {
  return (
    <svg
      className={cx('bb-px', bob && 'bb-px--bob', className)}
      viewBox="0 0 16 16"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      {...props}
    >
      {pathsFor(name).map(([key, d]) => (
        <path key={key} className={`bb-px-${key}`} d={d} />
      ))}
    </svg>
  );
}
