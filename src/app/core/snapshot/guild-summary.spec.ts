import { describe, expect, it } from 'vitest';
import type { GuildSnapshot, PlayerSnapshot, Token } from './build-snapshot';
import { orderGuildSummaries, summarizeGuild } from './guild-summary';
import { getScoreTier, getTokenOutcome, orderTokensForCards, sortPlayers } from './token-display';

function token(overrides: Partial<Extract<Token, { hasScore: boolean }>> = {}): Token {
  return {
    score: 1000,
    tileScore: 0,
    skillRating: 0,
    abandoned: false,
    defended: false,
    cleanup: false,
    hasScore: true,
    easyGame: false,
    buffs: [],
    ...overrides,
  };
}

const unused: Token = { score: 0, abandoned: false };

function player(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  const tokens = overrides.tokens ?? [token(), ...Array<Token>(9).fill(unused)];
  return {
    userId: 'p1',
    name: 'Player',
    avatarUnitId: null,
    avatarFrameId: null,
    tokens,
    usedTokens: 1,
    totalScore: 1000,
    averageScore: 1000,
    tilesCleared: 0,
    tileScore: 0,
    totalSkillRating: 200,
    ...overrides,
  };
}

describe('getTokenOutcome', () => {
  it('classifies each token state', () => {
    expect(getTokenOutcome(unused)).toBe('unused');
    expect(getTokenOutcome(token({ abandoned: true }))).toBe('abandoned');
    expect(getTokenOutcome(token({ defended: true }))).toBe('defeat');
    expect(getTokenOutcome(token({ hasScore: false }))).toBe('defeat');
    expect(getTokenOutcome(token())).toBe('win');
  });
});

describe('getScoreTier', () => {
  it('awards tiers on the core score, ignoring the tile bonus', () => {
    expect(getScoreTier(token({ score: 1600 }))).toBe('gold');
    expect(getScoreTier(token({ score: 1400 }))).toBe('silver');
    expect(getScoreTier(token({ score: 1200 }))).toBe('bronze');
    expect(getScoreTier(token({ score: 1199 }))).toBeNull();
    expect(getScoreTier(token({ abandoned: true }))).toBeNull();
    expect(getScoreTier(unused)).toBeNull();
  });
});

describe('sortPlayers', () => {
  const rows = [
    player({ userId: 'a', name: 'Aaa', totalScore: 100, averageScore: 50, totalSkillRating: 9 }),
    player({ userId: 'b', name: 'Bbb', totalScore: 300, averageScore: 10, totalSkillRating: 1 }),
    player({ userId: 'c', name: 'Ccc', totalScore: 200, averageScore: 90, totalSkillRating: 5 }),
  ];

  it('sorts by each key in both directions', () => {
    const ids = (key: 'score' | 'average' | 'rating', direction: 'asc' | 'desc') =>
      sortPlayers(rows, { key, direction }).map((p) => p.userId);

    expect(ids('score', 'desc')).toEqual(['b', 'c', 'a']);
    expect(ids('score', 'asc')).toEqual(['a', 'c', 'b']);
    expect(ids('average', 'desc')).toEqual(['c', 'a', 'b']);
    expect(ids('rating', 'desc')).toEqual(['a', 'c', 'b']);
  });

  it('breaks ties on name', () => {
    const tied = [
      player({ userId: 'z', name: 'Zed', totalScore: 10 }),
      player({ userId: 'a', name: 'Ann', totalScore: 10 }),
    ];
    expect(sortPlayers(tied, { key: 'score', direction: 'desc' }).map((p) => p.name)).toEqual([
      'Zed',
      'Ann',
    ]);
  });
});

describe('orderTokensForCards', () => {
  it('leads with played tokens, highest score first', () => {
    const ordered = orderTokensForCards([
      unused,
      token({ score: 500 }),
      token({ abandoned: true }),
      token({ score: 1500 }),
    ]);
    expect(ordered.map((t) => t.score)).toEqual([1500, 500, 1000, 0]);
  });
});

describe('summarizeGuild', () => {
  const guild: GuildSnapshot = {
    teamIndex: 1,
    name: 'Test Guild',
    battles: [],
    players: [
      player({
        userId: 'a',
        tokens: [
          token({ score: 1600, tileScore: 40000, cleanup: true }),
          token({ score: 800, defended: true }),
          token({ abandoned: true }),
          ...Array<Token>(7).fill(unused),
        ],
        usedTokens: 3,
        totalScore: 2400,
        tileScore: 40000,
        tilesCleared: 1,
      }),
    ],
  };

  it('counts tokens, outcomes and scores', () => {
    const summary = summarizeGuild(guild);
    expect(summary.totalPlayers).toBe(1);
    expect(summary.totalTokenSlots).toBe(10);
    expect(summary.usedTokens).toBe(3);
    expect(summary.remainingTokens).toBe(7);
    expect(summary.tokenScore).toBe(2400);
    expect(summary.tileScore).toBe(40000);
    expect(summary.totalWins).toBe(1);
    expect(summary.totalCleanupWins).toBe(1);
    expect(summary.totalDefeats).toBe(1);
    expect(summary.totalAbandoned).toBe(1);
    expect(summary.totalUnused).toBe(7);
  });

  it('caps the projected average at the token cap', () => {
    const summary = summarizeGuild(guild);
    expect(summary.avgPerUsedToken).toBe(800);
    expect(summary.projectedTokenGain).toBe(7 * 800);
    expect(summary.projectedTokenScore).toBe(2400 + 5600);
  });
});

describe('orderGuildSummaries', () => {
  it('puts our guild first regardless of score', () => {
    const summaries = [
      summarizeGuild({ teamIndex: 2, name: 'Rivals', players: [], battles: [] }),
      summarizeGuild({ teamIndex: 1, name: '[TW] Praetorians of Terra', players: [], battles: [] }),
    ];
    expect(orderGuildSummaries(summaries, 2).map((s) => s.teamIndex)).toEqual([1, 2]);
  });
});
