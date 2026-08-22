import { describe, expect, it } from 'vitest';
import { getCoreScore } from './score-splitter';

describe('getCoreScore', () => {
  it('leaves scores at or below the token cap untouched', () => {
    expect(getCoreScore(1600)).toEqual({ core: 1600, bonus: 0 });
    expect(getCoreScore(0)).toEqual({ core: 0, bonus: 0 });
  });

  it('splits HQ tile scores as 1600 core plus 40000 HQ bonus', () => {
    expect(getCoreScore(41600, 'HQ')).toEqual({ core: 1600, bonus: 40000 });
  });

  it('uses the zone bonus rather than the first fallback that fits', () => {
    // Without the zone type this resolves as 1000 + 16000; the HQ lookup wins.
    expect(getCoreScore(41000, 'HQ')).toEqual({ core: 1000, bonus: 40000 });
  });

  it('falls back to the known bonuses when the zone type is unknown', () => {
    expect(getCoreScore(17000)).toEqual({ core: 1000, bonus: 16000 });
    expect(getCoreScore(11000)).toEqual({ core: 1000, bonus: 10000 });
  });

  it('caps the core and keeps the remainder as bonus when nothing matches', () => {
    expect(getCoreScore(5000)).toEqual({ core: 1600, bonus: 3400 });
  });
});
