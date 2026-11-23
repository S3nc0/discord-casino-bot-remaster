import { useEffect, useState } from 'react';
import {
  Button,
  Chip,
  ChipGroup,
  Dialog,
  GameIcon,
  Tabs,
  Tag,
  TextField,
  useSfx,
} from '@casino/ui';
import { formatPelica } from '@casino/shared/i18n';
import type { ArenaFighter, ArenaToday, ArenaTournament } from '@casino/shared';
import { useLocale, useT } from '../../shell/i18n.ts';
import { newKey } from './api.ts';
import { useHorseApi } from './context.tsx';
import { formatClock, formatNumber, formatOddsHundredths } from './format.ts';
import { applyBalance, useResource, useRunner } from './hooks.ts';
import { ArenaPit, FighterSprite } from './ArenaScene.tsx';
import { ErrorNote, LoadFailed, Loading } from './parts.tsx';
import './horse.css';

const PRESETS = [100, 500, 1000, 5000] as const;
const POLL_MS = 15_000;

/** Which fighters can be bet on right now. */
export function openStage(t: ArenaTournament): 'semi' | 'final' | null {
  if (t.status === 'semi_betting') return 'semi';
  if (t.status === 'final_betting') return 'final';
  return null;
}

function fighterState(t: ArenaTournament, f: ArenaFighter): 'champion' | 'finalist' | 'out' | null {
  if (t.championId === f.id) return 'champion';
  if (t.status === 'final_betting' && f.stage === 'final') return 'finalist';
  if (f.stage === 'out') return 'out';
  return null;
}

