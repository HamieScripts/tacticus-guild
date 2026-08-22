import { KNOWN_TILE_BONUSES, MAX_TOKEN_SCORE, TILE_SCORES, type ZoneType } from './tile-scores';

export interface ScoreSplit {
  readonly core: number;
  readonly bonus: number;
}

// The POC's fallback list also carried 30000, but tile-scores.js always overrode it, so it was dead.
const FALLBACK_BONUSES = KNOWN_TILE_BONUSES;

/** Splits a raw battle score into the token-capped core and the zone-capture bonus. */
export function getCoreScore(value: number, zoneType?: string | null): ScoreSplit {
  const numericValue = Number(value) || 0;
  if (numericValue <= MAX_TOKEN_SCORE) {
    return { core: numericValue, bonus: 0 };
  }

  const mappedBonus = TILE_SCORES[zoneType as ZoneType] ?? 0;
  if (mappedBonus > 0) {
    const mappedCore = numericValue - mappedBonus;
    if (mappedCore >= 0 && mappedCore <= MAX_TOKEN_SCORE) {
      return { core: mappedCore, bonus: mappedBonus };
    }
  }

  for (const bonus of FALLBACK_BONUSES) {
    const core = numericValue - bonus;
    if (core >= 0 && core <= MAX_TOKEN_SCORE) {
      return { core, bonus };
    }
  }

  const fallbackCore = Math.min(numericValue, MAX_TOKEN_SCORE);
  return { core: fallbackCore, bonus: Math.max(numericValue - fallbackCore, 0) };
}
