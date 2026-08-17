const fs = require('fs');
const path = require('path');

const DATA_ROOT = path.join(__dirname, '..', 'data');
const HISTORY_DIR = path.join(DATA_ROOT, 'history');
const MANIFEST_PATH = path.join(DATA_ROOT, 'dataset-manifest.json');

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function hasMeaningfulData(data) {
  if (data === null || data === undefined) return false;
  if (typeof data !== 'object') return false;
  if (Array.isArray(data)) return data.length > 0;
  return Object.keys(data).length > 0;
}

function formatDateFromTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }

  return date.toISOString().slice(0, 10);
}

function main() {
  const historyFiles = fs.existsSync(HISTORY_DIR)
    ? fs.readdirSync(HISTORY_DIR)
        .filter((file) => file.toLowerCase().endsWith('.json'))
        .map((file) => path.join(HISTORY_DIR, file))
        .filter((filePath) => hasMeaningfulData(safeReadJson(filePath)))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];

  const datasets = historyFiles.map((filePath) => {
    const fileName = path.basename(filePath, '.json');
    const date = formatDateFromTimestamp(fs.statSync(filePath).mtime);
    const key = `history-${date}`;
    const label = `History ${date}`;
    const sourceLabel = `History snapshot ${date}`;

    return {
      key,
      label,
      sourceLabel,
      url: `./data/history/${fileName}.json`
    };
  });

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify({ datasets }, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${datasets.length} dataset entries to ${path.relative(process.cwd(), MANIFEST_PATH)}`);
}

main();
