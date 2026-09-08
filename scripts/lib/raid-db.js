// Shared upsert logic: turns a raid season payload (same shape as the JSON
// files under data/raid/) into rows in raid_seasons / raid_entries. Used by
// scripts/import-to-supabase.js (backfill) and scripts/fetch-guild-raid.js
// (live fetch). The hero lineup is flattened onto the raid_entries row.

const ENTRY_BATCH_SIZE = 500;
const HERO_SLOTS = 5;

function toTimestamp(unixSeconds) {
  return Number.isFinite(unixSeconds) && unixSeconds > 0
    ? new Date(unixSeconds * 1000).toISOString()
    : null;
}

function toEntryRow(guildId, season, entry) {
  const mow = entry.machineOfWarDetails || null;
  const heroes = Array.isArray(entry.heroDetails) ? entry.heroDetails : [];

  const row = {
    guild_id: guildId,
    season,
    user_id: null,          // FK, filled in after we know which players exist
    user_id_text: entry.userId || null,
    tier: entry.tier ?? 0,
    set_index: entry.set ?? 0,
    encounter_index: entry.encounterIndex ?? 0,
    encounter_type: entry.encounterType || '',
    boss_unit_id: entry.unitId || '',
    boss_type: entry.type || '',
    rarity: entry.rarity || '',
    damage_dealt: entry.damageDealt ?? 0,
    damage_type: entry.damageType || '',
    remaining_hp: entry.remainingHp ?? 0,
    max_hp: entry.maxHp ?? 0,
    started_on: toTimestamp(entry.startedOn),
    completed_on: toTimestamp(entry.completedOn),
    mow_unit_id: mow ? mow.unitId || '' : null,
    mow_power: mow ? mow.power ?? null : null
  };

  for (let slot = 0; slot < Math.min(heroes.length, HERO_SLOTS); slot += 1) {
    row[`unit_id_${slot + 1}`] = heroes[slot].unitId || '';
    row[`unit_${slot + 1}_power`] = heroes[slot].power ?? 0;
  }

  // Safety net: every attack so far uses 5 hero slots, but if the game ever
  // sends more, keep the overflow instead of dropping it.
  if (heroes.length > HERO_SLOTS) {
    row.extra_unit_ids = heroes.slice(HERO_SLOTS).map((hero) => hero.unitId || '');
    row.extra_unit_powers = heroes.slice(HERO_SLOTS).map((hero) => hero.power ?? 0);
  }

  return row;
}

function summarize(entries) {
  const timestamps = entries
    .map((entry) => entry.completedOn || entry.startedOn)
    .filter((value) => Number.isFinite(value) && value > 0);

  return {
    entries: entries.length,
    players: new Set(entries.map((entry) => entry.userId).filter(Boolean)).size,
    damage: entries.reduce((total, entry) => total + (Number(entry.damageDealt) || 0), 0),
    start: timestamps.length > 0 ? toTimestamp(Math.min(...timestamps)) : null,
    end: timestamps.length > 0 ? toTimestamp(Math.max(...timestamps)) : null
  };
}

async function upsertPlayers(client, players) {
  const rows = players.map((player) => ({
    id: player.id,
    name: player.name || '',
    avatar_unit_id: player.avatarUnitId || '',
    avatar_frame_id: player.avatarFrameId || '',
    updated_at: new Date().toISOString()
  }));

  const { error } = await client
    .from('players')
    .upsert(rows, { onConflict: 'id' });

  if (error) throw new Error(`players upsert failed: ${error.message}`);
  return rows.length;
}

// Replaces a season's data. Entries are deleted and re-inserted, which keeps
// the operation idempotent: re-running a season always converges to the
// payload's state.
async function upsertSeason(client, payload) {
  const season = Number(payload.season);
  if (!Number.isFinite(season)) {
    throw new Error('payload has no valid season number');
  }

  const guild = payload.guild || {};
  const guildId = guild.guildTag || '';
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const summary = summarize(entries);

  const { error: seasonError } = await client
    .from('raid_seasons')
    .upsert({
      season,
      guild_id: guildId,
      season_config_id: payload.seasonConfigId ?? null,
      guild_name: guild.name || '',
      guild_tag: guild.guildTag || '',
      guild_level: guild.level ?? null,
      fetched_on: toTimestamp(payload.fetchedOn),
      entries: summary.entries,
      players: summary.players,
      damage: summary.damage,
      start: summary.start,
      end: summary.end
    }, { onConflict: 'season' });

  if (seasonError) throw new Error(`raid_seasons upsert failed: ${seasonError.message}`);

  const { error: deleteError } = await client
    .from('raid_entries')
    .delete()
    .eq('season', season)
    .eq('guild_id', guildId);

  if (deleteError) throw new Error(`raid_entries delete failed: ${deleteError.message}`);

  let inserted = 0;

  for (let start = 0; start < entries.length; start += ENTRY_BATCH_SIZE) {
    const batch = entries.slice(start, start + ENTRY_BATCH_SIZE);
    const { data, error } = await client
      .from('raid_entries')
      .insert(batch.map((entry) => toEntryRow(guildId, season, entry)))
      .select('id');

    if (error) throw new Error(`raid_entries insert failed: ${error.message}`);

    // Link the FK only for players present in the directory; the raw id is
    // always kept in user_id_text so nothing is lost.
    const userIds = [...new Set(batch.map((entry) => entry.userId).filter(Boolean))];
    if (userIds.length > 0) {
      const { data: known, error: lookupError } = await client
        .from('players')
        .select('id')
        .in('id', userIds);

      if (lookupError) throw new Error(`players lookup failed: ${lookupError.message}`);

      const knownIds = new Set(known.map((row) => row.id));
      const updates = data
        .map((row, index) => ({ id: row.id, userId: batch[index].userId }))
        .filter(({ userId }) => userId && knownIds.has(userId));

      for (const { id, userId } of updates) {
        const { error: linkError } = await client
          .from('raid_entries')
          .update({ user_id: userId })
          .eq('id', id);

        if (linkError) throw new Error(`raid_entries link failed: ${linkError.message}`);
      }
    }

    inserted += data.length;
  }

  return { season, entries: inserted };
}

module.exports = { upsertPlayers, upsertSeason };
