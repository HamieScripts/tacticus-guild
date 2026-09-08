// Backfills Supabase from the JSON files: data/static/players.json and every
// numbered season in data/raid/. current.json is skipped on purpose — it
// duplicates the latest numbered season file.
//
// Usage:
//   npm run db:import                       # players + all seasons
//   npm run db:import -- --season 108       # a single season
//   npm run db:import -- --players-only     # just the players directory
//   npm run db:import -- --dry-run          # count rows, write nothing

const fs = require('fs');
const path = require('path');
const { createAdminClient } = require('./lib/supabase-admin');
const { upsertPlayers, upsertSeason } = require('./lib/raid-db');

const ROOT = path.join(__dirname, '..');
const RAID_DIR = path.join(ROOT, 'data', 'raid');
const PLAYERS_FILE = path.join(ROOT, 'data', 'static', 'players.json');
const MANIFEST_FILE = path.join(RAID_DIR, 'manifest.json');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function parseArgs(argv) {
  const args = { season: null, playersOnly: false, dryRun: false };

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--season') {
      args.season = Number(argv[index + 1]);
      index += 1;
    } else if (argv[index] === '--players-only') {
      args.playersOnly = true;
    } else if (argv[index] === '--dry-run') {
      args.dryRun = true;
    }
  }

  return args;
}

function listSeasonFiles() {
  return fs.readdirSync(RAID_DIR)
    .map((name) => /^(\d+)\.json$/.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((left, right) => left - right);
}

function expectedCounts(payload) {
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const heroOverflow = entries.filter(
    (entry) => Array.isArray(entry.heroDetails) && entry.heroDetails.length > 5
  ).length;
  return { entries: entries.length, heroOverflow };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.season !== null && !Number.isFinite(args.season)) {
    console.error('--season requires a number, e.g. --season 108');
    process.exitCode = 1;
    return;
  }

  const client = args.dryRun ? null : createAdminClient();
  if (!args.dryRun && !client) {
    process.exitCode = 1;
    return;
  }

  // --- Players ------------------------------------------------------------
  const players = readJson(PLAYERS_FILE) || [];
  if (players.length === 0) {
    console.warn(`No players found in ${PLAYERS_FILE}`);
  } else if (args.dryRun) {
    console.log(`[dry-run] players: ${players.length} rows`);
  } else {
    const count = await upsertPlayers(client, players);
    console.log(`players: upserted ${count}`);
  }

  if (args.playersOnly) return;

  // --- Raid seasons ---------------------------------------------------------
  const seasons = args.season !== null ? [args.season] : listSeasonFiles();
  const manifest = readJson(MANIFEST_FILE);
  const manifestBySeason = new Map(
    (manifest?.seasons || []).map((summary) => [Number(summary.season), summary])
  );

  let totalEntries = 0;
  let mismatches = 0;

  for (const season of seasons) {
    const filePath = path.join(RAID_DIR, `${season}.json`);
    const payload = readJson(filePath);

    if (!payload) {
      console.warn(`Season ${season}: no readable JSON at ${filePath}, skipped`);
      continue;
    }

    const expected = expectedCounts(payload);

    if (args.dryRun) {
      const overflow = expected.heroOverflow > 0 ? `, ${expected.heroOverflow} entries with >5 heroes` : '';
      console.log(`[dry-run] season ${season}: ${expected.entries} entries${overflow}`);
      totalEntries += expected.entries;
      continue;
    }

    try {
      const result = await upsertSeason(client, payload);
      totalEntries += result.entries;

      let note = '';
      const manifestEntry = manifestBySeason.get(season);
      if (manifestEntry && Number(manifestEntry.entries) !== result.entries) {
        mismatches += 1;
        note = ` (manifest says ${manifestEntry.entries} entries — mismatch)`;
      }

      console.log(`season ${season}: ${result.entries} entries${note}`);
      if (expected.heroOverflow > 0) {
        console.warn(`  warning: ${expected.heroOverflow} entries had >5 heroes (stored in extra_unit_ids)`);
      }
    } catch (error) {
      console.error(`season ${season}: failed — ${error.message}`);
      process.exitCode = 1;
    }
  }

  console.log(
    `${args.dryRun ? '[dry-run] ' : ''}done: ${seasons.length} season(s), ${totalEntries} entries` +
    (mismatches > 0 ? `, ${mismatches} manifest mismatch(es)` : '')
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
