import { useMemo, useState } from 'react';
import { Button, Chip, ChipGroup, TextField, useSfx } from '@casino/ui';
import {
  HORSE_BET_KINDS,
  HORSE_MULTI_KINDS,
  HORSE_PICKS_NEEDED,
  type HorseBetKind,
  type HorseRaceDetail,
  type HorseRules,
} from '@casino/shared';
import { formatPelica } from '@casino/shared/i18n';
import { useLocale, useT } from '../../shell/i18n.ts';
import { newKey } from './api.ts';
import { useHorseApi } from './context.ts';
import { formatNumber, formatOdds, isOrderedKind } from './format.ts';
import { applyBalance, useRunner } from './hooks.ts';
import { ErrorNote, SilksDot } from './parts.tsx';

const PRESETS = [100, 500, 1000, 5000, 10_000] as const;

/** The ticket key the server stores for these picks (see `betKey` in the race domain). */
export function ticketKey(kind: HorseBetKind, lanes: readonly number[]): string {
  if (isOrderedKind(kind)) return lanes.join('>');
  return [...lanes].sort((a, b) => a - b).join(lanes.length === 1 ? '' : '-');
}

export interface BetSlipProps {
  detail: HorseRaceDetail;
  rules: HorseRules;
  /** Called after a ticket was bought so the race reloads. */
  onBought: () => void;
}

/** Seven ticket types, horse picks, a stake; one ticket per horse for win and place. */
export function BetSlip({ detail, rules, onBought }: BetSlipProps) {
  const t = useT();
  const locale = useLocale();
  const api = useHorseApi();
  const sfx = useSfx();
  const runner = useRunner();
  const [kind, setKind] = useState<HorseBetKind>('win');
  const [picks, setPicks] = useState<number[]>([]);
  const [stakeText, setStakeText] = useState('500');
  const [bought, setBought] = useState(0);

  const need = HORSE_PICKS_NEEDED[kind];
  const multi = HORSE_MULTI_KINDS.includes(kind);
  const stake = Number(stakeText);
  const stakeOk = Number.isInteger(stake) && stake >= rules.minStake && stake <= rules.maxStake;
  const ready = multi ? picks.length >= 1 : picks.length === need;
  const tickets = multi ? picks.length : 1;
  const odds = useMemo(() => {
    if (!ready || multi) return null;
    return detail.odds[kind]?.[ticketKey(kind, picks)] ?? null;
  }, [detail.odds, kind, multi, picks, ready]);

  const toggle = (lane: number) => {
    sfx.play('click');
    setBought(0);
    setPicks((current) => {
      if (current.includes(lane)) return current.filter((l) => l !== lane);
      if (multi) return [...current, lane];
      return current.length >= need ? [...current.slice(1), lane] : [...current, lane];
    });
  };

  const pickLabel = multi
    ? t('screen.horse.bet.pick.multi')
    : t(isOrderedKind(kind) ? 'screen.horse.bet.pick.ordered' : 'screen.horse.bet.pick.set', {
        n: need,
      });

  const buy = async () => {
    const lanesList = multi ? picks.map((lane) => [lane]) : [picks];
    let count = 0;
    const result = await runner.run(async () => {
      for (const lanes of lanesList) {
        const response = await api.bet(detail.race.id, { kind, lanes, stake }, newKey());
        applyBalance(response.balance);
        count += 1;
      }
      return count;
    });
    // Tickets bought before a refusal stay bought: show them and reload.
    if (count > 0) {
      sfx.play('chip');
      setBought(count);
      setPicks([]);
      onBought();
    }
    return result;
  };

  return (
    <div className="hr-stack">
      <ChipGroup label={t('screen.horse.bet.kind.label')} className="hr-kinds">
        {HORSE_BET_KINDS.map((k) => (
          <Chip
            key={k}
            selected={k === kind}
            onClick={() => {
              sfx.play('click');
              setKind(k);
              setPicks([]);
              setBought(0);
            }}
          >
            {t(`screen.horse.bet.kind.${k}`)}
          </Chip>
        ))}
      </ChipGroup>
      <p className="hr-muted">{t(`screen.horse.bet.hint.${kind}`)}</p>

      <p className="hr-label" id="hr-picks">
        {pickLabel}
      </p>
      <ChipGroup label={pickLabel} className="hr-picks">
        {detail.runners.map((r) => {
          const index = picks.indexOf(r.lane);
          return (
            <Chip
              key={r.lane}
              selected={index >= 0}
              icon={<SilksDot silks={r.silks} />}
              onClick={() => toggle(r.lane)}
            >
              {isOrderedKind(kind) && index >= 0 ? `${index + 1}. ` : ''}
              {r.lane} {r.name}
            </Chip>
          );
        })}
      </ChipGroup>

      <div className="hr-stake">
        <TextField
          label={t('screen.horse.bet.stake')}
          inputMode="numeric"
          value={stakeText}
          onChange={(e) => setStakeText(e.target.value.replace(/[^0-9]/g, ''))}
          helperText={t('screen.horse.bet.stakeRange', {
            min: formatNumber(locale, rules.minStake),
            max: formatNumber(locale, rules.maxStake),
            race: formatNumber(locale, rules.maxRaceStake),
          })}
          error={
            stakeText !== '' && !stakeOk
              ? t('screen.horse.bet.stakeInvalid', { min: rules.minStake, max: rules.maxStake })
              : false
          }
        />
        <ChipGroup label={t('screen.horse.bet.stake')} className="hr-presets">
          {PRESETS.map((p) => (
            <Chip key={p} selected={stake === p} onClick={() => setStakeText(String(p))}>
              {formatNumber(locale, p)}
            </Chip>
          ))}
        </ChipGroup>
      </div>

      <p className="hr-quote" aria-live="polite">
        {odds !== null
          ? t('screen.horse.bet.odds', { odds: formatOdds(odds) })
          : multi && ready
            ? ''
            : ready
              ? t('screen.horse.bet.oddsNone')
              : ''}
        {ready && stakeOk
          ? ` ${t('screen.horse.bet.total', { amount: formatPelica(locale, stake * tickets) })}`
          : ''}
      </p>
      <p className="hr-muted">{t('screen.horse.bet.fixed')}</p>
      <ErrorNote error={runner.error} rules={rules} />
      {bought > 0 && !runner.error ? (
        <p className="hr-ok" role="status">
          {t('screen.horse.bet.bought')} ×{bought}
        </p>
      ) : null}
      <Button disabled={!ready || !stakeOk || runner.busy} onClick={() => void buy()}>
        {tickets > 1 ? t('screen.horse.bet.buyMany', { n: tickets }) : t('screen.horse.bet.buy')}
      </Button>
    </div>
  );
}
