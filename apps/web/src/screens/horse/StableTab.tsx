import { useState } from 'react';
import { Button, Card, Chip, ChipGroup, Dialog, Tag, TextField, useSfx } from '@casino/ui';
import {
  HORSE_COATS,
  HORSE_SILKS,
  HORSE_STATS,
  HORSE_STYLES,
  type HorseInfo,
  type HorseStable,
  type HorseStat,
  type HorseStyle,
} from '@casino/shared';
import { formatPelica } from '@casino/shared/i18n';
import { useLocale, useT } from '../../shell/i18n.ts';
import { newKey } from './api.ts';
import { useHorseApi } from './context.ts';
import { coatIndex, formatNumber, silksIndex } from './format.ts';
import { applyBalance, useRunner } from './hooks.ts';
import { ErrorNote, SilksDot, StatBars } from './parts.tsx';
import { PixelHorse } from './PixelHorse.tsx';

export interface StableTabProps {
  stable: HorseStable;
  onChange: () => void;
}

export function coatName(t: (k: string) => string, coat: string): string {
  const i = coatIndex(coat);
  return i < 0 ? coat : t(`screen.horse.coat.${i}`);
}

export function silksName(t: (k: string) => string, silks: string): string {
  const i = silksIndex(silks);
  return i < 0 ? silks : t(`screen.horse.silks.${i}`);
}

export function StableTab({ stable, onChange }: StableTabProps) {
  const t = useT();
  const locale = useLocale();
  const [creating, setCreating] = useState(false);
  const [caring, setCaring] = useState<number | null>(null);
  const [retiring, setRetiring] = useState<number | null>(null);
  const { horses, items, rules } = stable;
  const full = horses.length >= rules.maxHorses;
  const careHorse = horses.find((h) => h.id === caring) ?? null;
  const retireHorse = horses.find((h) => h.id === retiring) ?? null;
  return (
    <div className="hr-stack">
      <div className="hr-section__head">
        <h2 className="bb-eyebrow">{t('screen.horse.stable.title')}</h2>
        <span className="hr-muted">
          {horses.length}/{rules.maxHorses}
        </span>
      </div>
      <ul className="hr-items" aria-label={t('screen.horse.stable.items')}>
        <li>
          {t('screen.horse.item.voucher')} <strong>×{items.voucher}</strong>
        </li>
        <li>
          {t('screen.horse.item.carrot')} <strong>×{items.carrot}</strong>
        </li>
        <li>
          {t('screen.horse.item.goldCarrot')} <strong>×{items.goldCarrot}</strong>
        </li>
      </ul>
      {horses.length === 0 ? <p className="hr-muted">{t('screen.horse.stable.empty')}</p> : null}
      <ul className="hr-list">
        {horses.map((h) => (
          <li key={h.id}>
            <HorseCard
              horse={h}
              onCare={() => setCaring(h.id)}
              onRetire={() => setRetiring(h.id)}
              now={stable.now}
              maxRaces={rules.maxRaces}
            />
          </li>
        ))}
      </ul>
      {!full ? (
        <>
          <Button variant="tonal" disabled={items.voucher < 1} onClick={() => setCreating(true)}>
            {t('screen.horse.stable.new')}
          </Button>
          {items.voucher < 1 ? <p className="hr-muted">{t('screen.horse.new.noVoucher')}</p> : null}
        </>
      ) : null}
      {creating ? (
        <CreateDialog
          stable={stable}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            onChange();
          }}
        />
      ) : null}
      {careHorse ? (
        <CareDialog
          horse={careHorse}
          stable={stable}
          onClose={() => setCaring(null)}
          onChange={onChange}
        />
      ) : null}
      {retireHorse ? (
        <RetireDialog
          horse={retireHorse}
          onClose={() => setRetiring(null)}
          onDone={() => {
            setRetiring(null);
            onChange();
          }}
          locale={locale}
        />
      ) : null}
    </div>
  );
}

