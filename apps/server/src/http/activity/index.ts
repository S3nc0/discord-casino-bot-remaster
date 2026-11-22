import type { FastifyInstance } from 'fastify';
import { registerCasinoRoutes, type CasinoHttpDeps, type SessionOf } from './casino.ts';
import { createActivityKit, type ActivityKitDeps } from './context.ts';
import { registerHorseRoutes } from './horse.ts';

export type { ActivityKit, ActivityKitDeps, ActivityServices } from './context.ts';

/** Services the Activity routes of each slice need. Each slice adds its own optional entry. */
export interface ActivityDeps {
  casino?: CasinoHttpDeps;
  horse?: ActivityKitDeps;
}

/**
 * The one place the Activity slices plug their authenticated routes into the app. A slice adds
 * one line here and one optional entry in `ActivityDeps`.
 */
export function registerActivityRoutes(
  authed: FastifyInstance,
  deps: ActivityDeps,
  sessionOf: SessionOf,
): void {
  if (deps.casino) registerCasinoRoutes(authed, deps.casino, sessionOf);
  if (deps.horse) registerHorseRoutes(createActivityKit(authed, deps.horse, sessionOf));
}
