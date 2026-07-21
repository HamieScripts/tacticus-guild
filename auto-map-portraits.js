const fs = require('fs');
const path = require('path');

const DATA_PATH = process.argv[2] || 'data/current/23e724b8-8f75-4b66-9c93-c15966a8cb32.json';
const SOURCE_DIR = process.argv[3] || 'img';
const MAP_PATH = process.argv[4] || 'portrait-rename-map.json';
const MIN_SCORE = Number(process.argv[5] || 8);

function splitCamel(value) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .flatMap((token) => token.split(/(?=[A-Z])/))
    .map((token) => token.toLowerCase())
    .filter(Boolean);
}

function normalize(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sourceTokens(fileName) {
  const stopWords = new Set(['removebg', 'preview', 'the', 'and']);
  let cleaned = fileName
    .replace(/\.webp$/i, '')
    .replace(/removebgpreview/ig, '')
    .replace(/removebg/ig, '')
    .replace(/preview/ig, '')
    .replace(/[_-]+/g, ' ');

  let tokens = cleaned
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean)
    .filter((token) => !stopWords.has(token));

  if (tokens.length <= 1) {
    tokens = splitCamel(cleaned.replace(/\s+/g, ''));
  }

  return [...new Set(tokens.filter((token) => token.length > 1 && !stopWords.has(token)))];
}

function idTokens(unitId) {
  return [...new Set(splitCamel(unitId))];
}

function score(fileName, unitId) {
  const source = sourceTokens(fileName);
  const target = idTokens(unitId);
  const sourceNorm = normalize(fileName.replace(/\.webp$/i, ''));
  const targetNorm = normalize(unitId);

  const overlap = source.filter((token) => target.includes(token));
  let value = overlap.length * 3;

  if (overlap.length && overlap.includes(source[source.length - 1])) {
    value += 2;
  }

  if (sourceNorm === targetNorm) {
    value += 100;
  }

  if (targetNorm.includes(sourceNorm) || sourceNorm.includes(targetNorm)) {
    value += 4;
  }

  for (const token of source) {
    if (token.length >= 4 && targetNorm.includes(token)) {
      value += 2;
    }
  }

  if (source.length === 1 && overlap.length === 0) {
    value -= 2;
  }

  return { value, overlap };
}

function collectUnitIds(snapshotPath) {
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const logs = snapshot.eventResults?.[0]?.eventResponseData?.activityLogs || [];
  const ids = new Set();

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

  return [...ids].sort();
}

function main() {
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`Snapshot not found: ${DATA_PATH}`);
  }
  if (!fs.existsSync(SOURCE_DIR)) {
    throw new Error(`Source directory not found: ${SOURCE_DIR}`);
  }
  if (!fs.existsSync(MAP_PATH)) {
    throw new Error(`Map file not found: ${MAP_PATH}`);
  }

  const unitIds = collectUnitIds(DATA_PATH);
  const renameMap = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));

  const mappedUnitIds = new Set(Object.values(renameMap));
  const sourceFiles = fs
    .readdirSync(SOURCE_DIR)
    .filter((name) => name.toLowerCase().endsWith('.webp'))
    .sort((a, b) => a.localeCompare(b));

  const additions = [];

  for (const fileName of sourceFiles) {
    if (renameMap[fileName]) {
      continue;
    }

    const baseName = path.parse(fileName).name;

    if (mappedUnitIds.has(baseName)) {
      continue;
    }

    let best = null;
    for (const unitId of unitIds) {
      if (mappedUnitIds.has(unitId)) {
        continue;
      }

      const result = score(fileName, unitId);
      if (!best || result.value > best.score) {
        best = {
          unitId,
          score: result.value,
          overlap: result.overlap
        };
      }
    }

    if (!best || best.score < MIN_SCORE) {
      continue;
    }

    renameMap[fileName] = best.unitId;
    mappedUnitIds.add(best.unitId);
    additions.push({
      source: fileName,
      unitId: best.unitId,
      score: best.score,
      overlap: best.overlap
    });
  }

  const sortedKeys = Object.keys(renameMap).sort((a, b) => a.localeCompare(b));
  const sortedMap = {};
  for (const key of sortedKeys) {
    sortedMap[key] = renameMap[key];
  }

  fs.writeFileSync(MAP_PATH, `${JSON.stringify(sortedMap, null, 2)}\n`);

  console.log(`Unit IDs in snapshot: ${unitIds.length}`);
  console.log(`New mappings added: ${additions.length}`);
  for (const item of additions) {
    console.log(`${item.source} -> ${item.unitId} [${item.score}] (${item.overlap.join(',')})`);
  }
}

main();