function HorseCard({
  horse: h,
  onCare,
  onRetire,
  now,
  maxRaces,
}: {
  horse: HorseInfo;
  onCare: () => void;
  onRetire: () => void;
  now: number;
  maxRaces: number;
}) {
  const t = useT();
  const total = h.stats.speed + h.stats.stamina + h.stats.power + h.stats.guts;
  const young = h.maturesAt !== null && now < h.maturesAt;
  return (
    <Card
      variant="filled"
      className="hr-horsecard"
      media={
        <div className="hr-horsecard__art">
          <PixelHorse coat={h.coat} silks={h.silks} />
        </div>
      }
      title={
        <>
          {h.name}
          {young ? <Tag hue="amber">{t('screen.horse.horse.foal')}</Tag> : null}
          {h.generation > 0 ? (
            <Tag hue="violet">{t('screen.horse.horse.generation', { gen: h.generation })}</Tag>
          ) : null}
          {h.enteredRaceId !== null ? <Tag hue="sky">{t('screen.horse.horse.entered')}</Tag> : null}
        </>
      }
      meta={
        <>
          {coatName(t, h.coat)} · {silksName(t, h.silks)} <SilksDot silks={h.silks} /> ·{' '}
          {t('screen.horse.horse.age', { races: h.races, max: maxRaces })}
        </>
      }
      actions={
        <>
          <Button variant="text" onClick={onRetire}>
            {t('screen.horse.horse.retire')}
          </Button>
          <Button variant="tonal" onClick={onCare}>
            {t('screen.horse.horse.manage')}
          </Button>
        </>
      }
    >
      <p>
        {t('screen.horse.runner.record', { races: h.races, wins: h.wins, places: h.places })} ·{' '}
        {t('screen.horse.horse.style')}: {t(`screen.horse.style.${h.style ?? 'auto'}`)}
        {h.style === null ? ` (${t(`screen.horse.style.${h.autoStyle}`)})` : ''}
      </p>
      <StatBars stats={h.stats} name={h.name} />
      <p className="hr-muted">{t('screen.horse.horse.total', { total })}</p>
      {h.parents ? (
        <p className="hr-muted">
          {t('horse.lineage', { a: h.parents[0].name, b: h.parents[1].name, gen: h.generation })}
        </p>
      ) : null}
    </Card>
  );
}

function CreateDialog({
  stable,
  onClose,
  onDone,
}: {
  stable: HorseStable;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const api = useHorseApi();
  const sfx = useSfx();
  const runner = useRunner();
  const [name, setName] = useState('');
  const [coat, setCoat] = useState<string>(HORSE_COATS[1]);
  const [silks, setSilks] = useState<string>(HORSE_SILKS[4]);
  const create = async () => {
    const res = await runner.run(
      () => api.createHorse({ name, coat, silks }, newKey()),
      'screen.horse.new.done',
    );
    if (res) {
      sfx.play('coin');
      applyBalance(res.balance);
      onDone();
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('screen.horse.new.title')}
      description={t('screen.horse.new.help')}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={runner.busy || name.trim() === ''} onClick={() => void create()}>
            {t('screen.horse.new.create')}
          </Button>
        </>
      }
    >
      <div className="hr-stack">
        <TextField
          label={t('screen.horse.new.name')}
          value={name}
          maxLength={stable.rules.nameMax}
          helperText={t('screen.horse.new.nameHelp', { max: stable.rules.nameMax })}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="hr-label">{t('screen.horse.new.coat')}</p>
        <ChipGroup label={t('screen.horse.new.coat')}>
          {HORSE_COATS.map((c, i) => (
            <Chip key={c} selected={coat === c} onClick={() => setCoat(c)}>
              {t(`screen.horse.coat.${i}`)}
            </Chip>
          ))}
        </ChipGroup>
        <p className="hr-label">{t('screen.horse.new.silks')}</p>
        <ChipGroup label={t('screen.horse.new.silks')}>
          {HORSE_SILKS.map((s, i) => (
            <Chip
              key={s}
              selected={silks === s}
              icon={<SilksDot silks={s} />}
              onClick={() => setSilks(s)}
            >
              {t(`screen.horse.silks.${i}`)}
            </Chip>
          ))}
        </ChipGroup>
        <ErrorNote error={runner.error} rules={stable.rules} />
      </div>
    </Dialog>
  );
}

