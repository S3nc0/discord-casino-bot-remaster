import { useEffect, useState } from 'react';
import { Button, Card, Chip, ChipGroup, Dialog, Tag, TextField, useSfx } from '@casino/ui';
import { HORSE_SILKS, type HorseInfo, type HorseStable } from '@casino/shared';
import { formatPelica } from '@casino/shared/i18n';
import { useLocale, useT, type Translate } from '../../shell/i18n.ts';
import { newKey } from './api.ts';
import { useHorseApi } from './context.tsx';
import { formatClock, formatSpan } from './format.ts';
import { applyBalance, useResource, useRunner, useServerNow } from './hooks.ts';
import { ErrorNote, Loading, Section, SilksDot } from './parts.tsx';
import { HorsePortrait, PaddockScene } from './HorseScenes.tsx';
import { coatName, silksName } from './StableTab.tsx';

/** Why a horse cannot breed now, in words (the first rule that says no). */
export function breedRuleText(
  t: Translate,
  locale: 'en' | 'ja',
  rule: string,
  horse: Pick<HorseInfo, 'name'>,
  at: number | undefined,
  rules: HorseStable['rules'],
): string {
  const params = {
    name: horse.name,
    time: at === undefined ? '' : formatClock(locale, at),
    min: rules.breedMinRaces,
    max: rule === 'foal_limit' ? rules.maxFoals : rules.maxHorses,
    max_races: rules.maxRaces,
    fee: formatPelica(locale, rules.breedFee),
  };
  for (const key of [`horse.breed.err.${rule}`, `horse.err.${rule}`, `screen.horse.err.${rule}`]) {
    const text = t(key, params);
    if (text !== key) return text;
  }
  return t('screen.horse.err.generic');
}

