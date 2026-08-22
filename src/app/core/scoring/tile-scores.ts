export const TILE_SCORES = {
  // Trenches: 10k bonus
  Trenches1: 10000,
  Trenches2: 10000,
  Trenches3: 10000,
  // Bunkers, Artillery, Landing Pads, Anti-Air: 16k bonus (confirmed from live data)
  Bunker1: 16000,
  Bunker2: 16000,
  Bunker3: 16000,
  ArtilleryPosition1: 16000,
  ArtilleryPosition2: 16000,
  LandingPad1: 16000,
  LandingPad2: 16000,
  AntiAirBattery: 16000,
  // Medicae Stations and HQ: bonus unconfirmed, fallback matches via KNOWN_TILE_BONUSES
  MedicaeStation1: 40000,
  MedicaeStation2: 40000,
  HQ: 40000,
} as const;

export const KNOWN_TILE_BONUSES: readonly number[] = [10000, 16000, 40000];

/** Sum of all tile bonuses on a full war map (approximate; update when tile layout is confirmed). */
export const POSSIBLE_TILE_SCORE = 520000;

export const MAX_TOKEN_SCORE = 1600;

export const TOKEN_SLOTS_PER_PLAYER = 10;

/** Zone types with a confirmed or assumed tile bonus. */
export type ZoneType = keyof typeof TILE_SCORES;
