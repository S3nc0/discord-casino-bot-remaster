import { shuffle } from '@casino/shared';
import {
  authorDiff,
  authorPayout,
  DAILY_LIMIT,
  entitled,
  MAX_EXPLANATION_LEN,
  MAX_QUESTION_LEN,
  MIN_GAMES_FOR_REWARD,
  OPEN_LIMIT,
  parseBulk,
  USER_DEFAULT_MINUTES,
  USER_MAX_MINUTES,
  USER_MIN_MINUTES,
  validateChoices,
  type AuthorPayout,
} from '@casino/domain/quiz';
import { chargeOrOwe, creditIncome, GameRuleError, type GamesCtx } from '../progression/context.ts';

interface QuizRow {
  id: number;
  guild_id: string | null;
  author_id: string | null;
  question: string;
  choices: string;
  answer: number;
  explanation: string;
  reward: number;
  expires_at: number | null;
  earned: number;
  settled: number;
  created_at: number;
}

export interface QuizView {
  id: number;
  guildId: string | null;
  authorId: string | null;
  question: string;
  choices: string[];
  reward: number;
  expiresAt: number | null;
  settled: boolean;
}

export interface AnswerResult {
  correct: boolean;
  /** Index of the right choice (shown after answering). */
  answer: number;
  explanation: string;
  /** Reward paid to the answerer (0 when blocked or wrong). */
  reward: number;
  /** True when the answerer has not played enough games to be rewarded. */
  rewardBlocked: boolean;
}

/** User-authored and official quizzes. The author pays the rewards and earns from participation. */
export class QuizService {
  private readonly ctx: GamesCtx;
  /** Games a player must have played before a user quiz pays them (and counts for the author). */
  private readonly gamesPlayed: (guildId: string, userId: string) => number;

  constructor(ctx: GamesCtx, gamesPlayed: (guildId: string, userId: string) => number) {
    this.ctx = ctx;
    this.gamesPlayed = gamesPlayed;
  }

  private row(id: number): QuizRow {
    const q = this.ctx.store.stmt('SELECT * FROM quiz_questions WHERE id = ?').get(id) as
      QuizRow | undefined;
    if (!q) throw new GameRuleError('quiz_not_found', {}, 'not_found');
    return q;
  }

  private view(q: QuizRow): QuizView {
    return {
      id: q.id,
      guildId: q.guild_id,
      authorId: q.author_id,
      question: q.question,
      choices: JSON.parse(q.choices) as string[],
      reward: q.reward,
      expiresAt: q.expires_at,
      settled: q.settled === 1,
    };
  }

