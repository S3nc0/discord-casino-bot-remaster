import type { CardView } from '@casino/shared';
import { useT } from '../../shell/i18n.ts';

const RED_SUITS = new Set(['♥', '♦']);

export interface PlayingCardProps {
  /** null = face-down. */
  card: CardView | null;
  /** The card just arrived: it flips in with a three step animation. */
  fresh?: boolean;
}

/** A pixel-edged card. The suit is a symbol and a colour, never colour alone. */
export function PlayingCard({ card, fresh = false }: PlayingCardProps) {
  const t = useT();
  if (card === null) {
    return (
      <span
        className="cc-card cc-card--down"
        role="img"
        aria-label={t('screen.casino.blackjack.hidden')}
      />
    );
  }
  const red = RED_SUITS.has(card.suit);
  return (
    <span
      className={`cc-card${red ? ' cc-card--red' : ''}${fresh ? ' cc-card--fresh' : ''}`}
      role="img"
      aria-label={t('screen.casino.blackjack.card', { rank: card.rank, suit: card.suit })}
    >
      <span className="cc-card__rank">{card.rank}</span>
      <span className="cc-card__suit">{card.suit}</span>
    </span>
  );
}
