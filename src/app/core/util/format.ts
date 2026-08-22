export function normalizeUnitId(unitId: string | null | undefined): string {
  return String(unitId ?? '')
    .trim()
    .toLowerCase();
}

export function formatBattleDate(timestamp: number | null | undefined): string {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Case-insensitive substring match on player name; an empty query passes everything through. */
export function filterRowsByName<T extends { readonly name?: string }>(
  rows: readonly T[],
  query: string | null | undefined,
): readonly T[] {
  if (!Array.isArray(rows)) return [];

  const searchTerm = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!searchTerm) return rows;

  return rows.filter((row) => String(row?.name ?? '').toLowerCase().includes(searchTerm));
}
