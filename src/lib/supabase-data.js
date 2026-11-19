// Browser data layer: reads guild data from Supabase and returns the same
// shapes the pages previously loaded from data/*.json, so render logic is
// unchanged. Requires supabase-config.js and the @supabase/supabase-js CDN
// bundle to be loaded first. Plain script (no modules) — exposes
// window.supabaseData.
(function () {
  const HERO_SLOTS = 5;
  // PostgREST caps responses at 1000 rows by default; page through.
  const PAGE_SIZE = 1000;
  // supabase-js retries failed requests internally, which would stall page
  // load when Supabase is unreachable. So instead of fighting retries per
  // query, probe once and remember the answer.
  const HEALTH_TIMEOUT_MS = 3000;

  let client = null;
  let available = null;
  let warAvailability = null;
  const warLoads = new Map();

  async function fetchSupabase(url, options = {}) {
    const requestOptions = { ...options, cache: 'no-store' };
    if (!window.location?.search || new URLSearchParams(window.location.search).get('dbTiming') !== '1') {
      return fetch(url, requestOptions);
    }

    const endpoint = new URL(url, SUPABASE_URL).pathname;
    const start = performance.now();
    let status = 'network error';
    try {
      const response = await fetch(url, requestOptions);
      status = response.status;
      return response;
    } finally {
      console.info(`[Supabase] ${options.method || 'GET'} ${endpoint} (${status}) ${(performance.now() - start).toFixed(1)} ms`);
    }
  }

  function getClient() {
    if (client) return client;
    if (typeof supabase === 'undefined' || typeof SUPABASE_URL === 'undefined') return null;
    client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { fetch: fetchSupabase }
    });
    return client;
  }

  async function isAvailable() {
    if (available !== null) return available;
    const db = getClient();
    if (!db) return false;

    try {
      const timeout = new Promise((resolve) => setTimeout(() => resolve(false), HEALTH_TIMEOUT_MS));
      const probe = db.from('players').select('id', { head: true, count: 'exact' })
        .then(({ error }) => !error)
        .catch(() => false);
      available = await Promise.race([probe, timeout]);
    } catch (error) {
      available = false;
    }
    return available;
  }

  function toUnixSeconds(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return value;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : Math.round(parsed / 1000);
  }

  async function fetchAll(queryFactory, offset = 0) {
    const rows = [];
    for (let from = offset; ; from += PAGE_SIZE) {
      const { data, error } = await queryFactory().range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      rows.push(...data);
      if (data.length < PAGE_SIZE) return rows;
    }
  }

  // players -> data/static/players.json shape
  async function getPlayers() {
    if (!(await isAvailable())) return null;
    const db = getClient();

    const rows = await fetchAll(() => db.from('players').select('id, name, avatar_unit_id, avatar_frame_id'));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      avatarUnitId: row.avatar_unit_id,
      avatarFrameId: row.avatar_frame_id
    }));
  }

  // raid_seasons -> data/raid/manifest.json shape
  async function getRaidManifest() {
    if (!(await isAvailable())) return null;
    const db = getClient();

    const rows = await fetchAll(() => db
      .from('raid_seasons')
      .select('season, entries, players, damage, start, end')
      .order('season', { ascending: false }));

    if (rows.length === 0) return null;

    return {
      fetchedOn: toUnixSeconds(rows[0].end),
      current: rows[0].season,
      seasons: rows.map((row) => ({
        season: row.season,
        url: `./data/raid/${row.season}.json`,
        entries: row.entries,
        players: row.players,
        damage: Number(row.damage),
        start: toUnixSeconds(row.start),
        end: toUnixSeconds(row.end)
      }))
    };
  }

  const ENTRY_COLUMNS = [
    'tier', 'set_index', 'encounter_index', 'encounter_type',
    'boss_unit_id', 'boss_type', 'rarity', 'damage_dealt', 'damage_type',
    'remaining_hp', 'max_hp', 'started_on', 'completed_on',
    'user_id', 'user_id_text',
    'unit_id_1', 'unit_1_power', 'unit_id_2', 'unit_2_power',
    'unit_id_3', 'unit_3_power', 'unit_id_4', 'unit_4_power',
    'unit_id_5', 'unit_5_power', 'mow_unit_id', 'mow_power',
    'extra_unit_ids', 'extra_unit_powers'
  ].join(', ');

  function toEntry(row) {
    const heroDetails = [];
    for (let slot = 1; slot <= HERO_SLOTS; slot += 1) {
      const unitId = row[`unit_id_${slot}`];
      if (!unitId) continue;
      heroDetails.push({ unitId, power: Number(row[`unit_${slot}_power`]) || 0 });
    }

    // Overflow safety net for attacks with more than 5 heroes.
    if (Array.isArray(row.extra_unit_ids)) {
      row.extra_unit_ids.forEach((unitId, index) => {
        if (!unitId) return;
        const powers = Array.isArray(row.extra_unit_powers) ? row.extra_unit_powers : [];
        heroDetails.push({ unitId, power: Number(powers[index]) || 0 });
      });
    }

    return {
      userId: row.user_id || row.user_id_text || '',
      tier: row.tier,
      set: row.set_index,
      encounterIndex: row.encounter_index,
      encounterType: row.encounter_type,
      unitId: row.boss_unit_id,
      type: row.boss_type,
      rarity: row.rarity,
      damageDealt: Number(row.damage_dealt),
      damageType: row.damage_type,
      remainingHp: Number(row.remaining_hp),
      maxHp: Number(row.max_hp),
      startedOn: toUnixSeconds(row.started_on),
      completedOn: toUnixSeconds(row.completed_on),
      heroDetails,
      machineOfWarDetails: row.mow_unit_id
        ? { unitId: row.mow_unit_id, power: Number(row.mow_power) || 0 }
        : null
    };
  }

  // raid_entries + raid_seasons -> data/raid/<season>.json shape
  async function getRaidSeason(season) {
    if (!(await isAvailable())) return null;
    const db = getClient();

    const { data: seasonRow, error: seasonError } = await db
      .from('raid_seasons')
      .select('season, guild_id, season_config_id, guild_name, guild_tag, guild_level, fetched_on')
      .eq('season', season)
      .maybeSingle();

    if (seasonError) throw new Error(seasonError.message);
    if (!seasonRow) return null;

    const rows = await fetchAll(() => db
      .from('raid_entries')
      .select(ENTRY_COLUMNS)
      .eq('season', season)
      .eq('guild_id', seasonRow.guild_id));

    return {
      fetchedOn: toUnixSeconds(seasonRow.fetched_on),
      season: seasonRow.season,
      seasonConfigId: seasonRow.season_config_id,
      guild: {
        name: seasonRow.guild_name,
        guildTag: seasonRow.guild_tag,
        level: seasonRow.guild_level,
        seasons: []
      },
      entries: rows.map(toEntry)
    };
  }

  // Per-player damage totals per season, for the player page trend chart.
  // Two paged queries replace the 40 season-file fetches this used to need.
  async function getRaidPlayerTotals() {
    if (!(await isAvailable())) return null;
    const db = getClient();

    const [seasonRows, entryRows] = await Promise.all([
      fetchAll(() => db.from('raid_seasons').select('season, guild_id, start, end').order('season', { ascending: true })),
      fetchAll(() => db.from('raid_entries').select('season, guild_id, user_id, user_id_text, damage_dealt'))
    ]);

    const seasonsByNumber = new Map(seasonRows.map((row) => [row.season, row]));
    const totalsBySeason = new Map();

    entryRows.forEach((row) => {
      const seasonRow = seasonsByNumber.get(row.season);
      if (!seasonRow || String(row.guild_id || '') !== String(seasonRow.guild_id || '')) return;

      const userId = String(row.user_id || row.user_id_text || '').trim();
      const damage = Number(row.damage_dealt) || 0;
      if (!userId || !Number.isFinite(damage)) return;

      if (!totalsBySeason.has(row.season)) totalsBySeason.set(row.season, new Map());
      const totals = totalsBySeason.get(row.season);
      totals.set(userId, (totals.get(userId) || 0) + damage);
    });

    return Array.from(totalsBySeason.entries())
      .map(([season, totals]) => {
        const seasonRow = seasonsByNumber.get(season) || {};
        return {
          season,
          start: toUnixSeconds(seasonRow.end || seasonRow.start) || 0,
          totals
        };
      })
      .sort((a, b) => a.season - b.season);
  }

  const WAR_BATTLE_COLUMNS = [
    'source_battle_id', 'source_user_id', 'attacking_side', 'fought_at', 'score', 'abandoned',
    'zone_id', 'zone_type', 'zone_visual_id', 'attempt_debuff',
    'attacker_user_id', 'attacker_power', 'defender_user_id', 'defender_power',
    'war_battle_units(attacking,slot,unit_id,progression_index,rank,start_hp_before,remaining_hp_before,start_hp_after,remaining_hp_after)',
    'war_battle_buffs(slot,ability_id,scope)',
  ].join(',');

  function definedFields(fields) {
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value != null));
  }

  function warBattleToLog(row) {
    const units = row.war_battle_units.sort((left, right) => left.slot - right.slot);
    const buffs = row.war_battle_buffs.sort((left, right) => left.slot - right.slot)
      .map(buff => definedFields({ abilityId: buff.ability_id, scope: buff.scope }));
    function lineup(side, attacking) {
      const lineupUnits = units.filter(unit => unit.attacking === attacking);
      const heroes = lineupUnits.filter(unit => unit.slot > 0).map(unit => definedFields({
        unitId: unit.unit_id, progressionIndex: unit.progression_index, rank: unit.rank,
        startHPBefore: unit.start_hp_before, remainingHPBefore: unit.remaining_hp_before,
        startHPAfter: unit.start_hp_after, remainingHPAfter: unit.remaining_hp_after,
      }));
      const userId = row[`${side}_user_id`];
      const power = row[`${side}_power`];
      const machine = lineupUnits.find(unit => unit.slot === 0);
      if (userId == null && power == null && !heroes.length && !machine) return undefined;
      return definedFields({
        userId, lineupPower: power == null ? undefined : Number(power), units: heroes,
        machineOfWar: machine ? definedFields({ unitId: machine.unit_id, progressionIndex: machine.progression_index }) : undefined,
      });
    }
    return definedFields({
      type: 'battleFinished', id: row.source_battle_id, userId: row.source_user_id,
      teamIndex: row.attacking_side, createdOn: Date.parse(row.fought_at), score: row.score,
      abandoned: row.abandoned || undefined, attemptDebuff: row.attempt_debuff,
      zone: definedFields({ id: row.zone_id, type: row.zone_type, visualId: row.zone_visual_id }),
      attacker: lineup('attacker', true), defender: lineup('defender', false),
      buffs: buffs.length ? buffs : undefined,
    });
  }

  async function listArchivedWars() {
    warAvailability ??= isAvailable();
    if (!(await warAvailability)) throw new Error('War archive database is unavailable');
    const db = getClient();
    const rows = await fetchAll(() => db.from('war_archives')
      .select('archive_key,wars(started_at,ended_at,war_guilds(side,name))').order('archive_key'));
    return rows.map(({ archive_key: archiveKey, wars: war }) => {
      const guildNames = [...war.war_guilds].sort((left, right) => left.side - right.side)
        .map(guild => String(guild.name || 'Unknown guild').trim().replace(/\s+/g, ' '));
      const [first = 'Unknown guild', second = 'Unknown guild'] = guildNames;
      const opponent = first === '[TW] Praetorians of Terra' ? second : first;
      const end = new Date(war.ended_at).toISOString();
      const date = end.slice(0, 10);
      return {
        archiveKey,
        key: `history-${date}-${archiveKey.slice(0, 8)}`,
        label: `${opponent} (${date})`,
        sourceLabel: `${first} vs. ${second} (${date})`,
        start: new Date(war.started_at).toISOString(),
        end,
      };
    }).sort((left, right) => right.end.localeCompare(left.end) || left.key.localeCompare(right.key));
  }

  async function getArchivedWar(archiveKey) {
    warAvailability ??= isAvailable();
    if (!(await warAvailability)) return null;
    const db = getClient();
    const { data: archive, error } = await db.from('war_archives')
      .select(`event_id,war_id,wars(war_guilds(side,guild_id,name,icon,status),war_participants(player_id,display_name,avatar_unit_id,avatar_frame_id,title,title_gender),war_battles(${WAR_BATTLE_COLUMNS}))`)
      .eq('archive_key', archiveKey)
      .order('fought_at', { referencedTable: 'wars.war_battles' })
      .order('source_battle_id', { referencedTable: 'wars.war_battles' })
      .limit(PAGE_SIZE, { referencedTable: 'wars.war_battles' })
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!archive?.wars) return null;

    const embeddedBattles = archive.wars.war_battles;
    const battles = embeddedBattles.length < PAGE_SIZE ? embeddedBattles : [
      ...embeddedBattles,
      ...await fetchAll(() => db.from('war_battles').select(WAR_BATTLE_COLUMNS)
        .eq('war_id', archive.war_id).order('fought_at').order('source_battle_id'), embeddedBattles.length),
    ];
    const guilds = archive.wars.war_guilds.sort((left, right) => left.side - right.side);
    if (!battles.length || guilds.length !== 2) return null;
    return {
      eventResults: [{
        eventId: archive.event_id,
        eventResultType: 'SUCCESS',
        eventResponseData: {
          guildData: guilds.map(guild => definedFields({
            teamIndex: guild.side, guildId: guild.guild_id, name: guild.name,
            guildIcon: guild.icon, guildStatus: guild.status,
          })),
          playerData: archive.wars.war_participants.map(player => definedFields({
            userId: player.player_id, displayName: player.display_name, avatarUnitId: player.avatar_unit_id,
            avatarFrameId: player.avatar_frame_id, title: player.title, titleGender: player.title_gender,
          })),
          activityLogs: battles.map(warBattleToLog),
        },
      }],
    };
  }

  async function loadWarDataset({ key, archiveKey }) {
    if (archiveKey) {
      if (!warLoads.has(archiveKey)) {
        warLoads.set(archiveKey, getArchivedWar(archiveKey).catch(error => {
          warLoads.delete(archiveKey);
          throw error;
        }));
      }
      const data = await warLoads.get(archiveKey);
      if (data) return { data, lastModified: null };
      warLoads.delete(archiveKey);
      throw new Error(`War archive ${archiveKey} is unavailable`);
    }
    if (key !== 'current') throw new Error('Missing war archive key');
    const url = './data/war/current.json';
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
    return { data: await response.json(), lastModified: response.headers.get('last-modified') };
  }

  window.supabaseData = {
    getPlayers,
    getRaidManifest,
    getRaidSeason,
    getRaidPlayerTotals,
    loadWarDataset,
    listArchivedWars
  };
})();
