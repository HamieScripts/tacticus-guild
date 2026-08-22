/**
 * Bonus per zone type. Values are derived from observed scores across all captured wars: a zone's
 * maximum score is its bonus plus the 1600 token cap.
 *
 * Cross-check: these 15 zones appear twice on a map (the POC counts "tiles cleared" out of 30), and
 * the values below sum to 260,000 - exactly half of the 520,000 the POC used for a full map.
 */
export const TILE_SCORES = {
  // Max observed 11600
  Trenches1: 10000,
  Trenches2: 10000,
  Trenches3: 10000,
  // Max observed 17600
  AntiAirBattery: 16000,
  Armoury: 16000,
  ArtilleryPosition1: 16000,
  ArtilleryPosition2: 16000,
  Bunker1: 16000,
  Bunker2: 16000,
  LandingPad1: 16000,
  LandingPad2: 16000,
  MedicaeStation1: 16000,
  MedicaeStation2: 16000,
  // Max observed 31600
  SupplyDepot: 30000,
  // Max observed 41600
  HQ: 40000,
} as const;

export const KNOWN_TILE_BONUSES: readonly number[] = [10000, 16000, 30000, 40000];

const TILES_PER_MAP = 2;

/** Sum of every tile bonus on a full war map, both sides. */
export const POSSIBLE_TILE_SCORE =
  Object.values(TILE_SCORES).reduce((sum, bonus) => sum + bonus, 0) * TILES_PER_MAP;

export const MAX_TOKEN_SCORE = 1600;

export const TOKEN_SLOTS_PER_PLAYER = 10;

/** Zone types with a confirmed tile bonus. */
export type ZoneType = keyof typeof TILE_SCORES;
