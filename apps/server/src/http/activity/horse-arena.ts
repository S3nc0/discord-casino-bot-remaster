import { FINAL_HOUR, MAX_STAKE, MIN_STAKE, SEMI_HOUR, weaponBonus } from '@casino/domain/arena';
import { dayFromIso, dayStartMs } from '@casino/domain/progression';
import {
  ARENA_ROUTES,
  ArenaBetRequest,
  type ArenaBetResponse,
  type ArenaFighter,
  type ArenaToday,
  type ArenaTournament,
} from '@casino/shared';
import type { ActivityKit } from './context.ts';

const HOUR = 3_600_000;

/** Today's duel and royale brackets, and bets on their fighters. */
export function registerArenaRoutes(kit: ActivityKit): void {
  const { app } = kit;
  const arena = () => kit.services.games.arena;

  app.get(ARENA_ROUTES.today, (request): ArenaToday => {
    const session = kit.session(request);
    const offset = kit.services.offsetHours;
    // The 30 s job hosts the day; a server started later heals it here (INSERT OR IGNORE).
    if (arena().today(session.gid).length === 0) arena().ensureToday(session.gid);
    const tournaments = arena()
      .today(session.gid)
      .map(({ tournament: t, fighters }): ArenaTournament => {
        const bets = arena().betsOf(session.gid, t.id, session.sub);
        const openStage = t.status === 'final_betting' ? 'final' : 'semi';
        const start = dayStartMs(dayFromIso(t.day), offset);
        return {
          id: t.id,
          format: t.format,
          day: t.day,
          status: t.status,
          championId: t.champion_id,
          fighters: fighters.map((f): ArenaFighter => ({
            id: f.id,
            name: f.name,
            basePower: f.base_power,
            group: f.group_no,
            stage: f.stage,
            result: f.result,
            betTotal: f.bet_total,
            weaponPercent: Math.round(weaponBonus(f.bet_total) * 100),
            oddsHundredths: t.status === 'done' || f.stage === 'out' ? 0 : f.oddsHundredths,
            myStake: bets
              .filter((b) => b.fighterId === f.id && b.stage === openStage)
              .reduce((sum, b) => sum + b.amount, 0),
          })),
          myBets: bets,
          semiAt: start + SEMI_HOUR * HOUR,
          finalAt: start + FINAL_HOUR * HOUR,
        };
      });
    return {
      now: kit.clock.now(),
      balance: kit.economy.getBalance(session.gid, session.sub),
      minStake: MIN_STAKE,
      maxStake: MAX_STAKE,
      tournaments,
    };
  });

  app.post(ARENA_ROUTES.bet, (request): ArenaBetResponse => {
    const session = kit.writer(request);
    const { idempotencyKey, ...intent } = kit.body(ArenaBetRequest, request);
    const { replayed } = kit.idem.run(
      { guildId: session.gid, userId: session.sub },
      idempotencyKey,
      'arena:bet',
      intent,
      () => {
        arena().bet({
          guildId: session.gid,
          userId: session.sub,
          tournamentId: intent.tournamentId,
          fighterId: intent.fighterId,
          amount: intent.amount,
          idempotencyKey,
        });
        return {};
      },
    );
    return { replayed, balance: kit.economy.getBalance(session.gid, session.sub) };
  });
}
