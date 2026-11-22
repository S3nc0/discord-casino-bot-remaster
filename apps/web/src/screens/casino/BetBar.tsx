import { useEffect, useState } from 'react';
import { Chip, ChipGroup, IconButton, TextField } from '@casino/ui';
import { useLocale, useT } from '../../shell/i18n.ts';
import { formatNumber } from './format.ts';

export interface BetBarProps {
  value: number;
  onChange: (value: number) => void;
  minBet: number;
  /** Balance the bet may not exceed; null while unknown. */
  balance: number | null;
  disabled?: boolean;
  /** Label of the field (defaults to "Bet amount"). */
  label?: string;
}

/** Bet amount field with a stepper and the Min, Half, Double and All-in chips. */
export function BetBar({ value, onChange, minBet, balance, disabled = false, label }: BetBarProps) {
  const t = useT();
  const locale = useLocale();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const cap = balance ?? Number.MAX_SAFE_INTEGER;
  const clamp = (n: number) => Math.min(Math.max(Math.floor(n), minBet), Math.max(cap, minBet));
  const step = Math.max(minBet, Math.pow(10, Math.max(1, String(Math.max(value, 10)).length - 2)));

  const type = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, 13);
    setText(digits);
    onChange(digits === '' ? 0 : Number(digits));
  };

  const tooLow = value < minBet;
  const tooHigh = balance !== null && value > balance;
  const error = tooLow
    ? t('screen.casino.betMin', { amount: formatNumber(locale, minBet) })
    : tooHigh
      ? t('error.insufficient_funds')
      : false;

  return (
    <div className="cc-bet">
      <div className="cc-bet__row">
        <IconButton
          label={t('screen.casino.stepDown')}
          variant="tonal"
          disabled={disabled}
          onClick={() => onChange(clamp(value - step))}
        >
          −
        </IconButton>
        <TextField
          className="cc-bet__field"
          label={label ?? t('screen.casino.betAmount')}
          inputMode="numeric"
          autoComplete="off"
          value={text}
          disabled={disabled}
          error={error}
          helperText={t('screen.casino.betMin', { amount: formatNumber(locale, minBet) })}
          onChange={(event) => type(event.currentTarget.value)}
        />
        <IconButton
          label={t('screen.casino.stepUp')}
          variant="tonal"
          disabled={disabled}
          onClick={() => onChange(clamp(value + step))}
        >
          +
        </IconButton>
      </div>
      <ChipGroup label={t('screen.casino.bet')} className="cc-bet__chips">
        <Chip disabled={disabled} onClick={() => onChange(minBet)}>
          {t('screen.casino.chip.min')}
        </Chip>
        <Chip disabled={disabled} onClick={() => onChange(clamp(value / 2))}>
          {t('screen.casino.chip.half')}
        </Chip>
        <Chip disabled={disabled} onClick={() => onChange(clamp(value * 2))}>
          {t('screen.casino.chip.double')}
        </Chip>
        <Chip disabled={disabled || balance === null} onClick={() => onChange(clamp(cap))}>
          {t('screen.casino.chip.max')}
        </Chip>
      </ChipGroup>
    </div>
  );
}
