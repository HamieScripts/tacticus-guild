import { describe, expect, it } from 'vitest';
import { calculateSkillRating, getBattleUnitId, isEasyGameBattle } from './skill-rating';

describe('isEasyGameBattle', () => {
  it('marks battles with templNpc1Initiate as easy games', () => {
    expect(
      isEasyGameBattle({
        attackerUnits: [{ unitId: 'spaceMarine' }],
        defenderUnits: [{ unitId: 'templNpc1Initiate' }, { unitId: 'templNpc1Initiate' }],
      }),
    ).toBe(true);
  });

  it('detects easy games from the raw live-war battle log shape', () => {
    expect(
      isEasyGameBattle({
        attacker: { userId: 'u1', units: [{ unitId: 'spaceMarine' }] },
        defender: { userId: 'u2', units: [{ unitId: 'templNpc1Initiate' }] },
      }),
    ).toBe(true);
  });

  it('inspects the machine of war slot too', () => {
    expect(
      isEasyGameBattle({
        attackerUnits: [{ unitId: 'spaceMarine' }],
        defenderUnits: [{ unitId: 'spaceMarine' }],
        defenderMachineOfWar: { unitId: 'templNpc1Initiate' },
      }),
    ).toBe(true);
  });

  it('returns false for ordinary battles and junk input', () => {
    expect(
      isEasyGameBattle({
        attackerUnits: [{ unitId: 'spaceMarine' }],
        defenderUnits: [{ unitId: 'necronWarrior' }],
      }),
    ).toBe(false);
    expect(isEasyGameBattle(null)).toBe(false);
  });
});

describe('getBattleUnitId', () => {
  it('prefers avatarUnitId over the other id fields', () => {
    expect(getBattleUnitId({ avatarUnitId: 'a', unitId: 'b' })).toBe('a');
  });

  it('returns null when no id field is present', () => {
    expect(getBattleUnitId({})).toBeNull();
    expect(getBattleUnitId(null)).toBeNull();
  });
});

describe('calculateSkillRating', () => {
  const base = {
    score: 1000,
    hasScore: true,
    abandoned: false,
    defended: false,
    cleanup: false,
    easyGame: false,
  };

  it('doubles a win and divides by ten', () => {
    expect(calculateSkillRating(base)).toBe(200);
  });

  it('does not double a defended loss', () => {
    expect(calculateSkillRating({ ...base, defended: true })).toBe(100);
  });

  it('applies the cleanup and easy-game multipliers', () => {
    expect(calculateSkillRating({ ...base, cleanup: true })).toBe(150);
    expect(calculateSkillRating({ ...base, easyGame: true })).toBe(20);
  });

  it('applies buff multipliers once per unique buff', () => {
    const buffs = [{ abilityId: 'EnvFlakFire' }, { abilityId: 'EnvFlakFire' }];
    expect(calculateSkillRating({ ...base, buffs })).toBeCloseTo(240);
  });

  it('scores nothing for abandoned, unscored or zero-score tokens', () => {
    expect(calculateSkillRating({ ...base, abandoned: true })).toBe(0);
    expect(calculateSkillRating({ ...base, hasScore: false })).toBe(0);
    expect(calculateSkillRating({ ...base, score: 0 })).toBe(0);
  });
});
