const fs = require('fs');
const path = require('path');
const { createAdminClient } = require('./lib/supabase-admin');
const { upsertSeason } = require('./lib/raid-db');

const API_BASE = 'https://api.tacticusgame.com/api/v1';
const ROOT = path.join(__dirname, '..');
const RAID_DIR = path.join(ROOT, 'data', 'raid');
const ENV_FILE = path.join(ROOT, '.env.local');
const MIN_SEASON = 90;

function readApiKey() {
  const fromEnv = String(process.env.GUILD_RAID_API_KEY || '').trim();
  if (fromEnv) return fromEnv;

  if (!fs.existsSync(ENV_FILE)) return '';

  const line = fs.readFileSync(ENV_FILE, 'utf8')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('GUILD_RAID_API_KEY='));

  return line ? line.slice('GUILD_RAID_API_KEY='.length).trim().replace(/^["']|["']$/g, '') : '';
}

async function apiGet(endpoint, apiKey) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'X-API-KEY': apiKey, Accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`GET ${endpoint} failed with ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function toUnixSeconds(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Math.round(value > 1e11 ? value / 1000 : value);

  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.round(numeric > 1e11 ? numeric / 1000 : numeric);

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.round(parsed / 1000);
}

function normalizeEntry(entry) {
  return {
    userId: String(entry?.userId || ''),
    tier: Number(entry?.tier ?? 0),
    set: Number(entry?.set ?? 0),
    encounterIndex: Number(entry?.encounterIndex ?? 0),
    encounterType: String(entry?.encounterType || ''),
    unitId: String(entry?.unitId || ''),
    type: String(entry?.type || ''),
    rarity: String(entry?.rarity || ''),
    damageDealt: Number(entry?.damageDealt ?? 0),
    damageType: String(entry?.damageType || ''),
    remainingHp: Number(entry?.remainingHp ?? 0),
    maxHp: Number(entry?.maxHp ?? 0),
    startedOn: toUnixSeconds(entry?.startedOn),
    completedOn: toUnixSeconds(entry?.completedOn),
    heroDetails: Array.isArray(entry?.heroDetails)
      ? entry.heroDetails.map((hero) => ({
          unitId: String(hero?.unitId || ''),
          power: Number(hero?.power ?? 0)
        }))
      : [],
    machineOfWarDetails: entry?.machineOfWarDetails
      ? {
          unitId: String(entry.machineOfWarDetails.unitId || ''),
          power: Number(entry.machineOfWarDetails.power ?? 0)
        }
      : null
  };
}

function buildSeasonPayload(raid, guild) {
  return {
    fetchedOn: Math.round(Date.now() / 1000),
    season: raid?.season ?? null,
    seasonConfigId: raid?.seasonConfigId ?? null,
    guild: guild
      ? {
          name: guild.name || '',
          guildTag: guild.guildTag || '',
          level: guild.level ?? null,
          seasons: Array.isArray(guild.guildRaidSeasons) ? guild.guildRaidSeasons : []
        }
      : null,
    entries: (Array.isArray(raid?.entries) ? raid.entries : []).map(normalizeEntry)
  };
}

function summarizeSeason(payload) {
  const timestamps = payload.entries
    .map((entry) => entry.completedOn || entry.startedOn)
    .filter((value) => Number.isFinite(value) && value > 0);

  return {
    season: payload.season,
    url: `./data/raid/${payload.season}.json`,
    entries: payload.entries.length,
    players: new Set(payload.entries.map((entry) => entry.userId).filter(Boolean)).size,
    damage: payload.entries.reduce((total, entry) => total + (Number(entry.damageDealt) || 0), 0),
    start: timestamps.length > 0 ? Math.min(...timestamps) : null,
    end: timestamps.length > 0 ? Math.max(...timestamps) : null
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

// Skips the write when only `fetchedOn` would differ, so unchanged data stays out of git.
function writeJson(filePath, payload) {
  const existing = readJson(filePath);
  const isSame = existing
    && JSON.stringify({ ...existing, fetchedOn: 0 }) === JSON.stringify({ ...payload, fetchedOn: 0 });

  if (isSame) return false;

  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return true;
}

function writeSeason(payload) {
  return writeJson(path.join(RAID_DIR, `${payload.season}.json`), payload);
}

async function main() {
  const apiKey = readApiKey();
  if (!apiKey) {
    console.error('Missing GUILD_RAID_API_KEY. Run "npm run raid:key" locally, or set the secret in CI.');
    process.exitCode = 1;
    return;
  }

  const force = process.argv.includes('--force');
  const noDb = process.argv.includes('--no-db');

  // DB is the source of truth; a missing config only skips the write, it never
  // blocks the JSON export.
  const db = noDb ? null : createAdminClient({ optional: true });
  const dbResults = [];
  const syncSeason = async (payload) => {
    if (!db) return;
    try {
      const result = await upsertSeason(db, payload);
      dbResults.push(`season ${result.season}: ${result.entries} entries -> supabase`);
    } catch (error) {
      console.warn(`Supabase write failed for season ${payload.season}: ${error.message}`);
      process.exitCode = 1;
    }
  };

  fs.mkdirSync(RAID_DIR, { recursive: true });

  let guild = null;
  try {
    const guildResponse = await apiGet('/guild', apiKey);
    guild = guildResponse?.guild || null;
  } catch (error) {
    console.warn(`Guild lookup skipped: ${error.message}`);
  }

  const live = buildSeasonPayload(await apiGet('/guildRaid', apiKey), guild);
  const currentSeason = Number(live.season);

  // A season we previously captured while it was live is incomplete, so refetch it once it ends.
  const previousManifest = readJson(path.join(RAID_DIR, 'manifest.json'));
  const previousCurrent = Number(previousManifest?.current);
  const staleSeason = Number.isFinite(previousCurrent) && previousCurrent !== currentSeason ? previousCurrent : null;

  writeSeason(live);
  writeJson(path.join(RAID_DIR, 'current.json'), live);
  await syncSeason(live);
  const seasons = [summarizeSeason(live)];
  console.log(`Season ${currentSeason} (live): ${live.entries.length} entries`);

  if (staleSeason !== null) {
    console.log(`Season rolled over from ${staleSeason} to ${currentSeason}, refetching ${staleSeason}`);
  }

  for (let season = currentSeason - 1; season >= MIN_SEASON; season -= 1) {
    const seasonPath = path.join(RAID_DIR, `${season}.json`);

    // Completed seasons never change, so only refetch them on demand.
    if (!force && season !== staleSeason && fs.existsSync(seasonPath)) {
      seasons.push(summarizeSeason(JSON.parse(fs.readFileSync(seasonPath, 'utf8'))));
      console.log(`Season ${season}: cached`);
      continue;
    }

    try {
      const payload = buildSeasonPayload(await apiGet(`/guildRaid/${season}`, apiKey), guild);
      if (payload.entries.length === 0) {
        console.log(`Season ${season}: empty, skipped`);
        continue;
      }
      writeSeason(payload);
      await syncSeason(payload);
      seasons.push(summarizeSeason(payload));
      console.log(`Season ${season}: ${payload.entries.length} entries`);
    } catch (error) {
      console.log(`Season ${season}: unavailable (${error.message})`);
    }
  }

  const manifest = {
    fetchedOn: Math.round(Date.now() / 1000),
    current: currentSeason,
    seasons: seasons.sort((left, right) => right.season - left.season)
  };
  writeJson(path.join(RAID_DIR, 'manifest.json'), manifest);

  for (const line of dbResults) console.log(line);
  console.log(`Wrote ${seasons.length} season(s) to data/raid/`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  RAID_DIR,
  apiGet,
  buildSeasonPayload,
  readApiKey,
  readJson,
  summarizeSeason,
  writeJson,
  writeSeason
};
