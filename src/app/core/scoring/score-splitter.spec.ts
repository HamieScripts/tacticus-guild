import { describe, expect, it } from 'vitest';
import { getCoreScore } from './score-splitter';
import { MAX_TOKEN_SCORE, POSSIBLE_TILE_SCORE, TILE_SCORES } from './tile-scores';

describe('tile scores', () => {
  it('covers every zone type seen in the captured wars', () => {
    const observed = [
      'AntiAirBattery',
      'Armoury',
      'ArtilleryPosition1',
      'ArtilleryPosition2',
      'Bunker1',
      'Bunker2',
      'HQ',
      'LandingPad1',
      'LandingPad2',
      'MedicaeStation1',
      'MedicaeStation2',
      'SupplyDepot',
      'Trenches1',
      'Trenches2',
      'Trenches3',
    ];
    expect(Object.keys(TILE_SCORES).sort()).toEqual(observed.sort());
  });

  it('sums to the full-map total the POC used', () => {
    expect(POSSIBLE_TILE_SCORE).toBe(520_000);
  });

  it('assigns each zone a bonus consistent with its highest observed score', () => {
    // A zone's max score is its bonus plus the token cap.
    const maxObserved: Record<string, number> = {
      Trenches1: 11600,
      AntiAirBattery: 17600,
      Armoury: 17600,
      MedicaeStation1: 17600,
      SupplyDepot: 31600,
      HQ: 41600,
    };

    for (const [zone, max] of Object.entries(maxObserved)) {
      expect(getCoreScore(max, zone)).toEqual({
        core: MAX_TOKEN_SCORE,
        bonus: max - MAX_TOKEN_SCORE,
      });
    }
  });
});

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
    expect(getCoreScore(30650)).toEqual({ core: 650, bonus: 30000 });
  });

  it('caps the core and keeps the remainder as bonus when nothing matches', () => {
    expect(getCoreScore(5000)).toEqual({ core: 1600, bonus: 3400 });
  });
});
