const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRaidSeasonStats, buildWarStats, buildReportCards } = require('../src/lib/report-card-metrics');

test('raid totals include bomb damage but average and activity count only tokens', () => {
  const report = buildRaidSeasonStats({
    season: 112,
    entries: [
      { userId: 'player-1', damageDealt: 1000, damageType: 'Physical' },
      { userId: 'player-1', damageDealt: 250, damageType: 'Bomb' },
      { userId: 'player-2', damageDealt: 2000, damageType: 'Physical' }
    ]
  });

  assert.equal(report.players.get('player-1').totalDamage, 1250);
  assert.equal(report.players.get('player-1').tokens, 1);
  assert.equal(report.players.get('player-1').averageDamage, 1000);
  assert.equal(report.players.get('player-1').percentile, 0);
  assert.equal(report.players.get('player-2').percentile, 100);
});

test('war stats include only our guild, deduplicate battle IDs, and apply skill rating rules', () => {
  const report = buildWarStats({
    eventResults: [{
      eventResultType: 'SUCCESS',
      eventResponseData: {
        guildData: [
          { teamIndex: 1, name: '[TW] Praetorians of Terra', guildTag: 'XXPQS' },
          { teamIndex: 2, name: 'Opponents' }
        ],
        playerData: [{ userId: 'player-1', displayName: 'Player One' }],
        activityLogs: [
          {
            id: 'claim-1',
            type: 'playerClaimedZone',
            userId: 'player-2',
            teamIndex: 1
          },
          {
            id: 'battle-1',
            type: 'battleFinished',
            userId: 'player-1',
            teamIndex: 1,
            score: 41600,
            zone: { type: 'HQ' },
            buffs: [{ abilityId: 'EnvFortified' }, { abilityId: 'EnvFortified' }],
            attacker: { units: [] },
            defender: { units: [{ startHPBefore: 100, remainingHPBefore: 100, startHPAfter: 100 }] }
          },
          {
            id: 'battle-1',
            type: 'battleFinished',
            userId: 'player-1',
            teamIndex: 1,
            score: 41600,
            zone: { type: 'HQ' }
          },
          {
            id: 'opponent-battle',
            type: 'battleFinished',
            userId: 'opponent',
            teamIndex: 2,
            score: 1000
          }
        ]
      }
    }]
  }, 'Current war');

  const player = report.players.get('player-1');
  assert.equal(player.name, 'Player One');
  assert.equal(player.tokens, 1);
  assert.equal(player.totalScore, 1600);
  assert.equal(player.averageScore, 1600);
  assert.ok(Math.abs(player.skillRating - 328) < 0.001);
  assert.equal(report.players.has('opponent'), false);
  assert.equal(report.players.get('player-2').tokens, 0);
  assert.equal(report.players.get('player-2').percentile, 0);
});

test('selects the top 30 by activity, then orders cards alphabetically with avatar data', () => {
  const entries = Array.from({ length: 31 }, (_, index) => ({
    userId: `player-${index}`,
    damageDealt: 100,
    damageType: index === 0 ? 'Bomb' : 'Physical'
  }));
  entries.push({ userId: 'player-30', damageDealt: 100, damageType: 'Physical' });

  const directory = Array.from({ length: 31 }, (_, index) => ({
    id: `player-${index}`,
    name: index === 0 ? 'Aaron Excluded' : `Player ${String(index).padStart(2, '0')}`,
    avatarUnitId: `avatar-${index}`
  }));
  const wars = [{
    label: 'Current war',
    data: {
      eventResults: [{
        eventResultType: 'SUCCESS',
        eventResponseData: {
          guildData: [{ teamIndex: 1, name: '[TW] Praetorians of Terra', guildTag: 'XXPQS' }],
          playerData: [],
          activityLogs: [{
            id: 'war-battle-1',
            type: 'battleFinished',
            userId: 'player-1',
            teamIndex: 1,
            score: 1000,
            attacker: { units: [] },
            defender: { units: [{ remainingHPAfter: 500 }] }
          },
          {
            id: 'war-battle-2',
            type: 'battleFinished',
            userId: 'player-30',
            teamIndex: 1,
            score: 800,
            attacker: { units: [] },
            defender: { units: [] }
          }]
        }
      }]
    }
  }];
  const report = buildReportCards([{ season: 112, entries }], wars, directory);

  assert.equal(report.cards.length, 30);
  assert.equal(report.cards.some((card) => card.id === 'player-0'), false);
  assert.deepEqual(
    report.cards.map((card) => card.name),
    report.cards.map((card) => card.name).slice().sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }))
  );
  const topDamagePlayer = report.cards.find((card) => card.id === 'player-30');
  assert.equal(topDamagePlayer.raidGrade, 'A+');
  assert.equal(topDamagePlayer.warGrade, 'A');
  assert.equal(topDamagePlayer.totalWarScore, 800);
  assert.equal(topDamagePlayer.averageRaidDamage, 200);
  assert.equal(topDamagePlayer.avatarUnitId, 'avatar-30');
  const topWarScorePlayer = report.cards.find((card) => card.id === 'player-1');
  assert.equal(topWarScorePlayer.warGrade, 'A+');
  assert.equal(topWarScorePlayer.totalWarScore, 1000);

  const raidGradeCounts = report.cards.reduce((counts, card) => {
    counts[card.raidGrade] = (counts[card.raidGrade] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(raidGradeCounts, { 'A+': 1, A: 6, B: 6, C: 6, D: 6, F: 5 });
});