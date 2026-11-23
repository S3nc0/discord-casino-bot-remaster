import type { CardView } from '@casino/shared';
import { useT } from '../../shell/i18n.ts';
import { useReveal } from './anim.ts';
import { CasinoScene, Pixels } from './art/PixelArt.tsx';
import { CARD_ART, CARD_BACK_ART, CARD_SIZE } from './art/blackjack-art.ts';
import { squeeze, type Sprite } from './art/sprite.ts';

const RED_SUITS = new Set(['♥', '♦']);
/** One step of the flip. */
const FLIP_MS = 70;

/** The card seen edge on, halfway through the flip. */
const EDGE: Sprite = {
  x: 0,
  y: 0,
  w: CARD_SIZE.w,
  h: CARD_SIZE.h,
  legend: 'neutral-50 neutral-87',
  rows: Array.from({ length: CARD_SIZE.h }, (_, y) =>
    y === 0 || y === CARD_SIZE.h - 1
      ? '.'.repeat(CARD_SIZE.w)
      : `${'.'.repeat(Math.floor(CARD_SIZE.w / 2) - 1)}!#`.padEnd(CARD_SIZE.w, '.'),
  ),
};
const BACK_HALF = squeeze(CARD_BACK_ART, 15);
const HALF = new Map<Sprite, Sprite>();
const half = (face: Sprite) => {
  let s = HALF.get(face);
  if (!s) {
    s = squeeze(face, 15);
    HALF.set(face, s);
  }
  return s;
};

export interface PlayingCardProps {
  /** null = face-down. */
  card: CardView | null;
  /** The card just arrived: it turns over from its back in four steps. */
  fresh?: boolean;
}

/** A pixel card: the face (J, Q and K with portraits) or the back. Named in words for readers. */
export function PlayingCard({ card, fresh = false }: PlayingCardProps) {
  const t = useT();
  const face = card ? CARD_ART[`${card.rank}${card.suit}`] : undefined;
  const flipping = fresh && face !== undefined;
  const step = useReveal(flipping ? 4 : null, FLIP_MS, card ? `${card.rank}${card.suit}` : 'down');
  let sprite: Sprite = face ?? CARD_BACK_ART;
  if (face && flipping && step < 4)
    sprite = [CARD_BACK_ART, BACK_HALF, EDGE, half(face)][step] ?? face;
  const art = (
    <CasinoScene w={CARD_SIZE.w} h={CARD_SIZE.h} className="cc-card__art">
      <Pixels sprite={sprite} />
    </CasinoScene>
  );
  if (card === null) {
    return (
      <span
        className="cc-card cc-card--down"
        role="img"
        aria-label={t('screen.casino.blackjack.hidden')}
      >
        {art}
      </span>
    );
  }
  const red = RED_SUITS.has(card.suit);
  return (
    <span
      className={`cc-card${red ? ' cc-card--red' : ''}${fresh ? ' cc-card--fresh' : ''}`}
      role="img"
      aria-label={t('screen.casino.blackjack.card', { rank: card.rank, suit: card.suit })}
    >
      {art}
    </span>
  );
}
