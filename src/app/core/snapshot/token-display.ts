import { getCoreScore } from '../scoring/score-splitter';
import { MAX_TOKEN_SCORE } from '../scoring/tile-scores';
import { isPlayedToken, type PlayerSnapshot, type Token } from './build-snapshot';

export type TokenOutcome = 'win' | 'defeat' | 'abandoned' | 'unused';
export type ScoreTier = 'gold' | 'silver' | 'bronze' | null;

const SCORE_TIER_SILVER = 1400;
const SCORE_TIER_BRONZE = 1200;

export function getTokenOutcome(token: Token): TokenOutcome {
  if (!isPlayedToken(token)) return 'unused';
  if (token.abandoned) return 'abandoned';
  if (!token.hasScore || token.defended) return 'defeat';
  return 'win';
}

export function getScoreTier(token: Token): ScoreTier {
  if (!isPlayedToken(token) || token.abandoned || !token.hasScore) return null;

  const { core } = getCoreScore(token.score);
  if (core >= MAX_TOKEN_SCORE) return 'gold';
  if (core >= SCORE_TIER_SILVER) return 'silver';
  if (core >= SCORE_TIER_BRONZE) return 'bronze';
  return null;
}

export type LeaderboardSortKey = 'score' | 'average' | 'rating';
export type SortDirection = 'asc' | 'desc';

export interface LeaderboardSort {
  readonly key: LeaderboardSortKey;
  readonly direction: SortDirection;
}

export const DEFAULT_LEADERBOARD_SORT: LeaderboardSort = { key: 'score', direction: 'desc' };

function sortValue(player: PlayerSnapshot, key: LeaderboardSortKey): number {
  if (key === 'score') return player.totalScore;
  if (key === 'average') return player.averageScore;
  return player.totalSkillRating;
}

export function sortPlayers(
  players: readonly PlayerSnapshot[],
  sort: LeaderboardSort,
): readonly PlayerSnapshot[] {
  const direction = sort.direction === 'asc' ? 1 : -1;

  return [...players].sort((a, b) => {
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);
    if (left === right) return a.name.localeCompare(b.name) * direction;
    return (left - right) * direction;
  });
}

/** Card layout leads with played tokens, highest first. */
export function orderTokensForCards(tokens: readonly Token[]): readonly Token[] {
  return [...tokens].sort((a, b) => {
    const aUsed = isPlayedToken(a) && !a.abandoned;
    const bUsed = isPlayedToken(b) && !b.abandoned;
    if (aUsed !== bUsed) return aUsed ? -1 : 1;
    return b.score - a.score;
  });
}
