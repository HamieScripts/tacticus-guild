const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRaidSeasonStats,
  buildWarStats,
  buildReportCards,
  hasCurrentWarActivity,
  selectWarSeasons
} = require('../src/lib/report-card-metrics');

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
  assert.equal(report.players.get('player-1').rank, 2);
  assert.equal(report.players.get('player-1').grade, 'A');
  assert.equal(report.players.get('player-2').percentile, 100);
  assert.equal(report.players.get('player-2').rank, 1);
  assert.equal(report.players.get('player-2').grade, 'A+');
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
  assert.equal(player.rank, 1);
  assert.equal(player.grade, 'A+');
  assert.equal(report.players.has('opponent'), false);
  assert.equal(report.players.get('player-2').tokens, 0);
  assert.equal(report.players.get('player-2').rank, null);
  assert.equal(report.players.get('player-2').grade, '—');
});

test('selects the top 30 by activity, then orders cards alphabetically with avatar data', () => {
  const entries = Array.from({ length: 31 }, (_, index) => ({
    userId: `player-${index}`,
    damageDealt: 100,
    damageType: 'Physical'
  }));
  entries.push({ userId: 'player-30', damageDealt: 100, damageType: 'Physical' });
  for (let index = 0; index < 10; index += 1) {
    entries.push({ userId: 'player-0', damageDealt: 100, damageType: 'Physical' });
  }

  const directory = Array.from({ length: 31 }, (_, index) => ({
    id: `player-${index}`,
    name: index === 0 ? 'Aaron Excluded' : `Player ${String(index).padStart(2, '0')}`,
    avatarUnitId: `avatar-${index}`
  }));
  const wars = [{
    label: 'Active war',
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
          },
          ...Array.from({ length: 28 }, (_, index) => ({
            id: `zone-claim-${index}`,
            type: 'playerClaimedZone',
            userId: `player-${index + 2}`,
            teamIndex: 1
          }))]
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
  assert.equal(topDamagePlayer.averageWarRank, 2);
  assert.equal(topDamagePlayer.averageRaidDamage, 200);
  assert.equal(topDamagePlayer.avatarUnitId, 'avatar-30');
  const topWarScorePlayer = report.cards.find((card) => card.id === 'player-1');
  assert.equal(topWarScorePlayer.warGrade, 'A+');
  assert.equal(topWarScorePlayer.averageWarRank, 1);
  const playerWithAGrades = report.cards.find((card) => card.id === 'player-2');
  assert.equal(playerWithAGrades.raidGrade, 'A');
  assert.equal(playerWithAGrades.warGrade, '—');
  assert.equal(playerWithAGrades.warDataIncomplete, true);

  const raidGradeCounts = report.cards.reduce((counts, card) => {
    counts[card.raidGrade] = (counts[card.raidGrade] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(raidGradeCounts, { 'A+': 1, A: 6, B: 6, C: 6, D: 6, F: 5 });
});

test('grades partial histories using available seasons and marks them incomplete', () => {
  const raidSeasons = [
    { season: 112, entries: [
      { userId: 'player-1', damageDealt: 900, damageType: 'Physical' },
      { userId: 'player-2', damageDealt: 500, damageType: 'Physical' }
    ] },
    { season: 111, entries: [{ userId: 'player-2', damageDealt: 500, damageType: 'Physical' }] },
    { season: 110, entries: [{ userId: 'player-2', damageDealt: 500, damageType: 'Physical' }] }
  ];
  const wars = Array.from({ length: 3 }, (_, seasonIndex) => {
    const scores = seasonIndex === 0
      ? [['player-1', 900], ['player-2', 500]]
      : [['player-2', 500]];
    return {
      label: `War ${seasonIndex + 1}`,
      seasonIndex,
      data: {
        eventResults: [{
          eventResultType: 'SUCCESS',
          eventResponseData: {
            guildData: [{ teamIndex: 1, guildTag: 'XXPQS', name: '[TW] Praetorians of Terra' }],
            playerData: [],
            activityLogs: scores.map(([userId, score]) => ({
              id: `${seasonIndex}-${userId}`,
              type: 'battleFinished',
              userId,
              teamIndex: 1,
              score,
              attacker: { units: [] },
              defender: { units: [{ remainingHPAfter: 500 }] }
            }))
          }
        }]
      }
    };
  });

  const report = buildReportCards(raidSeasons, wars);
  const partial = report.cards.find((card) => card.id === 'player-1');
  const complete = report.cards.find((card) => card.id === 'player-2');

  assert.equal(partial.averageRaidDamage, 900);
  assert.equal(partial.raidGrade, 'A+');
  assert.equal(partial.raidSeasonsPlayed, 1);
  assert.equal(partial.raidDataIncomplete, true);
  assert.equal(partial.averageWarRank, 1);
  assert.equal(partial.warGrade, 'A+');
  assert.equal(partial.warWarsPlayed, 1);
  assert.equal(partial.warCount, 3);
  assert.equal(partial.warDataIncomplete, true);
  assert.equal(complete.averageRaidDamage, 500);
  assert.equal(complete.raidDataIncomplete, false);
  assert.ok(Math.abs(complete.averageWarRank - 4 / 3) < 0.001);
  assert.equal(complete.warWarsPlayed, 3);
  assert.equal(complete.warCount, 3);
  assert.equal(complete.warDataIncomplete, false);
});

test('only treats a successful snapshot with our guild activity as the active war', () => {
  assert.equal(hasCurrentWarActivity(null), false);
  assert.equal(hasCurrentWarActivity({ eventResults: [{ eventResultType: 'SUCCESS', eventResponseData: { activityLogs: [] } }] }), false);
  assert.equal(hasCurrentWarActivity({
    eventResults: [{
      eventResultType: 'SUCCESS',
      eventResponseData: {
        guildData: [{ guildTag: 'XXPQS', name: '[TW] Praetorians of Terra' }],
        activityLogs: [{ type: 'playerClaimedZone' }]
      }
    }]
  }), true);
});

test('selects the whole current war season, or the latest completed season as fallback', () => {
  const archives = [
    { key: 'war-oct30', label: 'Oct 30', start: '2026-10-28T11:06:08.138Z', end: '2026-10-30T19:43:34.702Z' },
    { key: 'war-oct28', label: 'Oct 28', start: '2026-10-25T21:39:05.560Z', end: '2026-10-28T07:31:56.803Z' },
    { key: 'war-oct25', label: 'Oct 25', start: '2026-10-21T09:31:28.422Z', end: '2026-10-25T20:38:39.282Z' },
    { key: 'war-oct03', label: 'Oct 03', start: '2026-09-30T21:55:14.587Z', end: '2026-10-03T08:41:58.045Z' }
  ];
  const current = {
    eventResults: [{
      eventResultType: 'SUCCESS',
      eventResponseData: {
        guildData: [{ guildTag: 'XXPQS' }],
        activityLogs: [
          { createdOn: Date.parse('2026-10-31T12:00:00Z') },
          { createdOn: Date.parse('2026-11-01T10:00:00Z') }
        ]
      }
    }]
  };

  assert.deepEqual(
    selectWarSeasons(current, archives, 1)[0].entries.map((entry) => entry.key),
    ['current', 'war-oct30', 'war-oct28', 'war-oct25']
  );
  assert.deepEqual(
    selectWarSeasons(null, archives, 1)[0].entries.map((entry) => entry.key),
    ['war-oct30', 'war-oct28', 'war-oct25']
  );
});