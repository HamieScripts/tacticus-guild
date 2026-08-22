import { describe, expect, it } from 'vitest';
import { filterRowsByName, normalizeUnitId } from './format';

describe('filterRowsByName', () => {
  const rows = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }];

  it('matches case-insensitively and passes everything through for an empty query', () => {
    expect(filterRowsByName(rows, 'ali')).toEqual([{ name: 'Alice' }]);
    expect(filterRowsByName(rows, 'BOB')).toEqual([{ name: 'Bob' }]);
    expect(filterRowsByName(rows, 'z')).toEqual([]);
    expect(filterRowsByName(rows, '')).toEqual(rows);
  });
});

describe('normalizeUnitId', () => {
  it('trims and lowercases', () => {
    expect(normalizeUnitId('  SpaceMarine ')).toBe('spacemarine');
    expect(normalizeUnitId(null)).toBe('');
  });
});
