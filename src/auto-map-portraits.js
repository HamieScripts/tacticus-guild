const fs = require('fs');
const path = require('path');

const DATA_ROOT = process.argv[2] || 'data';
const SOURCE_DIR = process.argv[3] || 'img-temp';
const MAP_PATH = process.argv[4] || 'data/static/portrait-map.json';
const IMAGE_MANIFEST_PATH = process.argv[5] || 'data/static/image-manifest.json';

function collectUnitIdsFromSnapshot(snapshot) {
  const ids = new Set();
  const eventResults = Array.isArray(snapshot?.eventResults) ? snapshot.eventResults : [];

  for (const eventResult of eventResults) {
    const logs = eventResult?.eventResponseData?.activityLogs || [];
    if (!Array.isArray(logs)) {
      continue;
    }

    for (const log of logs) {
      if (log.type !== 'battleFinished') {
        continue;
      }

      for (const side of ['attacker', 'defender']) {
        const units = log[side]?.units || [];
        for (const unit of units) {
          if (unit && unit.unitId) {
            ids.add(unit.unitId);
          }
        }

        const machine = log[side]?.machineOfWar;
        if (machine && machine.unitId) {
          ids.add(machine.unitId);
        }
      }
    }
  }

  return ids;
}

function normalizeDatasetUrlToPath(urlValue, dataRoot) {
  const raw = String(urlValue || '').trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/^\.?\/?data\//i, '')
    .replace(/\\/g, '/');
  return path.join(dataRoot, cleaned);
}

function collectSnapshotPaths(dataRoot) {
  const snapshotPaths = new Set();

  const currentDir = path.join(dataRoot, 'current');
  const historyDir = path.join(dataRoot, 'history');

  [currentDir, historyDir].forEach((dirPath) => {
    if (!fs.existsSync(dirPath)) return;
    fs.readdirSync(dirPath)
      .filter((name) => name.toLowerCase().endsWith('.json'))
      .forEach((name) => snapshotPaths.add(path.join(dirPath, name)));
  });

  const datasetManifestPath = path.join(dataRoot, 'dataset-manifest.json');
  if (fs.existsSync(datasetManifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(datasetManifestPath, 'utf8'));
    const datasets = Array.isArray(manifest?.datasets) ? manifest.datasets : [];
    datasets.forEach((dataset) => {
      const snapshotPath = normalizeDatasetUrlToPath(dataset?.url, dataRoot);
      if (snapshotPath && fs.existsSync(snapshotPath)) {
        snapshotPaths.add(snapshotPath);
      }
    });
  }

  return Array.from(snapshotPaths).sort((a, b) => a.localeCompare(b));
}

function collectUnitIds(dataRoot) {
  const ids = new Set();
  const snapshotPaths = collectSnapshotPaths(dataRoot);

  snapshotPaths.forEach((snapshotPath) => {
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    const fromSnapshot = collectUnitIdsFromSnapshot(snapshot);
    fromSnapshot.forEach((unitId) => ids.add(unitId));
  });

  return {
    unitIds: Array.from(ids).sort((a, b) => a.localeCompare(b)),
    snapshotPaths
  };
}

function collectPortraitImageManifest(sourceDir) {
  if (!fs.existsSync(sourceDir)) {
    return [];
  }

  return fs
    .readdirSync(sourceDir)
    .filter((name) => name.startsWith('ui_image_portrait'))
    .filter((name) => /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
}

function main() {
  if (!fs.existsSync(DATA_ROOT)) {
    throw new Error(`Data root not found: ${DATA_ROOT}`);
  }
  if (!fs.existsSync(SOURCE_DIR)) {
    throw new Error(`Source directory not found: ${SOURCE_DIR}`);
  }

  const { unitIds, snapshotPaths } = collectUnitIds(DATA_ROOT);
  const portraitMap = fs.existsSync(MAP_PATH)
    ? JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'))
    : {};

  let addedIds = 0;
  unitIds.forEach((unitId) => {
    if (!Object.prototype.hasOwnProperty.call(portraitMap, unitId)) {
      portraitMap[unitId] = 'unknown';
      addedIds += 1;
    }
  });

  const sortedPortraitMap = Object.fromEntries(
    Object.entries(portraitMap).sort((a, b) => a[0].localeCompare(b[0]))
  );

  const imageManifest = collectPortraitImageManifest(SOURCE_DIR);

  fs.writeFileSync(MAP_PATH, `${JSON.stringify(sortedPortraitMap, null, 2)}\n`);
  fs.writeFileSync(IMAGE_MANIFEST_PATH, `${JSON.stringify(imageManifest, null, 2)}\n`);

  console.log(`Snapshots scanned: ${snapshotPaths.length}`);
  console.log(`Character IDs found: ${unitIds.length}`);
  console.log(`Portrait map path: ${MAP_PATH}`);
  console.log(`New character IDs added: ${addedIds}`);
  console.log(`Image manifest path: ${IMAGE_MANIFEST_PATH}`);
  console.log(`Manifest images (ui_image_portrait*): ${imageManifest.length}`);
}

main();
