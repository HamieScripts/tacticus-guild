const PLAYER_PAGE_STATE = {
  wars: [],
  playerNameMap: new Map(),
  selectedPlayerId: ''
};

function getCoreBattleScore(scoreValue, zoneType) {
  if (typeof globalThis.getCoreScore === 'function') {
    const split = globalThis.getCoreScore(scoreValue, zoneType);
    return Number(split?.core || 0);
  }

  const numericValue = Number(scoreValue) || 0;
  if (numericValue <= 1600) return numericValue;

  const knownBonuses = [40000, 30000, 16000, 10000];
  for (const bonus of knownBonuses) {
    const core = numericValue - bonus;
    if (core >= 0 && core <= 1600) return core;
  }

  return Math.min(numericValue, 1600);
}

function pickPrimaryEventResponseData(data) {
  const eventResults = Array.isArray(data?.eventResults) ? data.eventResults : [];
  if (eventResults.length === 0) return null;

  let selected = null;
  let selectedScore = -1;

  eventResults.forEach((eventResult) => {
    const eventResponseData = eventResult?.eventResponseData;
    if (!eventResponseData || typeof eventResponseData !== 'object') return;

    const activityLogsLength = Array.isArray(eventResponseData.activityLogs) ? eventResponseData.activityLogs.length : 0;
    const playerDataLength = Array.isArray(eventResponseData.playerData) ? eventResponseData.playerData.length : 0;
    const guildDataLength = Array.isArray(eventResponseData.guildData) ? eventResponseData.guildData.length : 0;
    const score = activityLogsLength * 1000000 + playerDataLength * 1000 + guildDataLength;

    if (score > selectedScore) {
      selected = eventResponseData;
      selectedScore = score;
    }
  });

  return selected || eventResults[0]?.eventResponseData || null;
}

function getLatestActivityTimestamp(eventResponseData) {
  const logs = Array.isArray(eventResponseData?.activityLogs) ? eventResponseData.activityLogs : [];
  let maxTimestamp = 0;

  logs.forEach((log) => {
    const createdOn = Number(log?.createdOn || 0);
    if (Number.isFinite(createdOn) && createdOn > maxTimestamp) {
      maxTimestamp = createdOn;
    }
  });

  return maxTimestamp > 0 ? maxTimestamp : null;
}

async function loadDatasetManifest() {
  try {
    const response = await fetch('./data/dataset-manifest.json', { cache: 'no-store' });
    if (!response.ok) {
      return [
        {
          key: 'current',
          label: 'Active war',
          url: './data/current/live-war.json'
        }
      ];
    }

    const manifest = await response.json();
    const manifestDatasets = Array.isArray(manifest)
      ? manifest
      : (Array.isArray(manifest?.datasets) ? manifest.datasets : []);

    if (manifestDatasets.length === 0) {
      return [
        {
          key: 'current',
          label: 'Active war',
          url: './data/current/live-war.json'
        }
      ];
    }

    return manifestDatasets
      .map((entry) => ({
        key: String(entry?.key || '').trim(),
        label: String(entry?.label || 'Unknown war').trim(),
        url: String(entry?.url || '').trim()
      }))
      .filter((entry) => entry.key && entry.url);
  } catch (error) {
    return [
      {
        key: 'current',
        label: 'Active war',
        url: './data/current/live-war.json'
      }
    ];
  }
}

function getGuildTeamIndexes(eventResponseData) {
  const guildData = Array.isArray(eventResponseData?.guildData) ? eventResponseData.guildData : [];
  const praetoriansGuild = guildData.find((guild) => String(guild?.name || '').toLowerCase().includes('praetorians of terra'));
  const fallbackGuild = guildData.find((guild) => Number.isFinite(Number(guild?.teamIndex)));

  const ourTeamIndex = Number(praetoriansGuild?.teamIndex ?? fallbackGuild?.teamIndex);
  const opponentTeamIndex = Number(
    guildData.find((guild) => Number(guild?.teamIndex) !== ourTeamIndex)?.teamIndex
  );

  return {
    ourTeamIndex: Number.isFinite(ourTeamIndex) ? ourTeamIndex : null,
    opponentTeamIndex: Number.isFinite(opponentTeamIndex) ? opponentTeamIndex : null
  };
}

function buildWarPlayerStats(dataset, eventResponseData) {
  const { ourTeamIndex, opponentTeamIndex } = getGuildTeamIndexes(eventResponseData);
  const logs = Array.isArray(eventResponseData?.activityLogs) ? eventResponseData.activityLogs : [];
  const playerData = Array.isArray(eventResponseData?.playerData) ? eventResponseData.playerData : [];

  const nameMap = new Map();
  playerData.forEach((player) => {
    const userId = String(player?.userId || '').trim();
    const displayName = String(player?.displayName || '').trim();
    if (!userId) return;
    nameMap.set(userId, displayName || userId);
  });

  const perPlayer = new Map();

  const ensurePlayerBucket = (userId) => {
    if (!perPlayer.has(userId)) {
      perPlayer.set(userId, { attackScores: [], defenseScores: [] });
    }
    return perPlayer.get(userId);
  };

  logs.forEach((log) => {
    if (String(log?.type || '') !== 'battleFinished') return;

    const score = getCoreBattleScore(log?.score, log?.zone?.type || null);
    if (!Number.isFinite(score)) return;

    const attackerTeamIndex = Number(log?.teamIndex);
    const attackerUserId = String(log?.attacker?.userId || log?.userId || '').trim();
    const defenderUserId = String(log?.defender?.userId || '').trim();

    if (ourTeamIndex !== null && attackerTeamIndex === ourTeamIndex && attackerUserId) {
      const bucket = ensurePlayerBucket(attackerUserId);
      bucket.attackScores.push(score);
    }

    const isDefenseAgainstOurGuild = ourTeamIndex !== null && (
      (opponentTeamIndex !== null && attackerTeamIndex === opponentTeamIndex) ||
      (opponentTeamIndex === null && attackerTeamIndex !== ourTeamIndex)
    );

    if (isDefenseAgainstOurGuild && defenderUserId) {
      const bucket = ensurePlayerBucket(defenderUserId);
      bucket.defenseScores.push(score);
    }
  });

  return {
    key: dataset.key,
    label: dataset.label,
    timestamp: getLatestActivityTimestamp(eventResponseData),
    perPlayer,
    nameMap
  };
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + Number(value || 0), 0);
  return total / values.length;
}

function setSummaryText(text) {
  const summary = document.getElementById('player-chart-summary');
  if (!summary) return;
  summary.textContent = text;
}

function renderPlayerSelect() {
  const select = document.getElementById('player-select');
  if (!select) return;

  const playerIds = new Set();
  PLAYER_PAGE_STATE.wars.forEach((war) => {
    war.perPlayer.forEach((_, playerId) => {
      playerIds.add(playerId);
    });
    war.nameMap.forEach((name, playerId) => {
      if (!PLAYER_PAGE_STATE.playerNameMap.has(playerId)) {
        PLAYER_PAGE_STATE.playerNameMap.set(playerId, name);
      }
    });
  });

  const players = Array.from(playerIds)
    .map((id) => ({ id, name: PLAYER_PAGE_STATE.playerNameMap.get(id) || id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  select.innerHTML = '';

  if (players.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No players found';
    select.appendChild(option);
    PLAYER_PAGE_STATE.selectedPlayerId = '';
    return;
  }

  players.forEach((player) => {
    const option = document.createElement('option');
    option.value = player.id;
    option.textContent = player.name;
    select.appendChild(option);
  });

  if (!PLAYER_PAGE_STATE.selectedPlayerId || !players.some((player) => player.id === PLAYER_PAGE_STATE.selectedPlayerId)) {
    PLAYER_PAGE_STATE.selectedPlayerId = players[0].id;
  }

  select.value = PLAYER_PAGE_STATE.selectedPlayerId;
}

function renderChart() {
  const svg = document.getElementById('player-chart');
  if (!svg) return;

  const selectedPlayerId = PLAYER_PAGE_STATE.selectedPlayerId;
  if (!selectedPlayerId) {
    svg.innerHTML = '';
    setSummaryText('No player data available.');
    return;
  }

  const wars = PLAYER_PAGE_STATE.wars;
  const chartRows = wars.map((war, index) => {
    const stats = war.perPlayer.get(selectedPlayerId) || { attackScores: [], defenseScores: [] };
    return {
      war,
      index,
      attackScores: stats.attackScores,
      defenseScores: stats.defenseScores,
      attackAvg: average(stats.attackScores),
      defenseAvg: average(stats.defenseScores)
    };
  });

  const avgValues = [];
  chartRows.forEach((row) => {
    if (row.attackAvg !== null) avgValues.push(row.attackAvg);
    if (row.defenseAvg !== null) avgValues.push(row.defenseAvg);
  });

  const yMax = Math.max(1600, ...avgValues, 1);
  const width = 1200;
  const height = 420;
  const padding = { top: 24, right: 24, bottom: 70, left: 56 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const xForIndex = (index) => {
    if (chartRows.length <= 1) return padding.left + plotWidth / 2;
    return padding.left + (index / (chartRows.length - 1)) * plotWidth;
  };

  const yForScore = (score) => {
    const clamped = Math.max(0, Math.min(yMax, Number(score || 0)));
    return padding.top + (1 - clamped / yMax) * plotHeight;
  };

  const makePath = (rows, key) => {
    const points = rows
      .filter((row) => row[key] !== null)
      .map((row) => `${xForIndex(row.index)},${yForScore(row[key])}`);
    if (points.length === 0) return '';
    return `M ${points.join(' L ')}`;
  };

  const attackPath = makePath(chartRows, 'attackAvg');
  const defensePath = makePath(chartRows, 'defenseAvg');

  const yTicks = [0, 400, 800, 1200, 1600].filter((tick) => tick <= yMax);
  if (!yTicks.includes(yMax)) yTicks.push(yMax);

  const grid = yTicks.map((tick) => {
    const y = yForScore(tick);
    return `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(100,116,139,0.35)" stroke-width="1" />
      <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="rgba(148,163,184,0.9)">${Math.round(tick)}</text>
    `;
  }).join('');

  const xLabels = chartRows.map((row) => {
    const x = xForIndex(row.index);
    const shortLabel = String(row.war.label || row.war.key || `War ${row.index + 1}`);
    return `<text x="${x}" y="${height - 18}" text-anchor="middle" font-size="11" fill="rgba(148,163,184,0.95)">${shortLabel.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
  }).join('');

  const attackMarkers = chartRows
    .filter((row) => row.attackAvg !== null)
    .map((row) => `<circle cx="${xForIndex(row.index)}" cy="${yForScore(row.attackAvg)}" r="3.5" fill="rgba(6,182,212,1)" />`)
    .join('');

  const defenseMarkers = chartRows
    .filter((row) => row.defenseAvg !== null)
    .map((row) => `<circle cx="${xForIndex(row.index)}" cy="${yForScore(row.defenseAvg)}" r="3.5" fill="rgba(245,158,11,1)" />`)
    .join('');

  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(2,6,23,0.25)"></rect>
    ${grid}
    <line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" stroke="rgba(148,163,184,0.7)" stroke-width="1.2" />
    <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}" stroke="rgba(148,163,184,0.7)" stroke-width="1.2" />

    ${attackPath ? `<path d="${attackPath}" fill="none" stroke="rgba(34,211,238,0.95)" stroke-width="2.2" />` : ''}
    ${defensePath ? `<path d="${defensePath}" fill="none" stroke="rgba(251,191,36,0.95)" stroke-width="2.2" />` : ''}

    ${attackMarkers}
    ${defenseMarkers}

    ${xLabels}

    <g transform="translate(${padding.left}, 10)">
      <circle cx="0" cy="0" r="4" fill="rgba(34,211,238,0.95)"></circle>
      <text x="10" y="4" fill="rgba(224,242,254,1)" font-size="12">Average attack per war</text>
      <circle cx="190" cy="0" r="4" fill="rgba(251,191,36,0.95)"></circle>
      <text x="200" y="4" fill="rgba(254,243,199,1)" font-size="12">Average defense per war</text>
    </g>
  `;

  const playerName = PLAYER_PAGE_STATE.playerNameMap.get(selectedPlayerId) || selectedPlayerId;
  const totalAttacks = chartRows.reduce((sum, row) => sum + row.attackScores.length, 0);
  const totalDefenses = chartRows.reduce((sum, row) => sum + row.defenseScores.length, 0);
  setSummaryText(`${playerName}: ${totalAttacks} attacks and ${totalDefenses} defenses across ${chartRows.length} wars.`);
}

async function initializePlayerPage() {
  setSummaryText('Loading player history...');

  const datasets = await loadDatasetManifest();
  const results = await Promise.all(datasets.map(async (dataset) => {
    try {
      const response = await fetch(dataset.url, { cache: 'no-store' });
      if (!response.ok) return null;
      const data = await response.json();
      const eventResponseData = pickPrimaryEventResponseData(data);
      if (!eventResponseData) return null;
      return buildWarPlayerStats(dataset, eventResponseData);
    } catch (error) {
      return null;
    }
  }));

  PLAYER_PAGE_STATE.wars = results
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = Number(a.timestamp || 0);
      const bTime = Number(b.timestamp || 0);
      return aTime - bTime;
    });

  renderPlayerSelect();

  const select = document.getElementById('player-select');
  if (select) {
    select.addEventListener('change', (event) => {
      PLAYER_PAGE_STATE.selectedPlayerId = String(event.target.value || '');
      renderChart();
    });
  }

  renderChart();
}

initializePlayerPage();
