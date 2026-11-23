import { SLOT_SYMBOLS } from '@casino/shared';
import { useCycle, useReveal } from './anim.ts';
import { CasinoScene, Pixels } from './art/PixelArt.tsx';
import {
  BLUR_ART,
  CABINET_ART,
  FLASH_ART,
  LEVER_ART,
  LIGHTS_ART,
  PAYLINE_ART,
  PAYLINE_WIN_ART,
  REEL_ART,
  REEL_BOX,
  REEL_FLASH_ART,
  SLOTS_SIZE,
} from './art/slots-art.ts';
import { WinBurst } from './art/WinBurst.tsx';
import { STEP_MS } from './anim.ts';

/** What the reels show before the first spin. */
const IDLE = ['🍒', '🔔', '7️⃣'] as const;
/** The lever stays pulled for this many steps after a spin starts. */
const LEVER_STEPS = 3;
/** The cabinet blinks this many times in a win, then stays lit. */
const FLASH_STEPS = 6;
const FLASH_MS = 160;

interface ReelProps {
  final: string | null;
  stopped: boolean;
  index: number;
  flash: boolean;
}

function Reel({ final, stopped, index, flash }: ReelProps) {
  const spinning = final !== null && !stopped;
  const cycle = useCycle(SLOT_SYMBOLS.length, spinning);
  const symbol = final === null ? '❔' : stopped ? final : (SLOT_SYMBOLS[cycle] ?? '❔');
  const x = REEL_BOX.xs[index] ?? 0;
  const art = spinning
    ? BLUR_ART[(cycle + index) % BLUR_ART.length]
    : REEL_ART[final ?? IDLE[index] ?? '7️⃣'];
  return (
    <g className="cc-reel" data-spinning={spinning} data-index={index}>
      <desc className="cc-reel__symbol">{symbol}</desc>
      {art ? <Pixels sprite={art} x={x} y={REEL_BOX.y} /> : null}
      {flash ? (
        <Pixels
          sprite={REEL_FLASH_ART}
          x={x + REEL_FLASH_ART.x}
          y={REEL_BOX.y + REEL_FLASH_ART.y}
        />
      ) : null}
    </g>
  );
}

export interface SlotMachineProps {
  /** The spin's symbols, or null before the first spin. */
  reels: readonly string[] | null;
  /** How many reels have stopped (left to right). */
  stopped: number;
  /** Changes with every spin. */
  spinKey: string;
  /** Reels that pay, once all have stopped (they get a gold frame). */
  winning: readonly number[];
}

/** The slot machine scene: cabinet, bulbs, lever, three reels, the payline and the win flash. */
export function SlotMachine({ reels, stopped, spinKey, winning }: SlotMachineProps) {
  const spinning = reels !== null && stopped < 3;
  const won = reels !== null && !spinning && winning.length > 0;
  const lights = useCycle(2, spinning);
  const lever = useReveal(reels ? LEVER_STEPS : null, STEP_MS, spinKey);
  const blink = useReveal(won ? FLASH_STEPS : null, FLASH_MS, `${spinKey}-win`);
  const flash = won && (blink >= FLASH_STEPS || blink % 2 === 0);
  const pulled = spinning && lever < LEVER_STEPS;
  return (
    <CasinoScene w={SLOTS_SIZE.w} h={SLOTS_SIZE.h} className="cc-machine__art">
      <Pixels sprite={CABINET_ART} />
      <Pixels sprite={LIGHTS_ART[flash ? blink % 2 : lights % 2] ?? CABINET_ART} />
      <Pixels sprite={LEVER_ART[pulled ? 1 : 0] ?? CABINET_ART} />
      {flash ? <Pixels sprite={FLASH_ART} /> : null}
      {[0, 1, 2].map((i) => (
        <Reel
          key={i}
          index={i}
          final={reels ? (reels[i] ?? null) : null}
          stopped={stopped > i}
          flash={flash && winning.includes(i)}
        />
      ))}
      <Pixels sprite={flash ? PAYLINE_WIN_ART : PAYLINE_ART} />
      <WinBurst playKey={won ? spinKey : null} x={SLOTS_SIZE.w - 48} y={0} />
    </CasinoScene>
  );
}
