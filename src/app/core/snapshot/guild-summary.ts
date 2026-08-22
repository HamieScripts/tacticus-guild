import { MAX_TOKEN_SCORE, TOKEN_SLOTS_PER_PLAYER } from '../scoring/tile-scores';
import { isPlayedToken, type GuildSnapshot, type PlayerSnapshot, type Token } from './build-snapshot';

export interface GuildSummary {
  readonly teamIndex: number;
  readonly name: string;
  readonly totalPlayers: number;
  readonly totalTokenSlots: number;
  readonly usedTokens: number;
  readonly remainingTokens: number;
  readonly tokenScore: number;
  readonly tileScore: number;
  readonly currentTotal: number;
  readonly avgPerUsedToken: number;
  readonly projectedTokenGain: number;
  readonly projectedTokenScore: number;
  readonly projectedFinal: number;
  readonly totalWins: number;
  readonly totalCleanupWins: number;
  readonly totalDefeats: number;
  readonly totalAbandoned: number;
  readonly totalUnused: number;
  readonly tilesCleared: number;
}

function isWin(token: Token): boolean {
  return isPlayedToken(token) && !token.abandoned && token.hasScore && !token.defended && token.score > 0;
}

/** A guild fields at most 30 players, so slots are capped rather than counted. */
const MAX_PLAYERS_PER_GUILD = 30;

export function summarizeGuild(guild: GuildSnapshot): GuildSummary {
  const players: readonly PlayerSnapshot[] = guild.players;
  const tokens = players.flatMap((player) => player.tokens);

  const totalPlayers = Math.min(players.length, MAX_PLAYERS_PER_GUILD);
  const totalTokenSlots = totalPlayers * TOKEN_SLOTS_PER_PLAYER;
  const usedTokens = players.reduce((sum, player) => sum + player.usedTokens, 0);
  const remainingTokens = Math.max(totalTokenSlots - usedTokens, 0);

  const tokenScore = players.reduce((sum, player) => sum + player.totalScore, 0);
  const tileScore = players.reduce((sum, player) => sum + player.tileScore, 0);
  const currentTotal = tokenScore + tileScore;

  const avgPerUsedToken = usedTokens > 0 ? tokenScore / usedTokens : 0;
  const projectedTokenGain = Math.round(remainingTokens * Math.min(avgPerUsedToken, MAX_TOKEN_SCORE));

  const counted = tokens.filter((token) => isPlayedToken(token) && !token.abandoned);

  return {
    teamIndex: guild.teamIndex,
    name: guild.name,
    totalPlayers,
    totalTokenSlots,
    usedTokens,
    remainingTokens,
    tokenScore,
    tileScore,
    currentTotal,
    avgPerUsedToken,
    projectedTokenGain,
    projectedTokenScore: tokenScore + projectedTokenGain,
    projectedFinal: currentTotal + projectedTokenGain,
    totalWins: counted.filter(isWin).length,
    totalCleanupWins: counted.filter((t) => isWin(t) && isPlayedToken(t) && t.cleanup).length,
    totalDefeats: counted.filter((t) => !isWin(t)).length,
    totalAbandoned: tokens.filter((t) => t.abandoned).length,
    totalUnused: tokens.filter((t) => !isPlayedToken(t)).length,
    tilesCleared: players.reduce((sum, player) => sum + player.tilesCleared, 0),
  };
}

/** Our guild first, then the guild being viewed, then by projected score. */
export function orderGuildSummaries(
  summaries: readonly GuildSummary[],
  activeTeamIndex: number | null,
  homeGuildMatch = 'praetorians',
): readonly GuildSummary[] {
  return [...summaries].sort((a, b) => {
    const aHome = a.name.toLowerCase().includes(homeGuildMatch);
    const bHome = b.name.toLowerCase().includes(homeGuildMatch);
    if (aHome !== bHome) return aHome ? -1 : 1;

    const aActive = a.teamIndex === activeTeamIndex;
    const bActive = b.teamIndex === activeTeamIndex;
    if (aActive !== bActive) return aActive ? -1 : 1;

    return b.projectedTokenScore - a.projectedTokenScore;
  });
}
