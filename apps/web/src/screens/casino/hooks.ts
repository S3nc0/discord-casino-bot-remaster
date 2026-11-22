import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CasinoOverview, GameId, TableSnapshot } from '@casino/shared';
import { MIN_BET_FALLBACK } from './format.ts';
import { isReducedMotionActive, useSfx, type SfxName } from '@casino/ui';
import { ApiError } from '../../shell/api.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import { useSettingsStore } from '../../shell/stores/settings.ts';
import { GameError } from './client.ts';
import { useCasino } from './services.tsx';

/** The i18n key of an error from a game call or an API call. */
export function errorKeyOf(error: unknown): string {
  if (error instanceof GameError) {
    return error.offline ? 'screen.casino.offline' : `error.${error.code}`;
  }
  if (error instanceof ApiError) return `error.${error.code}`;
  return 'error.internal';
}

export function useUserId(): string | null {
  return useSessionStore((s) => s.user?.id ?? null);
}

/** Whole seconds until `deadline` (epoch ms on the server clock); null without a deadline. */
export function useCountdown(deadline: number | null | undefined, offsetMs = 0): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null || deadline === undefined) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (deadline === null || deadline === undefined) return null;
  return Math.max(0, Math.ceil((deadline - offsetMs - now) / 1000));
}

/** Busy flag and last error for one kind of call. */
export function useCall() {
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setErrorKey(null);
    try {
      return await fn();
    } catch (error) {
      if (alive.current) setErrorKey(errorKeyOf(error));
      return null;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);
  const clear = useCallback(() => setErrorKey(null), []);
  return { busy, errorKey, run, clear };
}

/** Sound follows the user's settings; the first bet click unlocks audio. */
export function useCasinoSfx() {
  const sound = useSettingsStore((s) => s.sound);
  const sfx = useSfx();
  const { setSettings, play: playRaw, unlock } = sfx;
  useEffect(() => {
    setSettings({
      enabled: sound.enabled,
      sfxVolume: sound.sfxVolume,
      musicVolume: sound.musicVolume,
    });
  }, [setSettings, sound.enabled, sound.sfxVolume, sound.musicVolume]);
  const play = useCallback((name: SfxName) => void playRaw(name), [playRaw]);
  const arm = useCallback(() => void unlock(), [unlock]);
  return useMemo(() => ({ play, arm }), [play, arm]);
}

/** Minimum and current bet, kept per game for the session. */
const lastBets = new Map<string, number>();

export function useBetAmount(game: GameId, minBet = MIN_BET_FALLBACK) {
  const balance = useBalanceStore((s) => s.balance);
  const [amount, setAmountState] = useState(() => lastBets.get(game) ?? 100);
  const setAmount = useCallback(
    (next: number) => {
      const safe = Math.max(0, Math.floor(Number.isFinite(next) ? next : 0));
      lastBets.set(game, safe);
      setAmountState(safe);
    },
    [game],
  );
  const valid = amount >= minBet && (balance === null || amount <= balance);
  return { amount, setAmount, valid, minBet, balance };
}

/** The overview (jackpot, last rounds); `refresh` after a round settles. */
export function useOverview() {
  const { api } = useCasino();
  const [overview, setOverview] = useState<CasinoOverview | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = useCallback(() => {
    api
      .overview()
      .then((next) => {
        if (alive.current) setOverview(next);
      })
      .catch(() => undefined);
  }, [api]);
  useEffect(refresh, [refresh]);
  return { overview, refresh };
}

/** Live snapshot of a shared table. Older snapshots (lower `seq`) are dropped. */
export function useTable(game: GameId) {
  const { client } = useCasino();
  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null);
  useEffect(() => {
    setSnapshot(null);
    return client.watchTable(game, (next) =>
      setSnapshot((prev) =>
        prev && prev.roundId === next.roundId && next.seq < prev.seq ? prev : next,
      ),
    );
  }, [client, game]);
  const offsetMs = client.clockOffsetMs();
  return { snapshot, offsetMs };
}

export { isReducedMotionActive };
