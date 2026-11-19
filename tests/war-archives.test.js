const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { buildArchiveImport } = require('../scripts/import-war-archives');

const archiveKey = 'effdbc91-0bed-48b6-9300-850c24c4e0d1';
const rawArchive = require(`../data/war/${archiveKey}.json`);

test('times Supabase requests only when enabled and omits query parameters', async () => {
  const messages = [];
  const response = { status: 200 };
  let request;
  let now = 0;
  const context = {
    window: { location: { search: '' } }, URL, URLSearchParams,
    SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'test',
    performance: { now: () => (now += 12.5) },
    console: { info: message => messages.push(message) },
    setTimeout: () => {},
    fetch: async (url, options) => {
      assert.equal(options.cache, 'no-store');
      if (options.method === 'POST') throw new Error('offline');
      return response;
    },
    supabase: { createClient: (url, key, options) => {
      request = options.global.fetch;
      return { from: () => ({ select: async () => ({ error: {} }) }) };
    } },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/lib/supabase-data'), 'utf8'), context);
  await context.window.supabaseData.getPlayers();
  const url = 'https://example.test/rest/v1/war_battles?war_id=eq.player-data';
  assert.equal(await request(url), response);
  assert.deepEqual(messages, []);
  context.window.location.search = '?dbTiming=1';
  assert.equal(await request(url), response);
  await assert.rejects(request(url, { method: 'POST' }), /offline/);
  assert.deepEqual(messages, [
    '[Supabase] GET /rest/v1/war_battles (200) 12.5 ms',
    '[Supabase] POST /rest/v1/war_battles (network error) 12.5 ms',
  ]);
});

test('imports only finished battles and relates them to both guilds and the roster', () => {
  const archive = buildArchiveImport(archiveKey, rawArchive);
  const source = rawArchive.eventResults[0];
  const finished = source.eventResponseData.activityLogs.filter(log => log.type === 'battleFinished');
  assert.equal(archive.archive_event_id, source.eventId);
  assert.equal(archive.guild_rows.length, 2);
  assert.equal(archive.battle_rows.length, finished.length);
  assert.deepEqual(archive.battle_rows.map(row => row.log), finished);
  const participants = new Map(archive.participant_rows.map(row => [row.player_id, row]));
  for (const player of source.eventResponseData.playerData) assert.ok(participants.has(player.userId));
  for (const row of archive.battle_rows) {
    assert.equal(participants.get(row.attacker_id).guild_id, row.attacker_guild_id);
    assert.notEqual(row.attacker_guild_id, row.defender_guild_id);
  }
  assert.throws(() => buildArchiveImport('current', {}), /successful event/);
});

test('loads archived battles only from Supabase and the live war from JSON', async () => {
  const requests = [];
  const largeArchiveKey = 'large-war';
  const battle = {
    source_battle_id: 'battle', source_user_id: 'attacker', attacking_side: 1,
    fought_at: '2026-09-01T10:00:00.123Z', score: null, abandoned: false, zone_type: 'HQ',
    attacker_user_id: 'attacker', attacker_power: 100, defender_user_id: 'defender',
    war_battle_units: [
      { attacking: false, slot: 2, unit_id: 'second', remaining_hp_before: null, remaining_hp_after: 0 },
      { attacking: false, slot: 0, unit_id: 'defender-machine', progression_index: null },
      { attacking: true, slot: 0, unit_id: 'attacker-machine', progression_index: 3 },
      { attacking: false, slot: 1, unit_id: 'first', remaining_hp_before: 0, remaining_hp_after: null },
    ],
    war_battle_buffs: [{ slot: 1, ability_id: 'buff', scope: 'defender' }],
  };
  const context = {
    window: {},
    SUPABASE_URL: 'https://example.test',
    SUPABASE_ANON_KEY: 'test',
    setTimeout: () => {},
    fetch: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => ({ fromJson: true }), headers: { get: () => 'last-modified' } };
    },
    supabase: { createClient: () => ({ from: (table) => {
      requests.push(table);
      if (table === 'players') return { select: async () => ({ error: null }) };
      if (table === 'war_archives') return { select: columns => ({ eq: (field, value) => {
        assert.match(columns, /war_battles\(/);
        const query = {
          order: () => query,
          limit: () => query,
          maybeSingle: async () => ({ data: [archiveKey, largeArchiveKey].includes(value) ? {
            event_id: 'event',
            war_id: 'war',
            wars: {
              war_guilds: [{ side: 2, guild_id: 'second-guild' }, { side: 1, guild_id: 'first-guild' }],
              war_participants: [{ player_id: 'attacker', display_name: 'Attacker' }],
              war_battles: value === largeArchiveKey ? Array(1000).fill(battle) : [battle],
            },
          } : null }),
        };
        return query;
      } }) };
      const query = {
        select: () => query, eq: () => query, order: () => query,
        range: async (from, to) => {
          assert.deepEqual([from, to], [1000, 1999]);
          return { data: [{ ...battle, source_battle_id: 'overflow' }] };
        },
      };
      assert.equal(table, 'war_battles');
      return query;
    } }) },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/lib/supabase-data'), 'utf8'), context);
  const { loadWarDataset } = context.window.supabaseData;
  const liveUrl = './data/war/current.json';
  assert.equal((await loadWarDataset({ key: 'current' })).data.fromJson, true);
  assert.deepEqual(requests, [liveUrl]);
  const loaded = await loadWarDataset({ archiveKey });
  const { guildData, playerData, activityLogs } = JSON.parse(JSON.stringify(loaded.data.eventResults[0].eventResponseData));
  assert.deepEqual(guildData.map(guild => guild.guildId), ['first-guild', 'second-guild']);
  assert.deepEqual(playerData, [{ userId: 'attacker', displayName: 'Attacker' }]);
  assert.deepEqual(activityLogs, [{
    type: 'battleFinished', id: 'battle', userId: 'attacker', teamIndex: 1,
    createdOn: Date.parse(battle.fought_at), zone: { type: 'HQ' },
    attacker: { userId: 'attacker', lineupPower: 100, units: [], machineOfWar: { unitId: 'attacker-machine', progressionIndex: 3 } },
    defender: { userId: 'defender', units: [
      { unitId: 'first', remainingHPBefore: 0 }, { unitId: 'second', remainingHPAfter: 0 },
    ], machineOfWar: { unitId: 'defender-machine' } },
    buffs: [{ abilityId: 'buff', scope: 'defender' }],
  }]);
  assert.equal(await loadWarDataset({ archiveKey }).then(result => result.data), loaded.data);
  assert.deepEqual(requests, [liveUrl, 'players', 'war_archives']);
  const missingKey = '00000000-0000-0000-0000-000000000001';
  await assert.rejects(loadWarDataset({ archiveKey: missingKey }), /unavailable/);
  assert.deepEqual(requests, [liveUrl, 'players', 'war_archives', 'war_archives']);
  const largeWar = await loadWarDataset({ archiveKey: largeArchiveKey });
  const largeWarLogs = largeWar.data.eventResults[0].eventResponseData.activityLogs;
  assert.equal(largeWarLogs.length, 1001);
  assert.equal(largeWarLogs.at(-1).id, 'overflow');
  assert.deepEqual(requests.slice(-2), ['war_archives', 'war_battles']);
});