  /** Post a user quiz: `choices[0]` is the right answer, the order shown is shuffled. */
  post(input: {
    guildId: string;
    authorId: string;
    question: string;
    choices: string[];
    explanation?: string;
    reward: number;
    minutes?: number;
  }): QuizView {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      ctx.economy.ensureMember(input.guildId, input.authorId);
      const question = input.question.trim();
      if (question.length === 0 || [...question].length > MAX_QUESTION_LEN)
        throw new GameRuleError('quiz_question_invalid', {}, 'invalid_payload');
      const bad = validateChoices(input.choices);
      if (bad) throw new GameRuleError(bad, {}, 'invalid_payload');
      if ([...(input.explanation ?? '')].length > MAX_EXPLANATION_LEN)
        throw new GameRuleError('quiz_explanation_long', {}, 'invalid_payload');
      const minutes = input.minutes ?? USER_DEFAULT_MINUTES;
      if (!Number.isInteger(minutes) || minutes < USER_MIN_MINUTES || minutes > USER_MAX_MINUTES)
        throw new GameRuleError('quiz_minutes', { max: USER_MAX_MINUTES }, 'invalid_payload');
      if (!Number.isInteger(input.reward) || input.reward < 1)
        throw new GameRuleError('quiz_reward_invalid', {}, 'invalid_payload');
      if (ctx.teiai.debtOf(input.guildId, input.authorId) > 0)
        throw new GameRuleError('debt_blocks');
      const now = ctx.clock.now();
      const open = (
        ctx.store
          .stmt(
            'SELECT COUNT(*) AS n FROM quiz_questions WHERE guild_id = ? AND author_id = ? AND settled = 0',
          )
          .get(input.guildId, input.authorId) as { n: number }
      ).n;
      if (open >= OPEN_LIMIT) throw new GameRuleError('open_limit', { limit: OPEN_LIMIT });
      const day = (
        ctx.store
          .stmt(
            'SELECT COUNT(*) AS n FROM quiz_questions WHERE guild_id = ? AND author_id = ? AND created_at > ?',
          )
          .get(input.guildId, input.authorId, now - 86_400_000) as { n: number }
      ).n;
      if (day >= DAILY_LIMIT) throw new GameRuleError('daily_limit', { limit: DAILY_LIMIT });
      const balance = ctx.economy.getBalance(input.guildId, input.authorId);
      if (balance < input.reward)
        throw new GameRuleError(
          'insufficient_balance',
          { reward: input.reward },
          'insufficient_funds',
        );
      const right = input.choices[0] as string;
      const shown = shuffle(
        ctx.rng,
        input.choices.map((c) => c.trim()),
      );
      const info = ctx.store
        .stmt(
          'INSERT INTO quiz_questions (guild_id, author_id, question, choices, answer, explanation, reward, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          input.guildId,
          input.authorId,
          question,
          JSON.stringify(shown),
          shown.indexOf(right.trim()),
          input.explanation ?? '',
          input.reward,
          now + minutes * 60_000,
          now,
        );
      return this.view(this.row(Number(info.lastInsertRowid)));
    });
  }

  /** Admin: import an all-or-nothing batch of official quizzes (global, system-paid). */
  importOfficial(text: string): { imported: number; errors: string[] } {
    const { ctx } = this;
    const parsed = parseBulk(text);
    if (parsed.errors.length > 0) return { imported: 0, errors: parsed.errors };
    return ctx.store.transaction(() => {
      const known = new Set(
        (
          ctx.store.stmt('SELECT question FROM quiz_questions WHERE author_id IS NULL').all() as {
            question: string;
          }[]
        ).map((r) => r.question),
      );
      const dup = parsed.questions
        .filter((q) => known.has(q.question))
        .map((q) => `すでに登録済みの問題です: ${q.question.slice(0, 20)}`);
      if (dup.length > 0) return { imported: 0, errors: dup };
      const now = ctx.clock.now();
      for (const q of parsed.questions) {
        const shown = shuffle(ctx.rng, q.choices);
        ctx.store
          .stmt(
            'INSERT INTO quiz_questions (guild_id, author_id, question, choices, answer, explanation, reward, expires_at, created_at) VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            q.question,
            JSON.stringify(shown),
            shown.indexOf(q.choices[0] as string),
            q.explanation,
            q.reward,
            q.minutes === null ? null : now + q.minutes * 60_000,
            now,
          );
      }
      return { imported: parsed.questions.length, errors: [] };
    });
  }

  /** Admin: add one official quiz (`/admin quiz add`); `choices[0]` is the right answer. */
  addOfficial(input: {
    question: string;
    choices: string[];
    explanation?: string;
    reward?: number;
    minutes?: number | null;
  }): QuizView {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      const question = input.question.trim();
      if (question.length === 0 || [...question].length > MAX_QUESTION_LEN)
        throw new GameRuleError('quiz_question_invalid', {}, 'invalid_payload');
      const bad = validateChoices(input.choices);
      if (bad) throw new GameRuleError(bad, {}, 'invalid_payload');
      if ([...(input.explanation ?? '')].length > MAX_EXPLANATION_LEN)
        throw new GameRuleError('quiz_explanation_long', {}, 'invalid_payload');
      const reward = input.reward ?? 100;
      if (!Number.isInteger(reward) || reward < 1)
        throw new GameRuleError('quiz_reward_invalid', {}, 'invalid_payload');
      const now = ctx.clock.now();
      const shown = shuffle(
        ctx.rng,
        input.choices.map((c) => c.trim()),
      );
      const info = ctx.store
        .stmt(
          'INSERT INTO quiz_questions (guild_id, author_id, question, choices, answer, explanation, reward, expires_at, created_at) VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          question,
          JSON.stringify(shown),
          shown.indexOf((input.choices[0] as string).trim()),
          input.explanation ?? '',
          reward,
          input.minutes === null || input.minutes === undefined
            ? null
            : now + input.minutes * 60_000,
          now,
        );
      return this.view(this.row(Number(info.lastInsertRowid)));
    });
  }

  /** Admin: every quiz still open (not settled), newest last, with how many answered. */
  listOpen(limit = 25): (QuizView & { answers: number })[] {
    const rows = this.ctx.store
      .stmt('SELECT * FROM quiz_questions WHERE settled = 0 ORDER BY id LIMIT ?')
      .all(limit) as QuizRow[];
    return rows.map((q) => ({
      ...this.view(q),
      answers: (
        this.ctx.store
          .stmt('SELECT COUNT(*) AS n FROM quiz_answers WHERE quiz_id = ?')
          .get(q.id) as { n: number }
      ).n,
    }));
  }

  /** Admin: delete a quiz and its answer history (`/admin quiz delete`). */
  deleteQuiz(quizId: number): void {
    this.ctx.store.transaction(() => {
      this.row(quizId);
      this.ctx.store.stmt('DELETE FROM quiz_answers WHERE quiz_id = ?').run(quizId);
      this.ctx.store.stmt('DELETE FROM quiz_questions WHERE id = ?').run(quizId);
    });
  }

  /** Quizzes this player posted and that are still open, with how many answered and how many were right. */
  authored(
    guildId: string,
    userId: string,
  ): (QuizView & { answers: number; correct: number; earned: number })[] {
    const rows = this.ctx.store
      .stmt(
        'SELECT * FROM quiz_questions WHERE guild_id = ? AND author_id = ? AND settled = 0 ORDER BY id',
      )
      .all(guildId, userId) as QuizRow[];
    return rows.map((q) => {
      const r = this.ctx.store
        .stmt(
          'SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS c FROM quiz_answers WHERE quiz_id = ? AND counted = 1',
        )
        .get(q.id) as { n: number; c: number };
      return { ...this.view(q), answers: r.n, correct: r.c, earned: q.earned };
    });
  }

  /** The oldest open quiz this player has not answered (official ones, or other authors' in this guild). */
  next(guildId: string, userId: string): QuizView | null {
    const q = this.ctx.store
      .stmt(
        `SELECT q.* FROM quiz_questions q WHERE q.settled = 0 AND (q.expires_at IS NULL OR q.expires_at > ?)
           AND (q.author_id IS NULL OR (q.guild_id = ? AND q.author_id != ?))
           AND NOT EXISTS (SELECT 1 FROM quiz_answers a WHERE a.quiz_id = q.id AND a.guild_id = ? AND a.user_id = ?)
         ORDER BY q.id LIMIT 1`,
      )
      .get(this.ctx.clock.now(), guildId, userId, guildId, userId) as QuizRow | undefined;
    return q ? this.view(q) : null;
  }

  answer(guildId: string, userId: string, quizId: number, choice: number): AnswerResult {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      ctx.economy.ensureMember(guildId, userId);
      const q = this.row(quizId);
      const now = ctx.clock.now();
      if (q.settled === 1 || (q.expires_at !== null && now >= q.expires_at))
        throw new GameRuleError('quiz_ended');
      const user = q.author_id !== null;
      if (user && q.guild_id !== guildId) throw new GameRuleError('quiz_wrong_guild');
      if (q.author_id === userId) throw new GameRuleError('quiz_self_answer');
      if (
        ctx.store
          .stmt('SELECT 1 FROM quiz_answers WHERE quiz_id = ? AND guild_id = ? AND user_id = ?')
          .get(quizId, guildId, userId)
      )
        throw new GameRuleError('quiz_already_answered');
      const correct = choice === q.answer;
      const counted = !user || this.gamesPlayed(guildId, userId) >= MIN_GAMES_FOR_REWARD;
      ctx.store
        .stmt(
          'INSERT INTO quiz_answers (quiz_id, guild_id, user_id, choice, correct, counted, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(quizId, guildId, userId, choice, correct ? 1 : 0, counted ? 1 : 0, now);
      let reward = 0;
      if (correct && counted) {
        if (user) {
          // The author pays; what the wallet cannot cover becomes Teiai debt, the answerer is paid in full.
          chargeOrOwe(ctx, {
            guildId,
            userId: q.author_id as string,
            amount: q.reward,
            reason: 'quiz_author_pay',
            why: 'quiz reward payment',
            refType: 'quiz',
            refId: `${quizId}:pay`,
            idempotencyKey: `quiz:${quizId}:pay:${userId}`,
          });
        }
        creditIncome(ctx, {
          guildId,
          userId,
          amount: q.reward,
          reason: 'quiz_reward',
          refType: 'quiz',
          refId: String(quizId),
          idempotencyKey: `quiz:${quizId}:reward`,
        });
        reward = q.reward;
      }
      if (user && counted) this.settleAuthor(q, false);
      return {
        correct,
        answer: q.answer,
        explanation: q.explanation,
        reward,
        rewardBlocked: user && !counted,
      };
    });
  }

  /** Move what the author is entitled to so far (positive pays, negative claws back up to the balance). */
  private settleAuthor(q: QuizRow, final: boolean): AuthorPayout {
    const { ctx } = this;
    const r = ctx.store
      .stmt(
        'SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS c FROM quiz_answers WHERE quiz_id = ? AND counted = 1',
      )
      .get(q.id) as { n: number; c: number };
    const pay = authorPayout(r.n, r.c, q.reward);
    const fresh = this.row(q.id);
    const diff = authorDiff(entitled(pay), fresh.earned);
    const guildId = q.guild_id as string;
    const authorId = q.author_id as string;
    if (diff > 0) {
      creditIncome(ctx, {
        guildId,
        userId: authorId,
        amount: diff,
        reason: 'quiz_author_reward',
        refType: 'quiz',
        refId: String(q.id),
        idempotencyKey: `quiz:${q.id}:author:${r.n}:${fresh.earned}`,
      });
      ctx.store.stmt('UPDATE quiz_questions SET earned = earned + ? WHERE id = ?').run(diff, q.id);
    } else if (diff < 0) {
      const take = Math.min(-diff, ctx.economy.getBalance(guildId, authorId));
      if (take > 0) {
        ctx.economy.debit({
          guildId,
          userId: authorId,
          amount: take,
          reason: 'quiz_author_clawback',
          refType: 'quiz',
          refId: `${q.id}:adjust`,
          idempotencyKey: `quiz:${q.id}:claw:${r.n}:${fresh.earned}`,
        });
        ctx.store
          .stmt('UPDATE quiz_questions SET earned = earned - ? WHERE id = ?')
          .run(take, q.id);
      }
    }
    if (final) ctx.store.stmt('UPDATE quiz_questions SET settled = 1 WHERE id = ?').run(q.id);
    return pay;
  }

  /** Author withdraws the quiz: final settlement now. */
  withdraw(guildId: string, userId: string, quizId: number): void {
    this.ctx.store.transaction(() => {
      const q = this.row(quizId);
      if (q.author_id !== userId || q.guild_id !== guildId)
        throw new GameRuleError('forbidden', {}, 'forbidden');
      if (q.settled === 1) return;
      this.settleAuthor(q, true);
    });
  }

  /** Job (every minute): finalize quizzes whose time is up. */
  settleExpired(): number[] {
    const { ctx } = this;
    const due = ctx.store
      .stmt(
        'SELECT * FROM quiz_questions WHERE settled = 0 AND expires_at IS NOT NULL AND expires_at <= ?',
      )
      .all(ctx.clock.now()) as QuizRow[];
    return due.map((q) =>
      ctx.store.transaction(() => {
        if (q.author_id === null)
          ctx.store.stmt('UPDATE quiz_questions SET settled = 1 WHERE id = ?').run(q.id);
        else this.settleAuthor(q, true);
        return q.id;
      }),
    );
  }
}
