import type {
  ActivityLog,
  BattleFinishedLog,
  BattleUnit,
  Buff,
  GuildData,
  PlayerData,
  WarSnapshot,
} from '../models/war-snapshot.model';
import { isBattleFinished } from '../models/war-snapshot.model';
import { getCoreScore } from '../scoring/score-splitter';
import { calculateSkillRating, isEasyGameBattle } from '../scoring/skill-rating';
import { TOKEN_SLOTS_PER_PLAYER } from '../scoring/tile-scores';
import { getPrimaryEventResponseData } from './primary-event';

export interface TokenEntry {
  readonly score: number;
  readonly tileScore: number;
  readonly skillRating: number;
  readonly abandoned: boolean;
  readonly defended: boolean;
  readonly cleanup: boolean;
  readonly hasScore: boolean;
  readonly easyGame: boolean;
  readonly buffs: readonly Buff[];
}

/** An unplayed token slot; distinguished from a played one by the absence of hasScore. */
export interface EmptyToken {
  readonly score: 0;
  readonly abandoned: false;
}

export type Token = TokenEntry | EmptyToken;

export interface PlayerSnapshot {
  readonly userId: string;
  readonly name: string;
  readonly avatarUnitId: string | null;
  readonly avatarFrameId: string | null;
  readonly tokens: readonly Token[];
  readonly usedTokens: number;
  readonly totalScore: number;
  readonly averageScore: number;
  readonly tilesCleared: number;
  readonly tileScore: number;
  readonly totalSkillRating: number;
}

export interface BattleRecord {
  readonly id: string;
  readonly createdOn: number;
  readonly zoneType: string | null;
  readonly attackerUserId: string | null;
  readonly attackerName: string;
  readonly attackerAvatarUnitId: string | null;
  readonly defenderUserId: string | null;
  readonly defenderName: string;
  readonly defenderAvatarUnitId: string | null;
  readonly attackerTeamIndex: number;
  readonly defenderTeamIndex: number | null;
  readonly hasScore: boolean;
  readonly abandoned: boolean;
  readonly defended: boolean;
  readonly cleanup: boolean;
  readonly easyGame: boolean;
  readonly score: number;
  readonly attackerUnits: readonly BattleUnit[];
  readonly defenderUnits: readonly BattleUnit[];
  readonly attackerMachineOfWar: BattleUnit | null;
  readonly defenderMachineOfWar: BattleUnit | null;
}

export interface GuildSnapshot {
  readonly teamIndex: number;
  readonly name: string;
  readonly players: readonly PlayerSnapshot[];
  readonly battles: readonly BattleRecord[];
}

export function isPlayedToken(token: Token): token is TokenEntry {
  return Object.prototype.hasOwnProperty.call(token, 'hasScore');
}

export interface BattleFlags {
  readonly defended: boolean;
  readonly cleanup: boolean;
}

export function getBattleFlags(log: BattleFinishedLog): BattleFlags {
  const defenderUnits = log.defender?.units ?? [];
  const defended = defenderUnits.some((unit) =>
    Object.prototype.hasOwnProperty.call(unit, 'remainingHPAfter'),
  );
  const cleanup = defenderUnits.some((unit) => {
    if (!Object.prototype.hasOwnProperty.call(unit, 'remainingHPBefore')) return true;
    return Number(unit.remainingHPBefore ?? 0) < Number(unit.startHPBefore ?? 0);
  });

  return { defended, cleanup };
}

function extractBuffs(log: BattleFinishedLog): readonly Buff[] {
  if (Array.isArray(log.buffs)) return log.buffs;
  if (Array.isArray(log.attacker?.buffs)) return log.attacker.buffs;
  return [];
}