function FighterRow({
  tournament,
  fighter,
  onBet,
}: {
  tournament: ArenaTournament;
  fighter: ArenaFighter;
  onBet: (f: ArenaFighter) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const stage = openStage(tournament);
  const state = fighterState(tournament, fighter);
  const canBet = stage !== null && fighter.stage === stage;
  return (
    <li className={`hr-fighter${state === 'out' ? ' is-out' : ''}`}>
      <FighterSprite name={fighter.name} />
      <div className="hr-fighter__main">
        <strong className="hr-fighter__name">{fighter.name}</strong>
        {state ? (
          <Tag hue={state === 'champion' ? 'yellow' : state === 'finalist' ? 'green' : 'neutral'}>
            {t(`screen.horse.arena.state.${state}`)}
          </Tag>
        ) : null}
        <p className="hr-muted">
          {t('screen.horse.arena.power', { power: fighter.basePower })} ·{' '}
          {t('screen.horse.arena.weapon', { pct: fighter.weaponPercent })}
          {canBet
            ? ` · ${t('screen.horse.arena.odds', { odds: formatOddsHundredths(fighter.oddsHundredths) })}`
            : ''}
        </p>
        <p className="hr-muted">
          {t('screen.horse.arena.pool', { amount: formatNumber(locale, fighter.betTotal) })}
          {fighter.myStake > 0
            ? ` · ${t('screen.horse.arena.yourStake', { amount: formatNumber(locale, fighter.myStake) })}`
            : ''}
        </p>
      </div>
      {canBet ? (
        <Button variant="tonal" onClick={() => onBet(fighter)}>
          {t('screen.horse.arena.bet', { name: fighter.name })}
        </Button>
      ) : null}
    </li>
  );
}

function groups(fighters: ArenaFighter[]): [number, ArenaFighter[]][] {
  const map = new Map<number, ArenaFighter[]>();
  for (const f of fighters) map.set(f.group, [...(map.get(f.group) ?? []), f]);
  return [...map].sort((a, b) => a[0] - b[0]);
}

function TournamentView({
  tournament,
  onBet,
}: {
  tournament: ArenaTournament;
  onBet: (f: ArenaFighter) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const stage = openStage(tournament);
  const finalists = tournament.fighters.filter(
    (f) => f.stage === 'final' || f.id === tournament.championId,
  );
  const champion = tournament.fighters.find((f) => f.id === tournament.championId);
  const runnerUp = tournament.fighters.find((f) => f.id === tournament.runnerUpId);
  const byId = new Map(tournament.fighters.map((f) => [f.id, f]));
  // the pit shows the final pair once it is known, else the first two fighters
  const pair = (finalists.length >= 2 ? finalists : tournament.fighters).slice(0, 2);
  return (
    <div className="hr-stack">
      <div className="hr-race__row">
        <Tag
          hue={tournament.status === 'done' ? 'neutral' : 'sky'}
          solid={tournament.status !== 'done'}
        >
          {t(`screen.horse.arena.status.${tournament.status}`)}
        </Tag>
        <span className="hr-muted">
          {t('screen.horse.arena.resolves', {
            semi: formatClock(locale, tournament.semiAt),
            final: formatClock(locale, tournament.finalAt),
          })}
        </span>
      </div>
      {stage !== null ? <p className="hr-muted">{t('screen.horse.arena.oddsNote')}</p> : null}

      {champion ? (
        <p className="hr-ok">
          {t('screen.horse.arena.championLine', { name: champion.name })}
          {runnerUp ? (
            <>
              {' · '}
              {t('screen.horse.arena.runnerUpLine', { name: runnerUp.name })}
            </>
          ) : null}
        </p>
      ) : null}

      {pair.length === 2 ? <ArenaPit left={pair[0]!.name} right={pair[1]!.name} /> : null}

      {tournament.status !== 'semi_betting' && finalists.length > 0 ? (
        <section className="hr-section" aria-labelledby={`final-${tournament.id}`}>
          <h2 className="bb-eyebrow" id={`final-${tournament.id}`}>
            {t('screen.horse.arena.final')}
          </h2>
          <ul className="hr-fighters">
            {finalists.map((f) => (
              <FighterRow key={f.id} tournament={tournament} fighter={f} onBet={onBet} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="hr-muted">{t('screen.horse.arena.finalTbd')}</p>
      )}

      <section className="hr-section" aria-labelledby={`semi-${tournament.id}`}>
        <h2 className="bb-eyebrow" id={`semi-${tournament.id}`}>
          {t('screen.horse.arena.semis')}
        </h2>
        {groups(tournament.fighters).map(([group, fighters]) => (
          <div key={group} className="hr-group">
            <h3 className="hr-group__title">{t('screen.horse.arena.group', { n: group })}</h3>
            <ul className="hr-fighters">
              {fighters.map((f) => (
                <FighterRow key={f.id} tournament={tournament} fighter={f} onBet={onBet} />
              ))}
            </ul>
          </div>
        ))}
      </section>

      {tournament.myBets.length > 0 ? (
        <section className="hr-section" aria-labelledby={`bets-${tournament.id}`}>
          <h2 className="bb-eyebrow" id={`bets-${tournament.id}`}>
            {t('screen.horse.arena.myBets')}
          </h2>
          <ul className="hr-tickets">
            {tournament.myBets.map((b, i) => (
              <li key={i} className="hr-ticket">
                <span>
                  {t('screen.horse.arena.myBetLine', {
                    name: byId.get(b.fighterId)?.name ?? '',
                    amount: formatPelica(locale, b.amount),
                  })}
                </span>
                <span className="hr-ticket__state">
                  {b.payout === null ? null : b.payout > 0 ? (
                    <Tag hue="green" solid>
                      {t('screen.horse.arena.paid', { amount: formatNumber(locale, b.payout) })}
                    </Tag>
                  ) : (
                    <Tag hue="red">{t('screen.horse.arena.missed')}</Tag>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function BetDialog({
  tournament,
  fighter,
  today,
  onClose,
  onDone,
}: {
  tournament: ArenaTournament;
  fighter: ArenaFighter;
  today: ArenaToday;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const api = useHorseApi();
  const sfx = useSfx();
  const runner = useRunner();
  const [text, setText] = useState('500');
  const amount = Number(text);
  const valid = Number.isInteger(amount) && amount >= today.minStake && amount <= today.maxStake;
  const place = async () => {
    const res = await runner.run(
      () => api.arenaBet({ tournamentId: tournament.id, fighterId: fighter.id, amount }, newKey()),
      'screen.horse.arena.betOk',
    );
    if (res) {
      sfx.play('chip');
      applyBalance(res.balance);
      onDone();
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('screen.horse.arena.bet', { name: fighter.name })}
      description={t('screen.horse.arena.betHelp')}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!valid || runner.busy} onClick={() => void place()}>
            {t('screen.horse.arena.betConfirm')}
          </Button>
        </>
      }
    >
      <div className="hr-stack">
        <p className="hr-muted">
          {t('screen.horse.arena.odds', { odds: formatOddsHundredths(fighter.oddsHundredths) })} ·{' '}
          {t('screen.horse.arena.weapon', { pct: fighter.weaponPercent })}
        </p>
        <TextField
          label={t('screen.horse.arena.betAmount', {
            min: formatNumber(locale, today.minStake),
            max: formatNumber(locale, today.maxStake),
          })}
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
        />
        <ChipGroup label={t('screen.horse.bet.stake')} className="hr-presets">
          {PRESETS.map((p) => (
            <Chip key={p} selected={amount === p} onClick={() => setText(String(p))}>
              {formatNumber(locale, p)}
            </Chip>
          ))}
        </ChipGroup>
        <ErrorNote error={runner.error} />
      </div>
    </Dialog>
  );
}

/** Underground arena: today's duel and royale brackets, bets on fighters, results. */
export function ArenaScreen() {
  const t = useT();
  const api = useHorseApi();
  const today = useResource(() => api.arena(), [api]);
  const [format, setFormat] = useState<'duel' | 'royale'>('duel');
  const [betting, setBetting] = useState<{ tournamentId: number; fighter: ArenaFighter } | null>(
    null,
  );
  const { reload } = today;
  useEffect(() => {
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  let body;
  if (today.error && !today.data) body = <LoadFailed onRetry={() => void reload()} />;
  else if (!today.data) body = <Loading />;
  else if (today.data.tournaments.length === 0)
    body = <p className="hr-muted">{t('screen.horse.arena.empty')}</p>;
  else {
    const data = today.data;
    body = (
      <Tabs
        label={t('screen.horse.arena.formatLabel')}
        activeId={format}
        onChange={(id) => setFormat(id as 'duel' | 'royale')}
        tabs={(['duel', 'royale'] as const).map((f) => {
          const tournament = data.tournaments.find((x) => x.format === f);
          return {
            id: f,
            label: t(`screen.horse.arena.format.${f}`),
            disabled: !tournament,
            panel: tournament ? (
              <TournamentView
                tournament={tournament}
                onBet={(fighter) => setBetting({ tournamentId: tournament.id, fighter })}
              />
            ) : null,
          };
        })}
      />
    );
  }
  const tournament = today.data?.tournaments.find((x) => x.id === betting?.tournamentId);
  return (
    <section className="hr-screen" data-screen="arena" aria-labelledby="arena-title">
      <header className="hr-head">
        <GameIcon name="sword" className="hr-head__icon" />
        <h1 id="arena-title">{t('screen.horse.arena.title')}</h1>
      </header>
      <p>{t('screen.horse.arena.intro')}</p>
      {body}
      {betting && tournament && today.data ? (
        <BetDialog
          tournament={tournament}
          fighter={tournament.fighters.find((f) => f.id === betting.fighter.id) ?? betting.fighter}
          today={today.data}
          onClose={() => setBetting(null)}
          onDone={() => {
            setBetting(null);
            void reload();
          }}
        />
      ) : null}
    </section>
  );
}

export default ArenaScreen;
