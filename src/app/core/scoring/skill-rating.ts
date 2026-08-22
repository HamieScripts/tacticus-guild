import type { BattleSide, BattleUnit, Buff } from '../models/war-snapshot.model';

export const SKILL_BUFF_MULTIPLIERS: Readonly<Record<string, number>> = {
  EnvDefenderHealthBuff2: 1.25,
  EnvArmourSupplies: 1.1,
  EnvFlakFire: 1.2,
  EnvArtillerySupport: 1.15,
  EnvAngelsOfDeath: 1.1,
  EnvFortified: 1.025,
};

const NPC_UNIT_ID = 'templNpc1Initiate';

export interface SkillRatingInput {
  readonly score: number;
  readonly hasScore: boolean;
  readonly abandoned: boolean;
  readonly defended: boolean;
  readonly cleanup: boolean;
  readonly easyGame: boolean;
  readonly buffs?: readonly Buff[];
}

/** Shape-tolerant unit id lookup; captures vary in which id field they carry. */
export function getBattleUnitId(unit: BattleUnit | null | undefined): string | null {
  if (!unit || typeof unit !== 'object') return null;

  const rawId =
    unit.avatarUnitId ??
    unit.unitTypeId ??
    unit.baseCharacterId ??
    unit.unitId ??
    unit.characterId ??
    unit.id;

  if (!rawId) return null;
  return String(rawId).trim();
}

export function getBuffName(buff: Buff | null | undefined): string {
  return buff?.abilityId ?? buff?.name ?? buff?.id ?? '';
}

/** Accepts both the raw log shape (attacker/defender) and the flattened battle shape. */
export interface EasyGameCandidate {
  readonly attacker?: BattleSide;
  readonly defender?: BattleSide;
  readonly attackerUnits?: readonly BattleUnit[];
  readonly defenderUnits?: readonly BattleUnit[];
  readonly attackerMachineOfWar?: BattleUnit | null;
  readonly defenderMachineOfWar?: BattleUnit | null;
}

function sideUnits(
  units: readonly BattleUnit[] | undefined,
  machineOfWar: BattleUnit | null | undefined,
): readonly BattleUnit[] {
  const list = Array.isArray(units) ? [...units] : [];
  if (machineOfWar && typeof machineOfWar === 'object') {
    list.push(machineOfWar);
  }
  return list;
}

export function isEasyGameBattle(battle: EasyGameCandidate | null | undefined): boolean {
  if (!battle || typeof battle !== 'object') return false;

  const attackerUnits = battle.attackerUnits ?? battle.attacker?.units;
  const defenderUnits = battle.defenderUnits ?? battle.defender?.units;
  const attackerMow = battle.attackerMachineOfWar ?? battle.attacker?.machineOfWar ?? null;
  const defenderMow = battle.defenderMachineOfWar ?? battle.defender?.machineOfWar ?? null;

  return [
    sideUnits(attackerUnits, attackerMow),
    sideUnits(defenderUnits, defenderMow),
  ].some((units) => units.some((unit) => getBattleUnitId(unit) === NPC_UNIT_ID));
}

export function calculateSkillRating(token: SkillRatingInput | null | undefined): number {
  if (!token || !token.hasScore || token.abandoned) return 0;

  const baseScore = Number(token.score) || 0;
  if (baseScore <= 0) return 0;

  let rating = baseScore;

  const uniqueBuffs = new Set((token.buffs ?? []).map(getBuffName));
  for (const buffName of uniqueBuffs) {
    const multiplier = SKILL_BUFF_MULTIPLIERS[buffName];
    if (multiplier) rating *= multiplier;
  }

  if (token.cleanup) rating *= 0.75;
  if (token.easyGame) rating *= 0.1;

  // Win doubles rating, loss keeps it as-is.
  rating *= token.defended ? 1 : 2;

  return rating / 10;
}