function guildAcronym(name: string | undefined): string {
  return String(name ?? '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

/**
 * Players only appear in a guild bucket once assigned a team. Assignment cascades:
 * battle participation, then guild tag in the display name, then smallest-team balancing.
 */
function assignTeams(
  playerData: readonly PlayerData[],
  activityLogs: readonly ActivityLog[],
  guildData: readonly GuildData[],
  guildTeamIndexes: readonly number[],
): Map<string, number> {
  const userTeamIndex = new Map<string, number>();
  const teamIndexSet = new Set(guildTeamIndexes);

  const assign = (userId: string | undefined, teamIndex: number | null | undefined): void => {
    if (!userId || userTeamIndex.has(userId)) return;
    if (teamIndex === null || teamIndex === undefined || !teamIndexSet.has(teamIndex)) return;
    userTeamIndex.set(userId, teamIndex);
  };

  const opposingTeamIndex = (teamIndex: number): number | null => {
    if (guildTeamIndexes.length !== 2) return null;
    return guildTeamIndexes.find((idx) => idx !== teamIndex) ?? null;
  };

  for (const log of activityLogs) {
    const teamIndex = Number(log?.teamIndex);
    const userId = log?.userId;
    if (!Number.isFinite(teamIndex) || !userId) continue;
    if (!teamIndexSet.has(teamIndex)) continue;
    if (!isBattleFinished(log)) continue;

    assign(userId, teamIndex);

    const defenderUserId = log.defender?.userId;
    const defenderTeam = opposingTeamIndex(teamIndex);
    if (defenderUserId && defenderTeam !== null) {
      assign(defenderUserId, defenderTeam);
    }
  }

  const tagMatchers = guildData.map((guild) => {
    const acronym = guildAcronym(guild.name);
    const tags: string[] = [];
    if (acronym.length >= 2) {
      tags.push(`[${acronym}]`, `〔${acronym}〕`, `(${acronym})`, ` ${acronym} `);
    }
    return { teamIndex: Number(guild.teamIndex), tags };
  });

  const inferTeamFromDisplayName = (displayName: string | undefined): number | null => {
    const haystack = ` ${displayName ?? ''} `.toUpperCase();
    const matches = tagMatchers
      .filter(({ tags }) => tags.some((tag) => haystack.includes(tag.toUpperCase())))
      .map(({ teamIndex }) => teamIndex);
    return matches.length === 1 ? (matches[0] ?? null) : null;
  };

  for (const player of playerData) {
    if (!player?.userId || userTeamIndex.has(player.userId)) continue;
    assign(player.userId, inferTeamFromDisplayName(player.displayName));
  }

  for (const player of playerData) {
    if (!player?.userId || userTeamIndex.has(player.userId)) continue;

    const counts = new Map(guildTeamIndexes.map((teamIndex) => [teamIndex, 0]));
    for (const teamIndex of userTeamIndex.values()) {
      counts.set(teamIndex, (counts.get(teamIndex) ?? 0) + 1);
    }

    const smallestTeamIndex = guildTeamIndexes.reduce<number | null>((smallest, teamIndex) => {
      if (smallest === null) return teamIndex;
      return (counts.get(teamIndex) ?? 0) < (counts.get(smallest) ?? 0) ? teamIndex : smallest;
    }, null);

    assign(player.userId, smallestTeamIndex);
  }

  return userTeamIndex;
}

export function buildSnapshot(data: WarSnapshot | null | undefined): GuildSnapshot[] {
  const eventResponseData = getPrimaryEventResponseData(data);
  const playerData = eventResponseData?.playerData ?? [];
  const activityLogs = eventResponseData?.activityLogs ?? [];
  const guildData = eventResponseData?.guildData ?? [];

  const playerNames = new Map(playerData.map((p) => [p.userId ?? '', p.displayName ?? '']));
  const playerProfiles = new Map(
    playerData.map((p) => [
      p.userId ?? '',
      { avatarUnitId: p.avatarUnitId ?? null, avatarFrameId: p.avatarFrameId ?? null },
    ]),
  );

  const guildTeamIndexes = guildData
    .map((guild) => Number(guild.teamIndex))
    .filter((teamIndex) => Number.isFinite(teamIndex));

  const guildBuckets = new Map<number, Map<string, TokenEntry[]>>();
  const guildBattleLogs = new Map<number, BattleRecord[]>();
  for (const guild of guildData) {
    const teamIndex = Number(guild.teamIndex);
    guildBuckets.set(teamIndex, new Map());
    guildBattleLogs.set(teamIndex, []);
  }

  const userTeamIndex = assignTeams(playerData, activityLogs, guildData, guildTeamIndexes);

  const opposingTeamIndex = (teamIndex: number): number | null => {
    if (guildTeamIndexes.length !== 2) return null;
    return guildTeamIndexes.find((idx) => idx !== teamIndex) ?? null;
  };

  for (const player of playerData) {
    const userId = player?.userId;
    if (!userId) continue;
    const teamIndex = userTeamIndex.get(userId);
    if (teamIndex === undefined) continue;
    const bucket = guildBuckets.get(teamIndex);
    if (bucket && !bucket.has(userId)) bucket.set(userId, []);
  }

  for (const log of activityLogs) {
    if (!isBattleFinished(log)) continue;

    const teamIndex = Number(log.teamIndex ?? 1);
    const bucket = guildBuckets.get(teamIndex);
    if (!bucket) continue;

    const userId = log.userId ?? '';
    const hasScore = Object.prototype.hasOwnProperty.call(log, 'score');
    const abandoned = Boolean(log.abandoned);

    let entryScore = 0;
    let tileScore = 0;
    if (hasScore) {
      const split = getCoreScore(Number(log.score ?? 0), log.zone?.type);
      entryScore = split.core;
      tileScore = split.bonus;
    }

    let defended = false;
    let cleanup = false;
    if (!abandoned) {
      ({ defended, cleanup } = getBattleFlags(log));
    }

    const buffs = extractBuffs(log);
    const easyGame = isEasyGameBattle(log);
    const skillRating = calculateSkillRating({
      score: entryScore,
      hasScore,
      abandoned,
      defended,
      cleanup,
      buffs,
      easyGame,
    });

    if (!bucket.has(userId)) bucket.set(userId, []);
    bucket.get(userId)?.push({
      score: entryScore,
      tileScore,
      skillRating,
      abandoned,
      defended,
      cleanup,
      hasScore,
      buffs,
      easyGame,
    });

    const defenderUserId = log.defender?.userId ?? null;
    const defenderTeamIndex = opposingTeamIndex(teamIndex);

    guildBattleLogs.get(teamIndex)?.push({
      id: log.id ?? `${userId || 'unknown'}-${log.createdOn ?? 0}`,
      createdOn: Number(log.createdOn ?? 0),
      zoneType: log.zone?.type ?? null,
      attackerUserId: userId || null,
      attackerName: playerNames.get(userId) || userId || 'Unknown attacker',
      attackerAvatarUnitId: playerProfiles.get(userId)?.avatarUnitId ?? null,
      defenderUserId,
      defenderName:
        playerNames.get(defenderUserId ?? '') || defenderUserId || 'Unknown defender',
      defenderAvatarUnitId: playerProfiles.get(defenderUserId ?? '')?.avatarUnitId ?? null,
      attackerTeamIndex: teamIndex,
      defenderTeamIndex,
      hasScore,
      abandoned,
      defended,
      cleanup,
      easyGame,
      score: hasScore ? Number(log.score ?? 0) : 0,
      attackerUnits: log.attacker?.units ?? [],
      defenderUnits: log.defender?.units ?? [],
      attackerMachineOfWar: log.attacker?.machineOfWar ?? null,
      defenderMachineOfWar: log.defender?.machineOfWar ?? null,
    });
  }

  return guildData.map((guild) => {
    const teamIndex = Number(guild.teamIndex);
    const bucket = guildBuckets.get(teamIndex) ?? new Map<string, TokenEntry[]>();

    const players = Array.from(bucket.entries())
      .map(([userId, scores]): PlayerSnapshot => {
        const tokens: Token[] = Array.from(
          { length: TOKEN_SLOTS_PER_PLAYER },
          (_, index) => scores[index] ?? { score: 0, abandoned: false },
        );

        const usedTokens = tokens.filter(isPlayedToken).length;
        const totalScore = tokens.reduce((sum, t) => sum + (t.abandoned ? 0 : t.score), 0);
        const tileScore = tokens.reduce(
          (sum, t) => sum + (isPlayedToken(t) ? t.tileScore : 0),
          0,
        );

        return {
          userId,
          name: playerNames.get(userId) || userId,
          avatarUnitId: playerProfiles.get(userId)?.avatarUnitId ?? null,
          avatarFrameId: playerProfiles.get(userId)?.avatarFrameId ?? null,
          tokens,
          usedTokens,
          totalScore,
          averageScore: usedTokens > 0 ? Math.round(totalScore / usedTokens) : 0,
          tilesCleared: tokens.filter((t) => isPlayedToken(t) && t.tileScore > 0).length,
          tileScore,
          totalSkillRating: tokens.reduce(
            (sum, t) => sum + (isPlayedToken(t) ? t.skillRating : 0),
            0,
          ),
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore);

    return {
      teamIndex,
      name: guild.name ?? '',
      players,
      battles: (guildBattleLogs.get(teamIndex) ?? []).sort((a, b) => b.createdOn - a.createdOn),
    };
  });
}
