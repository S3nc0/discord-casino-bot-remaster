import { rowsToPaths } from '@casino/ui';
import { coatColor, silksColor } from './format.ts';

/*
 * A racehorse in profile with a rider, 18 by 12 art pixels, two gallop frames.
 *   o outline   k coat   m mane and tail   s silks   h cap   w eye
 * Drawn here (not imported art), flat colours from the palette; the coat and the silks come from
 * the horse's own look.
 */
const FRAME_A = [
  '..............oo..',
  '.....hh......ookko',
  '....ssss.....okkwo',
  '...osssso...ookkko',
  'mm.okkkkkkkkkkkoo.',
  'mmmokkkkkkkkkkkoo.',
  '.mmokkkkkkkkkkko..',
  '..ookkkkkkkkkkoo..',
  '..okko....ookko...',
  '.okko......okko...',
  'okko........okko..',
  'oo...........oo...',
] as const;
const FRAME_B = [
  '..............oo..',
  '.....hh......ookko',
  '....ssss.....okkwo',
  '...osssso...ookkko',
  'mm.okkkkkkkkkkkoo.',
  'mmmokkkkkkkkkkkoo.',
  '.mmokkkkkkkkkkko..',
  '..ookkkkkkkkkkoo..',
  '...ookkoookkoo....',
  '....okko..okko....',
  '.....oo....oo.....',
  '..................',
] as const;

const WIDTH = 18;
const pad = (rows: readonly string[]) => rows.map((r) => r.padEnd(WIDTH, '.').slice(0, WIDTH));
const PATHS = [rowsToPaths(pad(FRAME_A)), rowsToPaths(pad(FRAME_B))];

export interface PixelHorseProps {
  coat: string;
  silks: string;
  /** Alternate the two gallop frames. Off when still or under reduced motion. */
  running?: boolean;
  className?: string;
}

export function PixelHorse({ coat, silks, running = false, className }: PixelHorseProps) {
  return (
    <svg
      className={`hr-horse${running ? ' is-running' : ''}${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${WIDTH} 12`}
      aria-hidden="true"
      style={
        { '--hr-coat': coatColor(coat), '--hr-silks': silksColor(silks) } as React.CSSProperties
      }
    >
      {PATHS.map((paths, frame) => (
        <g key={frame} className={`hr-horse__frame hr-horse__frame--${frame === 0 ? 'a' : 'b'}`}>
          {paths.map(([key, d]) => (
            <path key={key} className={`hr-px-${key}`} d={d} />
          ))}
        </g>
      ))}
    </svg>
  );
}
