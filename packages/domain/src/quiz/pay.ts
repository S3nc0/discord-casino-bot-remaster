import { roundHalfEven } from '../progression/time.ts';

export const MIN_PARTICIPANTS = 2;
export const MIN_GAMES_FOR_REWARD = 3;
export const OPEN_LIMIT = 2;
export const DAILY_LIMIT = 3;
export const BASE_REWARD = 100;
export const MAX_BONUS = 200;
export const TARGET_RATE = 0.4;
export const REWARD_SCALE_BASE = 100;
export const PARTICIPATION_RATE = 1.0;
export const MAX_QUESTIONS = 30;
export const MAX_QUESTION_LEN = 500;
export const MAX_CHOICE_LEN = 80;
export const MAX_EXPLANATION_LEN = 800;
export const MAX_VERDICT_LEN = 20;
export const USER_MIN_MINUTES = 1;
export const USER_MAX_MINUTES = 10_080;
export const USER_DEFAULT_MINUTES = 4320;
export const MAX_MINUTES = 525_600;
export const DEFAULT_REWARD = 100;

/** Accuracy proximity: 1 at 40 % correct, falling linearly to 0 at 0 % and at 80 % or more. */
export function accuracyFactor(participants: number, correct: number): number {
  if (participants <= 0) return 0;
  return Math.max(0, 1 - Math.abs(correct / participants - TARGET_RATE) / TARGET_RATE);
}

/** Reward scale: `sqrt(reward / 100)`. */
export function rewardScale(reward: number): number {
  return Math.sqrt(Math.max(reward, 0) / REWARD_SCALE_BASE);
}

export interface AuthorPayout {
  base: number;
  bonus: number;
  participation: number;
}

/** What the author of a user quiz is entitled to so far. `n` counts eligible answerers only. */
export function authorPayout(participants: number, correct: number, reward: number): AuthorPayout {
  if (participants < MIN_PARTICIPANTS) return { base: 0, bonus: 0, participation: 0 };
  const f = accuracyFactor(participants, correct);
  const m = rewardScale(reward);
  return {
    base: roundHalfEven(BASE_REWARD * m),
    bonus: roundHalfEven(MAX_BONUS * f * m),
    participation: roundHalfEven(f * PARTICIPATION_RATE * reward * participants),
  };
}

export function entitled(p: AuthorPayout): number {
  return p.base + p.bonus + p.participation;
}

/** Pelica to move to the author after an answer: positive pays, negative is clawed back. */
export function authorDiff(entitledNow: number, earnedSoFar: number): number {
  return entitledNow - earnedSoFar;
}

/** Shuffle-free check that a four-choice quiz is valid. */
export function validateChoices(choices: readonly string[]): string | null {
  if (choices.length !== 4) return 'choices_need_four';
  const trimmed = choices.map((c) => c.trim());
  if (trimmed.some((c) => c.length === 0)) return 'choice_empty';
  if (new Set(trimmed).size !== 4) return 'choice_duplicate';
  if (trimmed.some((c) => [...c].length > MAX_CHOICE_LEN)) return 'choice_too_long';
  return null;
}
