const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.join(__dirname, '..', 'data');
const HISTORY_DIR = path.join(DATA_ROOT, 'history');
const MANIFEST_PATH = path.join(DATA_ROOT, 'dataset-manifest.json');
const HASH_PATH = path.join(DATA_ROOT, 'dataset-manifest.hash');

function formatDateFromTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }

  return date.toISOString().slice(0, 10);
}

function cleanGuildName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function getLatestCreatedOn(data) {
  const eventResults = Array.isArray(data?.eventResults) ? data.eventResults : [];
  let max = 0;
  for (const result of eventResults) {
    const logs = Array.isArray(result?.eventResponseData?.activityLogs)
      ? result.eventResponseData.activityLogs
      : [];
    for (const log of logs) {
      if (typeof log?.createdOn === 'number' && log.createdOn > max) {
        max = log.createdOn;
      }
    }
  }
  return max > 0 ? max : null;
}

function getPrimaryGuildNames(data) {
  const eventResults = Array.isArray(data?.eventResults) ? data.eventResults : [];
  const primaryEvent = eventResults
    .map((eventResult) => eventResult?.eventResponseData)
    .filter((entry) => entry && typeof entry === 'object')
    .sort((left, right) => {
      const leftScore = (Array.isArray(left?.guildData) ? left.guildData.length : 0) * 1000
        + (Array.isArray(left?.activityLogs) ? left.activityLogs.length : 0);
      const rightScore = (Array.isArray(right?.guildData) ? right.guildData.length : 0) * 1000
        + (Array.isArray(right?.activityLogs) ? right.activityLogs.length : 0);
      return rightScore - leftScore;
    })[0];

  const guildData = Array.isArray(primaryEvent?.guildData) ? primaryEvent.guildData : [];
  const names = guildData
    .map((guild) => cleanGuildName(guild?.name))
    .filter(Boolean)
    .slice(0, 2);

  if (names.length >= 2) return names;
  if (names.length === 1) return [names[0], 'Unknown guild'];
  return ['Unknown guild', 'Unknown guild'];
}

function main() {
  const historyFiles = fs.existsSync(HISTORY_DIR)
    ? fs.readdirSync(HISTORY_DIR)
        .filter((file) => file.toLowerCase().endsWith('.json'))
        .map((file) => path.join(HISTORY_DIR, file))
    : [];

  const datasets = historyFiles.map((filePath) => {
    const fileName = path.basename(filePath, '.json');
    const data = (() => {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        return null;
      }
    })();
    const latestCreatedOn = getLatestCreatedOn(data);
    const date = formatDateFromTimestamp(latestCreatedOn ?? fs.statSync(filePath).mtime);
    const [guildA, guildB] = getPrimaryGuildNames(data);
    const key = `history-${date}-${fileName.slice(0, 8)}`;
    const label = `${guildA} vs. ${guildB} (${date})`;
    const sourceLabel = `${guildA} vs. ${guildB} (${date})`;

    console.log(`[dataset] ${label} -> ${fileName}.json`);

    return {
      key,
      label,
      sourceLabel,
      url: `./data/history/${fileName}.json`,
      _createdOn: latestCreatedOn ?? 0,
    };
  }).sort((a, b) => b._createdOn - a._createdOn).map(({ _createdOn: _, ...rest }) => rest);

  const hash = (process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || process.env.npm_package_version || `local-${Date.now()}`)
    .toString()
    .trim();
  const cacheValue = hash.slice(0, 12);

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify({ datasets, hash: cacheValue }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(HASH_PATH, `${cacheValue}\n`, 'utf8');

  console.log(`Wrote ${datasets.length} dataset entries to ${path.relative(process.cwd(), MANIFEST_PATH)} with cache hash ${cacheValue}`);
}

main();
