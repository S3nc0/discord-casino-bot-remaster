import { screenName, useLocale } from '../../shell/i18n.ts';
import { DailyBonus } from './home.tsx';

/** The daily screen id: the Home bonus card on its own, under a title. */
export default function DailyScreen() {
  const locale = useLocale();
  return (
    <section className="cc-daily" data-screen="daily" aria-labelledby="daily-title">
      <h1 id="daily-title">{screenName(locale, 'daily')}</h1>
      <DailyBonus />
    </section>
  );
}
