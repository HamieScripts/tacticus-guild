import type { GuildData, WarSnapshot } from '../models/war-snapshot.model';
import { getLatestActivityTimestamp, getPrimaryEventResponseData } from './primary-event';

export const HOME_GUILD_NAME = '[TW] Praetorians of Terra';

const UNKNOWN_GUILD = 'Unknown guild';

export interface WarMetadata {
  readonly label: string;
  readonly sourceLabel: string;
  readonly opponentName: string;
  readonly warDate: number | null;
  readonly dateLabel: string;
}

export function cleanGuildName(value: string | undefined | null): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function formatWarDate(value: number | Date | null | undefined): string {
  if (value === null || value === undefined) return 'unknown';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toISOString().slice(0, 10);
}

export function getGuildNames(data: WarSnapshot | null | undefined): [string, string] {
  const guildData: readonly GuildData[] = getPrimaryEventResponseData(data)?.guildData ?? [];
  const names = guildData.map((guild) => cleanGuildName(guild?.name)).filter(Boolean).slice(0, 2);

  if (names.length >= 2) return [names[0] ?? UNKNOWN_GUILD, names[1] ?? UNKNOWN_GUILD];
  if (names.length === 1) return [names[0] ?? UNKNOWN_GUILD, UNKNOWN_GUILD];
  return [UNKNOWN_GUILD, UNKNOWN_GUILD];
}

export function deriveOpponentName(
  data: WarSnapshot | null | undefined,
  homeGuildName = HOME_GUILD_NAME,
): string {
  const [guildA, guildB] = getGuildNames(data);
  return guildA === homeGuildName ? guildB : guildA;
}

export function buildWarMetadata(
  data: WarSnapshot | null | undefined,
  homeGuildName = HOME_GUILD_NAME,
): WarMetadata {
  const [guildA, guildB] = getGuildNames(data);
  const warDate = getLatestActivityTimestamp(data);
  const dateLabel = formatWarDate(warDate);
  const opponentName = guildA === homeGuildName ? guildB : guildA;

  return {
    opponentName,
    warDate,
    dateLabel,
    label: `${opponentName} (${dateLabel})`,
    sourceLabel: `${guildA} vs. ${guildB} (${dateLabel})`,
  };
}

export type SnapshotValidation =
  | { readonly ok: true; readonly snapshot: WarSnapshot }
  | { readonly ok: false; readonly reason: string };

export function validateSnapshot(json: unknown): SnapshotValidation {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, reason: 'Expected a JSON object at the top level.' };
  }

  const candidate = json as WarSnapshot;
  if (!Array.isArray(candidate.eventResults) || candidate.eventResults.length === 0) {
    return { ok: false, reason: 'Missing a non-empty "eventResults" array.' };
  }

  const primary = getPrimaryEventResponseData(candidate);
  if (!primary) {
    return { ok: false, reason: 'No event result carried an "eventResponseData" payload.' };
  }

  if (!Array.isArray(primary.activityLogs) || primary.activityLogs.length === 0) {
    return { ok: false, reason: 'The payload has no activity logs.' };
  }

  if (!Array.isArray(primary.guildData) || primary.guildData.length === 0) {
    return { ok: false, reason: 'The payload has no guild data.' };
  }

  return { ok: true, snapshot: candidate };
}
