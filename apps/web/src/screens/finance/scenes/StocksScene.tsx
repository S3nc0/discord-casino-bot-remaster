import { PRICE_SCALE, type FinanceSymbolView } from '@casino/shared';
import { STOCKS_ART, TICKER_BOX } from '../art/stocks.ts';
import { useNumber } from '../hooks.ts';
import { artBox, PixelScene } from '../PixelScene.tsx';

/** The trading floor. The LED board scrolls the live prices (still under reduced motion). */
export function StocksScene({
  symbols,
  flash,
}: {
  symbols: readonly FinanceSymbolView[];
  flash?: { n: number; tone: 'buy' | 'sell' } | undefined;
}) {
  const num = useNumber();
  const [x, y, w, h] = TICKER_BOX;
  const items = symbols.map((s) => {
    const dir = s.changeBps > 0 ? 'up' : s.changeBps < 0 ? 'down' : 'flat';
    const mark = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
    return (
      <span key={s.key} className="fx-ticker__item">
        <b>{s.key.toUpperCase()}</b> {num(s.priceMicros / PRICE_SCALE, 2)}{' '}
        <span data-dir={dir}>
          {mark}
          {`${s.changeBps > 0 ? '+' : ''}${num(s.changeBps / 100, 2)}%`}
        </span>
      </span>
    );
  });
  return (
    <PixelScene
      art={STOCKS_ART}
      name="stocks"
      flash={flash}
      overlay={
        <span className="fx-ticker" style={artBox(x, y, w, h)}>
          <span className="fx-ticker__run">
            <span className="fx-ticker__set">{items}</span>
            <span className="fx-ticker__set">{items}</span>
          </span>
        </span>
      }
    />
  );
}
