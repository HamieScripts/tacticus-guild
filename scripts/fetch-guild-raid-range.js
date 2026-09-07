const fs = require('fs');
const path = require('path');

const {
  RAID_DIR,
  apiGet,
  buildSeasonPayload,
  readApiKey,
  readJson,
  summarizeSeason,
  writeJson,
  writeSeason
} = require('./fetch-guild-raid');

const MANIFEST_PATH = path.join(RAID_DIR, 'manifest.json');
const MAX_CONCURRENT_REQUESTS = 10;
const MIN_REQUEST_DELAY_MS = 1000;
const MAX_REQUEST_DELAY_MS = 3000;

function printUsage() {
  console.error('Usage: node scripts/fetch-guild-raid-range.js --start <season> --end <season> [--force]');
}

function readArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--force') {
      values.force = true;
      continue;
    }

    const match = argument.match(/^--(start|end)=(\d+)$/);
    if (match) {
      values[match[1]] = Number(match[2]);
      continue;
    }

    if (argument === '--start' || argument === '--end') {
      const value = Number(args[index + 1]);
      if (Number.isInteger(value)) values[argument.slice(2)] = value;
      index += 1;
      continue;
    }

    if (argument === '--help' || argument === '-h') {
      printUsage();
      return null;
    }
  }

  if (!Number.isInteger(values.start) || !Number.isInteger(values.end)
    || values.start < 1 || values.end < values.start) {
    printUsage();
    throw new Error('Start and end must be positive season numbers, with start <= end.');
  }

  return values;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function delayedApiGet(endpoint, apiKey) {
  const milliseconds = MIN_REQUEST_DELAY_MS
    + Math.floor(Math.random() * (MAX_REQUEST_DELAY_MS - MIN_REQUEST_DELAY_MS + 1));
  await delay(milliseconds);
  return apiGet(endpoint, apiKey);
}

function mergeManifest(manifest, summaries, currentSeason) {
  const bySeason = new Map(
    (Array.isArray(manifest?.seasons) ? manifest.seasons : [])
      .map((summary) => [Number(summary.season), summary])
  );

  for (const summary of summaries) bySeason.set(Number(summary.season), summary);

  return {
    fetchedOn: Math.round(Date.now() / 1000),
    current: currentSeason || manifest?.current || null,
    seasons: [...bySeason.values()].sort((left, right) => right.season - left.season)
  };
}

async function main() {
  const options = readArguments(process.argv.slice(2));
  if (!options) return;

  const apiKey = readApiKey();
  if (!apiKey) {
    throw new Error('Missing GUILD_RAID_API_KEY. Run "npm run raid:key" locally, or set the secret in CI.');
  }

  fs.mkdirSync(RAID_DIR, { recursive: true });

  let guild = null;
  try {
    const guildResponse = await delayedApiGet('/guild', apiKey);
    guild = guildResponse?.guild || null;
  } catch (error) {
    console.warn(`Guild lookup skipped: ${error.message}`);
  }

  const live = buildSeasonPayload(await delayedApiGet('/guildRaid', apiKey), guild);
  const currentSeason = Number(live.season);
  const summaries = [];
  const force = Boolean(options.force);
  const seasonsToFetch = [];

  for (let season = options.start; season <= options.end; season += 1) {
    const seasonPath = path.join(RAID_DIR, `${season}.json`);

    if (!force && season !== currentSeason && fs.existsSync(seasonPath)) {
      const cached = readJson(seasonPath);
      if (cached) {
        summaries.push(summarizeSeason(cached));
        console.log(`Season ${season}: cached`);
        continue;
      }
    }

    seasonsToFetch.push(season);
  }

  let nextSeasonIndex = 0;
  async function fetchNextSeason() {
    while (nextSeasonIndex < seasonsToFetch.length) {
      const season = seasonsToFetch[nextSeasonIndex];
      nextSeasonIndex += 1;

      try {
        const payload = season === currentSeason
          ? live
          : buildSeasonPayload(await delayedApiGet(`/guildRaid/${season}`, apiKey), guild);

        if (payload.entries.length === 0) {
          console.log(`Season ${season}: empty, skipped`);
          continue;
        }

        writeSeason(payload);
        summaries.push(summarizeSeason(payload));
        if (season === currentSeason) writeJson(path.join(RAID_DIR, 'current.json'), payload);
        console.log(`Season ${season}: fetched ${payload.entries.length} entries`);
      } catch (error) {
        console.log(`Season ${season}: unavailable (${error.message})`);
      }
    }
  }

  const workerCount = Math.min(MAX_CONCURRENT_REQUESTS, seasonsToFetch.length);
  await Promise.all(Array.from({ length: workerCount }, () => fetchNextSeason()));

  const manifest = mergeManifest(readJson(MANIFEST_PATH), summaries, currentSeason);
  writeJson(MANIFEST_PATH, manifest);
  console.log(`Fetched ${summaries.length} season(s) for requested range ${options.start}-${options.end}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
