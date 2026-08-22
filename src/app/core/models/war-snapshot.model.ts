/** Zone types with a confirmed or assumed tile bonus. */
export type { ZoneType } from '../scoring/tile-scores';

export interface Zone {
  readonly id?: string;
  readonly type?: string;
  readonly visualId?: string;
}

export interface BattleUnit {
  readonly unitId?: string;
  readonly startHPBefore?: number;
  readonly remainingHPBefore?: number;
  readonly remainingHPAfter?: number;
  readonly startHPAfter?: number;
  /** Alternate id fields seen across captures. */
  readonly avatarUnitId?: string;
  readonly unitTypeId?: string;
  readonly baseCharacterId?: string;
  readonly characterId?: string;
  readonly id?: string;
}

export interface Buff {
  readonly abilityId?: string;
  readonly name?: string;
  readonly id?: string;
}

export interface BattleSide {
  readonly userId?: string;
  readonly units?: readonly BattleUnit[];
  readonly machineOfWar?: BattleUnit | null;
  readonly buffs?: readonly Buff[];
}

export type ActivityLogType =
  | 'battleFinished'
  | 'playerClaimedZone'
  | 'playerLeftZone'
  | 'battlefieldSelected';

export interface ActivityLogBase {
  readonly type: ActivityLogType | string;
  readonly id?: string;
  readonly userId?: string;
  readonly teamIndex?: number;
  readonly createdOn?: number;
}

export interface BattleFinishedLog extends ActivityLogBase {
  readonly type: 'battleFinished';
  readonly score?: number;
  readonly zone?: Zone;
  readonly abandoned?: boolean;
  readonly attacker?: BattleSide;
  readonly defender?: BattleSide;
  readonly buffs?: readonly Buff[];
}

export type ActivityLog = ActivityLogBase | BattleFinishedLog;

export interface PlayerData {
  readonly userId?: string;
  readonly displayName?: string;
  readonly avatarUnitId?: string | null;
  readonly avatarFrameId?: string | null;
}

export interface GuildData {
  readonly teamIndex?: number;
  readonly guildId?: string;
  readonly name?: string;
}

export interface EventResponseData {
  readonly activityLogs?: readonly ActivityLog[];
  readonly playerData?: readonly PlayerData[];
  readonly guildData?: readonly GuildData[];
}

export interface EventResult {
  readonly eventId?: string;
  readonly eventResultType?: string;
  readonly eventResponseData?: EventResponseData;
}

export interface WarSnapshot {
  readonly eventResults?: readonly EventResult[];
}

export function isBattleFinished(log: ActivityLog): log is BattleFinishedLog {
  return log.type === 'battleFinished';
}
