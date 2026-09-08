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

  function getClient() {
    if (client) return client;
    if (typeof supabase === 'undefined' || typeof SUPABASE_URL === 'undefined') return null;
    client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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

  async function fetchAll(queryFactory) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
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
      .select('season, season_config_id, guild_name, guild_tag, guild_level, fetched_on')
      .eq('season', season)
      .maybeSingle();

    if (seasonError) throw new Error(seasonError.message);
    if (!seasonRow) return null;

    const rows = await fetchAll(() => db
      .from('raid_entries')
      .select(ENTRY_COLUMNS)
      .eq('season', season));

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
      fetchAll(() => db.from('raid_seasons').select('season, start, end').order('season', { ascending: true })),
      fetchAll(() => db.from('raid_entries').select('season, user_id, user_id_text, damage_dealt'))
    ]);

    const seasonsByNumber = new Map(seasonRows.map((row) => [row.season, row]));
    const totalsBySeason = new Map();

    entryRows.forEach((row) => {
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

  window.supabaseData = {
    getPlayers,
    getRaidManifest,
    getRaidSeason,
    getRaidPlayerTotals
  };
})();