function CareDialog({
  horse,
  stable,
  onClose,
  onChange,
}: {
  horse: HorseInfo;
  stable: HorseStable;
  onClose: () => void;
  onChange: () => void;
}) {
  const t = useT();
  const api = useHorseApi();
  const sfx = useSfx();
  const runner = useRunner();
  const [from, setFrom] = useState<HorseStat>('power');
  const [to, setTo] = useState<HorseStat>('speed');
  const [first, setFirst] = useState<HorseStat>('speed');
  const [second, setSecond] = useState<HorseStat>('stamina');
  const apply = async (fn: () => Promise<{ balance: number }>, done: string) => {
    const res = await runner.run(fn, done);
    if (res) {
      sfx.play('click');
      applyBalance(res.balance);
      onChange();
    }
  };
  const statChips = (label: string, value: HorseStat, set: (s: HorseStat) => void) => (
    <ChipGroup label={label}>
      {HORSE_STATS.map((s) => (
        <Chip key={s} selected={value === s} onClick={() => set(s)}>
          {t(`screen.horse.stat.${s}`)}
        </Chip>
      ))}
    </ChipGroup>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={horse.name}
      actions={<Button onClick={onClose}>{t('common.ok')}</Button>}
    >
      <div className="hr-stack">
        <StatBars stats={horse.stats} name={horse.name} />

        <p className="hr-label">{t('screen.horse.horse.style')}</p>
        <ChipGroup label={t('screen.horse.horse.style')}>
          {([null, ...HORSE_STYLES] as (HorseStyle | null)[]).map((s) => (
            <Chip
              key={s ?? 'auto'}
              selected={horse.style === s}
              onClick={() =>
                void apply(
                  () => api.style({ horseId: horse.id, style: s }, newKey()),
                  'screen.horse.horse.styleSet',
                )
              }
            >
              {t(`screen.horse.style.${s ?? 'auto'}`)}
            </Chip>
          ))}
        </ChipGroup>

        <p className="hr-label">
          {t('screen.horse.horse.carrot')} ×{stable.items.carrot}
        </p>
        <p className="hr-muted">{t('screen.horse.horse.carrotHelp')}</p>
        {statChips(t('screen.horse.horse.carrotFrom'), from, setFrom)}
        {statChips(t('screen.horse.horse.carrotTo'), to, setTo)}
        <Button
          variant="tonal"
          disabled={runner.busy || from === to}
          onClick={() =>
            void apply(
              () => api.carrot({ horseId: horse.id, from, to }, newKey()),
              'screen.horse.horse.carrotDone',
            )
          }
        >
          {t('screen.horse.horse.carrotUse')}
        </Button>

        <p className="hr-label">
          {t('screen.horse.horse.gold')} ×{stable.items.goldCarrot}
        </p>
        <p className="hr-muted">
          {horse.goldCarrotUsed
            ? t('screen.horse.horse.goldUsed')
            : t('screen.horse.horse.goldHelp')}
        </p>
        {!horse.goldCarrotUsed ? (
          <>
            {statChips(t('screen.horse.horse.goldFirst'), first, setFirst)}
            {statChips(t('screen.horse.horse.goldSecond'), second, setSecond)}
            <Button
              variant="tonal"
              disabled={runner.busy}
              onClick={() =>
                void apply(
                  () => api.goldCarrot({ horseId: horse.id, first, second }, newKey()),
                  'screen.horse.horse.goldDone',
                )
              }
            >
              {t('screen.horse.horse.goldUse')}
            </Button>
          </>
        ) : null}
        <ErrorNote error={runner.error} rules={stable.rules} />
      </div>
    </Dialog>
  );
}

function RetireDialog({
  horse,
  onClose,
  onDone,
  locale,
}: {
  horse: HorseInfo;
  onClose: () => void;
  onDone: () => void;
  locale: 'en' | 'ja';
}) {
  const t = useT();
  const api = useHorseApi();
  const runner = useRunner();
  const value = horse.retireValue;
  const retire = async () => {
    const res = await runner.run(
      () => api.retire({ horseId: horse.id }, newKey()),
      'screen.horse.horse.retireDone',
    );
    if (res) {
      applyBalance(res.balance);
      onDone();
    }
  };
  return (
    <Dialog
      open
      role="alertdialog"
      onClose={onClose}
      title={t('screen.horse.horse.retireConfirm', { name: horse.name })}
      description={`${t('screen.horse.horse.retireWarn')} ${
        value > 0
          ? t('screen.horse.horse.retirePay', { amount: formatPelica(locale, value) })
          : value < 0
            ? t('screen.horse.horse.retireFee', { amount: formatPelica(locale, -value) })
            : t('screen.horse.horse.retireZero')
      }`}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" disabled={runner.busy} onClick={() => void retire()}>
            {t('screen.horse.horse.retire')}
          </Button>
        </>
      }
    >
      <ErrorNote error={runner.error} />
    </Dialog>
  );
}

export { formatNumber };