export function BreedTab({ stable, onChange }: { stable: HorseStable; onChange: () => void }) {
  const t = useT();
  const locale = useLocale();
  const api = useHorseApi();
  const sfx = useSfx();
  const runner = useRunner();
  const now = useServerNow(stable.now);
  const { horses, rules } = stable;
  const [picked, setPicked] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [silks, setSilks] = useState<string>(HORSE_SILKS[0]);
  const [confirming, setConfirming] = useState(false);

  const a = horses.find((h) => h.id === picked[0]) ?? null;
  const b = horses.find((h) => h.id === picked[1]) ?? null;
  const preview = useResource(
    () => (a && b ? api.breedPreview(a.id, b.id) : Promise.resolve(null)),
    [api, a?.id, b?.id],
  );

  useEffect(() => {
    if (a) setSilks(a.silks);
  }, [a?.id]);

  const toggle = (id: number) => {
    sfx.play('click');
    setPicked((cur) =>
      cur.includes(id)
        ? cur.filter((x) => x !== id)
        : cur.length >= 2
          ? [cur[1] as number, id]
          : [...cur, id],
    );
  };

  const candidates = horses.filter((h) => h.breed.ok);
  const p = preview.data;
  const blocked = p && !p.eligible.ok ? p.eligible : null;
  const blockedText = (() => {
    if (!blocked?.rule || !a || !b) return null;
    const target = p?.ruleHorse === b.name ? b : a;
    return breedRuleText(t, locale, blocked.rule, target, blocked.at, rules);
  })();
  const canSubmit = Boolean(a && b && p?.eligible.ok && name.trim() !== '' && !runner.busy);

  const breed = async () => {
    if (!a || !b) return;
    const res = await runner.run(
      () => api.breed({ parentA: a.id, parentB: b.id, name, silks }, newKey()),
      'horse.breed.born',
      { name },
    );
    setConfirming(false);
    if (res) {
      sfx.play('coin');
      applyBalance(res.balance);
      setPicked([]);
      setName('');
      onChange();
    }
  };

  const foals = horses.filter((h) => h.maturesAt !== null);
  const resting = horses.filter(
    (h) => h.lastBredAt !== null && now < h.lastBredAt + rules.breedCooldownMs,
  );

  return (
    <div className="hr-stack">
      <h2 className="bb-eyebrow">{t('screen.horse.breed.heading')}</h2>
      <p>{t('screen.horse.breed.intro')}</p>
      {!stable.breedingEnabled ? (
        <p className="hr-muted">{t('screen.horse.breed.disabled')}</p>
      ) : candidates.length < 2 ? (
        <p className="hr-muted">
          {t('screen.horse.breed.notEnough', { min: rules.breedMinRaces })}
        </p>
      ) : null}

      <p className="hr-label">{t('screen.horse.breed.pick')}</p>
      <ChipGroup label={t('screen.horse.breed.pick')} className="hr-picks">
        {horses.map((h) => (
          <Chip
            key={h.id}
            selected={picked.includes(h.id)}
            disabled={!h.breed.ok}
            icon={<SilksDot silks={h.silks} />}
            onClick={() => toggle(h.id)}
          >
            {h.name}
          </Chip>
        ))}
      </ChipGroup>
      <ul className="hr-reasons">
        {horses
          .filter((h) => !h.breed.ok)
          .map((h) => (
            <li key={h.id} className="hr-muted">
              {breedRuleText(t, locale, h.breed.rule ?? '', h, h.breed.at, rules)}
            </li>
          ))}
      </ul>

      {a && b ? (
        <Card variant="filled" className="hr-preview" title={t('screen.horse.breed.previewTitle')}>
          <div className="hr-preview__pair">
            <PaddockScene a={a} b={b} />
          </div>
          {preview.loading && !p ? <Loading /> : null}
          {p ? (
            <>
              <p>
                {t('screen.horse.breed.previewTotal', { min: p.total.min, max: p.total.max })} ·{' '}
                {t('screen.horse.breed.previewGen', { gen: p.generation })}
              </p>
              <dl className="hr-ranges">
                {(['speed', 'stamina', 'power', 'guts'] as const).map((k) => (
                  <div key={k}>
                    <dt>{t(`screen.horse.stat.${k}`)}</dt>
                    <dd>{t('screen.horse.breed.previewRange', p.stats[k])}</dd>
                  </div>
                ))}
              </dl>
              <p className="hr-muted">
                {t('screen.horse.breed.previewCoat', {
                  a: coatName(t, p.coats[0]),
                  b: coatName(t, p.coats[1]),
                  pct: p.randomCoatPercent,
                })}
              </p>
              <p className="hr-muted">{t('screen.horse.breed.previewNote')}</p>
              <p>
                <strong>{t('horse.breed.fee', { fee: formatPelica(locale, p.fee) })}</strong> ·{' '}
                {t('horse.breed.matures', { time: formatSpan(p.maturityMs) })}
              </p>
              {blockedText ? (
                <p className="hr-bad" role="status">
                  {blockedText}
                </p>
              ) : p.eligible.ok ? (
                <Tag hue="green">{t('screen.horse.breed.eligible')}</Tag>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}

      {a && b ? (
        <>
          <TextField
            label={t('screen.horse.breed.name')}
            value={name}
            maxLength={rules.nameMax}
            helperText={t('screen.horse.new.nameHelp', { max: rules.nameMax })}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="hr-label">{t('screen.horse.breed.silks')}</p>
          <ChipGroup label={t('screen.horse.breed.silks')}>
            {HORSE_SILKS.map((s) => (
              <Chip
                key={s}
                selected={silks === s}
                icon={<SilksDot silks={s} />}
                onClick={() => setSilks(s)}
              >
                {silksName(t, s)}
              </Chip>
            ))}
          </ChipGroup>
          <ErrorNote error={runner.error} rules={rules} />
          <Button disabled={!canSubmit} onClick={() => setConfirming(true)}>
            {t('screen.horse.breed.submit')}
          </Button>
        </>
      ) : null}

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('screen.horse.breed.confirmTitle')}
        description={t('horse.breed.confirm', {
          a: a?.name ?? '',
          b: b?.name ?? '',
          fee: formatPelica(locale, rules.breedFee),
        })}
        actions={
          <>
            <Button variant="text" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={runner.busy} onClick={() => void breed()}>
              {t('screen.horse.breed.submit')}
            </Button>
          </>
        }
      >
        <p className="hr-muted">
          {t('screen.horse.breed.balance', { amount: formatPelica(locale, stable.balance) })}
        </p>
      </Dialog>

      <Section title={t('screen.horse.breed.foals')} id="hr-foals">
        {foals.length === 0 && resting.length === 0 ? (
          <p className="hr-muted">{t('screen.horse.breed.noFoals')}</p>
        ) : null}
        <ul className="hr-list">
          {foals.map((h) => (
            <li key={h.id} className="hr-foal">
              <HorsePortrait coat={h.coat} silks={h.silks} />
              <div>
                <strong>{h.name}</strong>
                <p className="hr-muted">
                  {h.maturesAt !== null && now < h.maturesAt
                    ? t('screen.horse.breed.countdown', { time: formatSpan(h.maturesAt - now) })
                    : t('screen.horse.breed.ready')}
                  {h.parents
                    ? ` · ${t('horse.lineage', { a: h.parents[0].name, b: h.parents[1].name, gen: h.generation })}`
                    : ''}
                </p>
              </div>
            </li>
          ))}
          {resting.map((h) => (
            <li key={`rest-${h.id}`} className="hr-foal">
              <HorsePortrait coat={h.coat} silks={h.silks} />
              <div>
                <strong>{h.name}</strong>
                <p className="hr-muted">
                  {t('screen.horse.breed.cooldownLeft', {
                    time: formatSpan((h.lastBredAt as number) + rules.breedCooldownMs - now),
                  })}
                  {' · '}
                  {t('screen.horse.breed.foalsOf', { n: h.foalCount, max: rules.maxFoals })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
