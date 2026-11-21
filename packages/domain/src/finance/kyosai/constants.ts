import { RATE_NANO_SCALE } from '../math.ts';

/**
 * Teiai Kyosai (`/共済`) constants.
 * Mirrors `catalogs/teiai.yaml` (`kyosai`) with integer units, Pelica, and basis points.
 */
export const KYOSAI_CONSTANTS = {
  /** Fixed guild supply: 10,000 units (1 unit = 0.01%), never minted or burned. */
  totalUnits: 10_000,
  /** Target reserve ratio buffer before surplus dividends: 30%. */
  targetRatioBps: 3_000,
  /** Daily dividend share of surplus: 5%. */
  dividendShareBps: 500,
  /** Daily dividend pool cap per guild. */
  dividendCap: 50_000,
  /** Liquidity gate reserve ratio threshold: 20%. */
  gateRatioBps: 2_000,
  /** Dormant unit recovery inactivity threshold in days. */
  dormantDays: 30,
  /** House units offered per auction lot. */
  auctionLot: 100,
  /** Auction duration in hours. */
  auctionHours: 24,
  /** Minimum first bid in Pelica. */
  auctionMinBid: 1,
  /** P2P unit transfer offer expiry in hours. */
  offerHours: 24,
  /** Governance motion voting period in hours. */
  motionHours: 24,
  /** Maximum technical trust premium: 1.0/day = 100%/day = 1e9 nano. */
  premiumLimitNano: RATE_NANO_SCALE,
  /** Quorum: yes votes must be >= 25% of circulating units. */
  motionMinYesShareBps: 2_500,
  /** Minimum units held to propose a governance motion: 100 (1% of supply). */
  motionMinUnits: 100,
  /** Max concurrent open motions per proposer. */
  motionMaxOpenPerUser: 1,
  /** Cooldown between motions from the same proposer, in hours. */
  motionCooldownHours: 6,
  /** P2P unit transfer fee: 5% (same as player market). */
  transferFeeBps: 500,
  /** Shared 24h unordered pair transfer cap with Player Market. */
  pairDailyLimit: 100_000,
  /** Sentinel holder key for house units in pure Hamilton splits. */
  houseKey: '0',
} as const;

export type KyosaiAuctionStatus = 'open' | 'sold' | 'unsold';
export type KyosaiOfferStatus = 'open' | 'done' | 'cancelled';
export type KyosaiMotionStatus = 'open' | 'passed' | 'rejected';
