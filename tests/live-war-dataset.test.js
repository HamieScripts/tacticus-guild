const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldDisplayCurrentDataset, isEasyGameBattle, buildSnapshot, getCoreScore, getEasyGameBadgeHtml } = require('../src/app.js');

test('shows a populated live-war payload', () => {
  const payload = {
    eventResults: [{
      eventResultType: 'SUCCESS',
      eventResponseData: {
        activityLogs: [{ type: 'playerClaimedZone' }],
        playerData: [{ userId: '1', displayName: 'Test Player' }],
        guildData: [{ teamIndex: 1, name: 'Test Guild' }]
      }
    }]
  };

  assert.equal(shouldDisplayCurrentDataset(payload), true);
});

test('hides an empty live-war payload', () => {
  assert.equal(shouldDisplayCurrentDataset({}), false);
});

test('marks battles with templNpc1Initiate as easy games', () => {
  const battle = {
    attackerUnits: [{ unitId: 'spaceMarine' }],
    defenderUnits: [{ unitId: 'templNpc1Initiate' }, { unitId: 'templNpc1Initiate' }]
  };

  assert.equal(isEasyGameBattle(battle), true);
});

test('detects easy games from the raw live-war battle log shape', () => {
  const battle = {
    attacker: {
      userId: 'u1',
      units: [{ unitId: 'spaceMarine' }]
    },
    defender: {
      userId: 'u2',
      units: [{ unitId: 'templNpc1Initiate' }, { unitId: 'templNpc1Initiate' }]
    }
  };

  assert.equal(isEasyGameBattle(battle), true);
});

test('preserves easy-game flags on guild war token cells', () => {
  const teams = [
    { teamIndex: 1, name: 'Guild One' },
    { teamIndex: 2, name: 'Guild Two' }
  ];

  const data = {
    eventResults: [{
      eventResponseData: {
        guildData: teams,
        playerData: [{ userId: 'u1', displayName: 'Player One' }],
        activityLogs: [{
          type: 'battleFinished',
          userId: 'u1',
          teamIndex: 1,
          score: 100,
          createdOn: 1,
          zone: { type: 'Trenches1', visualId: 'trenches' },
          attacker: {
            userId: 'u1',
            units: [{ unitId: 'spaceMarine' }]
          },
          defender: {
            userId: 'u2',
            units: [{ unitId: 'templNpc1Initiate' }]
          }
        }]
      }
    }]
  };

  const snapshots = buildSnapshot(data);
  const token = snapshots[0].players[0].tokens[0];

  assert.equal(Boolean(token.easyGame), true);
});

test('preserves easy-game markers in guild snapshot token rows', () => {
  const payload = {
    eventResults: [{
      eventResponseData: {
        guildData: [{ teamIndex: 1, name: 'Guild One' }, { teamIndex: 2, name: 'Guild Two' }],
        playerData: [{ userId: 'p1', displayName: 'Player One' }, { userId: 'p2', displayName: 'Player Two' }],
        activityLogs: [{
          type: 'battleFinished',
          userId: 'p1',
          teamIndex: 1,
          score: 1600,
          attacker: { userId: 'p1', units: [{ unitId: 'spaceMarine' }] },
          defender: { userId: 'p2', units: [{ unitId: 'templNpc1Initiate' }] },
          createdOn: 1
        }]
      }
    }]
  };

  const snapshots = buildSnapshot(payload);
  const token = snapshots[0]?.players.find((player) => player.userId === 'p1')?.tokens[0];
  assert.equal(Boolean(token?.easyGame), true);
});

test('easy games reduce skill rating by a 0.1 multiplier', () => {
  const payload = {
    eventResults: [{
      eventResponseData: {
        guildData: [{ teamIndex: 1, name: 'Guild One' }],
        playerData: [{ userId: 'p1', displayName: 'Player One' }],
        activityLogs: [{
          type: 'battleFinished',
          userId: 'p1',
          teamIndex: 1,
          score: 1000,
          createdOn: 1,
          zone: { type: 'Trenches1', visualId: 'trenches' },
          attacker: { userId: 'p1', units: [{ unitId: 'spaceMarine' }] },
          defender: { userId: 'p2', units: [{ unitId: 'templNpc1Initiate' }] }
        }]
      }
    }]
  };

  const snapshots = buildSnapshot(payload);
  const token = snapshots[0].players[0].tokens[0];

  assert.equal(token.skillRating, 20);
});

test('splits HQ tile scores as 1600 core plus 40000 HQ bonus', () => {
  const split = getCoreScore(41600, 'HQ');

  assert.equal(split.core, 1600);
  assert.equal(split.bonus, 40000);
});

test('adds a building icon when an easy game also won a tile score', () => {
  const html = getEasyGameBadgeHtml({ easyGame: true, score: 17000, tileScore: 1000, includeBuildingIcon: true });

  assert.match(html, /🏢/);
  assert.match(html, /Easy game/);
});
