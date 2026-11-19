const fs = require('node:fs');
const path = require('node:path');
const { parseWarArchive } = require('./lib/war-archive');

const warDirectory = path.join(__dirname, '..', 'data', 'war');
const timestamp = (value) => new Date(value).toISOString();

function buildArchiveImport(archiveKey, payload) {
  const { eventId, guilds, participants, battles } = parseWarArchive(payload);
  const times = battles.map(({ log }) => log.createdOn);
  return {
    archive_event_id: eventId,
    source_key: archiveKey,
    first_battle: timestamp(Math.min(...times)),
    last_battle: timestamp(Math.max(...times)),
    guild_rows: guilds.map(guild => ({ guild_id: guild.guildId, side: guild.teamIndex, snapshot: guild })),
    participant_rows: participants.map(({ userId, guildId, ...profile }) => ({
      player_id: userId, guild_id: guildId, profile: { userId, ...profile },
    })),
    battle_rows: battles.map(({ log, attackerGuildId, defenderGuildId, attackerId, defenderId }) => ({
      source_battle_id: log.id,
      attacker_guild_id: attackerGuildId,
      defender_guild_id: defenderGuildId,
      attacker_id: attackerId,
      defender_id: defenderId,
      fought_at: timestamp(log.createdOn),
      score: log.score ?? null,
      abandoned: Boolean(log.abandoned),
      log,
    })),
  };
}

async function main(args) {
  if (args.some(arg => arg !== '--dry-run')) throw new Error('Usage: npm run db:import:war -- [--dry-run]');
  const dryRun = args.includes('--dry-run');
  const files = fs.readdirSync(warDirectory).filter(file => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.json$/i.test(file));
  const archives = files.map(file => {
    try {
      return buildArchiveImport(path.basename(file, '.json'), JSON.parse(fs.readFileSync(path.join(warDirectory, file), 'utf8')));
    } catch (error) {
      throw new Error(`${file}: ${error.message}`);
    }
  }).sort((left, right) => right.last_battle.localeCompare(left.last_battle));
  console.log(`${archives.length} archives, ${archives.reduce((count, archive) => count + archive.battle_rows.length, 0)} battles`);
  if (dryRun || !archives.length) return;

  const db = require('./lib/supabase-admin').createAdminClient();
  if (!db) throw new Error('Supabase admin credentials are required');
  for (let offset = 0; offset < archives.length; offset += 100) {
    const batch = archives.slice(offset, offset + 100);
    const { data: existing, error } = await db.from('war_archives').select('event_id,archive_key')
      .in('event_id', batch.map(archive => archive.archive_event_id));
    if (error) throw new Error(error.message);
    const published = new Map(existing.map(archive => [archive.event_id, archive.archive_key]));
    for (const archive of batch) {
      const archiveKey = published.get(archive.archive_event_id);
      if (archiveKey === archive.source_key) continue;
      if (archiveKey) throw new Error(`Archive ${archive.source_key} already exists as ${archiveKey}`);
      const { error: importError } = await db.rpc('import_war_archive', archive);
      if (importError) throw new Error(`${archive.source_key}: ${importError.message}`);
      console.log(`Imported ${archive.source_key} (${archive.battle_rows.length} battles)`);
    }
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildArchiveImport };