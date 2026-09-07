const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WAR_DIR = path.join(ROOT, 'data', 'war');
const PLAYERS_PATH = path.join(ROOT, 'data', 'static', 'players.json');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function collectPlayersFromWar(data) {
  const eventResults = Array.isArray(data?.eventResults) ? data.eventResults : [];

  return eventResults.flatMap((eventResult) => {
    const playerData = eventResult?.eventResponseData?.playerData;
    return Array.isArray(playerData) ? playerData : [];
  });
}

function normalizePlayer(player) {
  const id = String(player?.userId || '').trim();
  if (!id) return null;

  return {
    id,
    name: String(player?.displayName || '').trim(),
    avatarUnitId: String(player?.avatarUnitId || '').trim() || null,
    avatarFrameId: String(player?.avatarFrameId || '').trim() || null
  };
}

function loadExistingPlayers() {
  const existing = readJson(PLAYERS_PATH);
  const list = Array.isArray(existing) ? existing : [];

  return new Map(
    list
      .map((player) => normalizePlayer({ ...player, userId: player?.id, displayName: player?.name }))
      .filter(Boolean)
      .map((player) => [player.id, player])
  );
}

function main() {
  const warFiles = fs.existsSync(WAR_DIR)
    ? fs.readdirSync(WAR_DIR)
        .filter((file) => file.toLowerCase().endsWith('.json'))
        .map((file) => path.join(WAR_DIR, file))
    : [];

  const players = loadExistingPlayers();
  const knownCount = players.size;

  warFiles.forEach((filePath) => {
    const data = readJson(filePath);
    if (!data) return;

    collectPlayersFromWar(data).forEach((entry) => {
      const player = normalizePlayer(entry);
      if (!player || players.has(player.id)) return;
      players.set(player.id, player);
    });
  });

  const output = [...players.values()].sort((left, right) => (
    left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  ));

  fs.mkdirSync(path.dirname(PLAYERS_PATH), { recursive: true });
  fs.writeFileSync(PLAYERS_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(`Player directory: ${output.length} players (${output.length - knownCount} added) -> data/static/players.json`);
}

main();
