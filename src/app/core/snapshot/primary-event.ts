import type { EventResponseData, WarSnapshot } from '../models/war-snapshot.model';

/** Captures contain several event results; the richest payload is the real one. */
export function getPrimaryEventResponseData(
  data: WarSnapshot | null | undefined,
): EventResponseData | null {
  const eventResults = Array.isArray(data?.eventResults) ? data.eventResults : [];
  if (eventResults.length === 0) return null;

  let selected: EventResponseData | null = null;
  let selectedScore = -1;

  for (const eventResult of eventResults) {
    const eventResponseData = eventResult?.eventResponseData;
    if (!eventResponseData || typeof eventResponseData !== 'object') continue;

    const activityLogsLength = eventResponseData.activityLogs?.length ?? 0;
    const playerDataLength = eventResponseData.playerData?.length ?? 0;
    const guildDataLength = eventResponseData.guildData?.length ?? 0;
    const score = activityLogsLength * 1_000_000 + playerDataLength * 1_000 + guildDataLength;

    if (score > selectedScore) {
      selected = eventResponseData;
      selectedScore = score;
    }
  }

  return selected ?? eventResults[0]?.eventResponseData ?? null;
}

export function getLatestActivityTimestamp(data: WarSnapshot | null | undefined): number | null {
  const logs = getPrimaryEventResponseData(data)?.activityLogs;
  if (!logs?.length) return null;

  let maxTimestamp = 0;
  for (const log of logs) {
    const createdOn = Number(log?.createdOn ?? 0);
    if (Number.isFinite(createdOn) && createdOn > maxTimestamp) {
      maxTimestamp = createdOn;
    }
  }

  return maxTimestamp > 0 ? maxTimestamp : null;
}

/** A payload is renderable when it is a non-empty object or array. */
export function shouldDisplayCurrentDataset(data: unknown): boolean {
  if (data === null || data === undefined) return false;
  if (typeof data !== 'object') return false;
  if (Array.isArray(data)) return data.length > 0;
  return Object.keys(data).length > 0;
}
