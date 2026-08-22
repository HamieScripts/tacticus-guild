import { describe, expect, it } from 'vitest';
import type { WarSnapshot } from '../models/war-snapshot.model';
import { buildWarMetadata, deriveOpponentName, formatWarDate, validateSnapshot } from './war-metadata';

const war: WarSnapshot = {
  eventResults: [
    {
      eventResponseData: {
        guildData: [
          { teamIndex: 1, name: '[TW] Praetorians  of Terra' },
          { teamIndex: 2, name: 'Rival Guild' },
        ],
        playerData: [{ userId: 'p1' }],
        activityLogs: [
          { type: 'battleFinished', createdOn: 1_700_000_000_000 },
          { type: 'battleFinished', createdOn: 1_700_086_400_000 },
        ],
      },
    },
  ],
};

describe('formatWarDate', () => {
  it('renders an ISO date and degrades to "unknown"', () => {
    expect(formatWarDate(1_700_000_000_000)).toBe('2023-11-14');
    expect(formatWarDate(null)).toBe('unknown');
    expect(formatWarDate(Number.NaN)).toBe('unknown');
  });
});

describe('deriveOpponentName', () => {
  it('picks the guild that is not ours, ignoring stray whitespace', () => {
    expect(deriveOpponentName(war)).toBe('Rival Guild');
  });
});

describe('buildWarMetadata', () => {
  it('reproduces the manifest label format from the latest activity timestamp', () => {
    const metadata = buildWarMetadata(war);
    expect(metadata.dateLabel).toBe('2023-11-15');
    expect(metadata.label).toBe('Rival Guild (2023-11-15)');
    expect(metadata.sourceLabel).toBe('[TW] Praetorians of Terra vs. Rival Guild (2023-11-15)');
  });
});

describe('validateSnapshot', () => {
  it('accepts a real capture', () => {
    expect(validateSnapshot(war).ok).toBe(true);
  });

  it('rejects malformed payloads with a reason', () => {
    expect(validateSnapshot(null)).toMatchObject({ ok: false });
    expect(validateSnapshot([])).toMatchObject({ ok: false });
    expect(validateSnapshot({})).toMatchObject({ ok: false });
    expect(validateSnapshot({ eventResults: [{ eventResponseData: { activityLogs: [] } }] })).toMatchObject({
      ok: false,
    });
  });
});
