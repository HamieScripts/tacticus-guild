const PLAYER_PAGE_STATE = {
  wars: [],
  raidSeasons: [],
  playerNameMap: new Map(),
  selectedPlayerId: '',
  activeView: 'raid',
  raidStartSeason: null,
  raidEndSeason: null,
  raidTrendFilter: ''
};

const ALL_PLAYERS_OPTION_ID = '__all_players__';
const PLAYER_DIRECTORY_URL = './data/static/players.json';
const RAID_MANIFEST_URL = './data/raid/manifest.json';

function getKnownPlayerName(playerId) {
  const id = String(playerId || '').trim();
  const name = String(PLAYER_PAGE_STATE.playerNameMap.get(id) || '').trim();
  return name && name !== id ? name : '';
}

function hasCurrentRaidDamage(playerId) {
  const currentSeason = PLAYER_PAGE_STATE.raidSeasons.at(-1);
  return Number(currentSeason?.totals.get(String(playerId || '')) || 0) > 0;
}

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

async function getDatasetManifestUrl() {
  let hashValue = '';

  try {
    const hashResponse = await fetch('./data/dataset-manifest.hash', { cache: 'no-store' });
    if (hashResponse.ok) {
      hashValue = (await hashResponse.text()).trim();
    }
  } catch (error) {
    hashValue = '';
  }

  const url = new URL('./data/dataset-manifest.json', window.location.href);
  if (hashValue) {
    url.searchParams.set('v', hashValue);
  }

  return url.toString();
}

async function loadDatasetManifest() {
  try {
    const manifestUrl = await getDatasetManifestUrl();
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (!response.ok) {
      return [
        {
          key: 'current',
          label: 'Active war',
          url: './data/war/current.json'
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
          url: './data/war/current.json'
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
        url: './data/war/current.json'
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

function getChartYDomain(values) {
  const numericValues = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (numericValues.length === 0) {
    return { yMin: 0, yMax: 1600 };
  }

  const minValue = Math.min(...numericValues);
  const maxValue = Math.max(...numericValues);
  const defaultFloor = 600;

  const yMin = minValue >= defaultFloor
    ? defaultFloor
    : Math.max(0, Math.floor(Math.max(minValue - 100, 0) / 100) * 100);

  const paddedMax = Math.max(maxValue + 80, yMin + 200);
  const yMax = Math.min(1600, Math.ceil(paddedMax / 100) * 100);

  if (yMax <= yMin) {
    return { yMin, yMax: Math.min(1600, yMin + 200) };
  }

  return { yMin, yMax };
}

function getChartTicks(yMin, yMax) {
  const min = Number.isFinite(yMin) ? yMin : 0;
  const max = Number.isFinite(yMax) ? yMax : 1600;
  const range = Math.max(max - min, 1);
  const stepCandidates = [50, 100, 200, 250, 400];
  const idealStep = range / 6;
  const step = stepCandidates.find((candidate) => candidate >= idealStep) || 400;

  const ticks = [min];
  let tick = Math.ceil(min / step) * step;
  while (tick < max) {
    if (tick > min) ticks.push(tick);
    tick += step;
  }
  if (ticks[ticks.length - 1] !== max) ticks.push(max);

  return ticks;
}

function formatDamage(value) {
  const numericValue = Number(value) || 0;
  if (numericValue >= 1000000) return `${(numericValue / 1000000).toFixed(1)}M`;
  if (numericValue >= 1000) return `${Math.round(numericValue / 1000)}K`;
  return String(Math.round(numericValue));
}

function getXAxisLabelIndexes(pointCount, maximumLabels = 10) {
  if (pointCount <= maximumLabels) return new Set(Array.from({ length: pointCount }, (_, index) => index));

  const indexes = new Set([0, pointCount - 1]);
  for (let labelIndex = 1; labelIndex < maximumLabels - 1; labelIndex += 1) {
    indexes.add(Math.round((labelIndex / (maximumLabels - 1)) * (pointCount - 1)));
  }
  return indexes;
}

function getChartPlayerColor(playerId) {
  const id = String(playerId || 'player');
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = ((hash << 5) - hash) + id.charCodeAt(index);
    hash |= 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 75%, 62%)`;
}

function renderPlayerChartLegend(players) {
  const legend = document.getElementById('player-chart-legend');
  if (!legend) return;

  const entries = Array.isArray(players) ? players : [];
  legend.hidden = entries.length === 0;
  legend.innerHTML = entries.map((player) => `
    <span class="inline-flex items-center gap-1.5 text-xs text-slate-300">
      <span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background: ${player.color || getChartPlayerColor(player.id)}"></span>
      <span>${String(player.name || player.id || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
    </span>`).join('');
}

function getRaidTrend(values) {
  const nonZeroValues = values.filter((value) => Number(value) > 0).map(Number);
  if (nonZeroValues.length < 2) return 'stable';

  const first = nonZeroValues[0];
  const last = nonZeroValues[nonZeroValues.length - 1];
  const change = (last - first) / Math.max(Math.abs(first), 1);
  if (change > 0.1) return 'up';
  if (change < -0.1) return 'down';
  return 'stable';
}

function renderRaidTrendFilters() {
  const container = document.getElementById('raid-trend-filters');
  if (!container) return;

  container.hidden = PLAYER_PAGE_STATE.activeView !== 'raid'
    || PLAYER_PAGE_STATE.selectedPlayerId !== ALL_PLAYERS_OPTION_ID;
  const filters = [
    { value: 'up', label: 'Trending upwards', classes: 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200' },
    { value: 'down', label: 'Trending downwards', classes: 'border-rose-400/60 bg-rose-500/15 text-rose-200' },
    { value: 'stable', label: 'Stable', classes: 'border-amber-400/60 bg-amber-500/15 text-amber-200' }
  ];

  container.innerHTML = filters.map((filter) => {
    const active = PLAYER_PAGE_STATE.raidTrendFilter === filter.value;
    return `<button type="button" data-raid-trend="${filter.value}" aria-pressed="${active}" class="rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active ? filter.classes : 'border-slate-500/50 bg-slate-900/80 text-slate-300 hover:border-slate-300/70'}">${filter.label}</button>`;
  }).join('');
}

function bindRaidTrendFilters() {
  const container = document.getElementById('raid-trend-filters');
  if (!container) return;

  container.addEventListener('click', (event) => {
    const button = event.target.closest('[data-raid-trend]');
    if (!button) return;
    const filter = button.getAttribute('data-raid-trend') || '';
    PLAYER_PAGE_STATE.raidTrendFilter = PLAYER_PAGE_STATE.raidTrendFilter === filter ? '' : filter;
    renderRaidTrendFilters();
    renderChart();
  });
}

async function loadRaidPlayerStats() {
  try {
    const response = await fetch(RAID_MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) return [];
    const manifest = await response.json();
    const seasons = Array.isArray(manifest?.seasons) ? manifest.seasons : [];

    const results = await Promise.all(seasons.map(async (season) => {
      try {
        const seasonResponse = await fetch(String(season?.url || ''), { cache: 'no-store' });
        if (!seasonResponse.ok) return null;
        const data = await seasonResponse.json();
        const totals = new Map();

        (Array.isArray(data?.entries) ? data.entries : []).forEach((entry) => {
          const userId = String(entry?.userId || '').trim();
          const damage = Number(entry?.damageDealt || 0);
          if (!userId || !Number.isFinite(damage)) return;
          totals.set(userId, (totals.get(userId) || 0) + damage);
        });

        return {
          season: Number(data?.season ?? season?.season),
          start: Number(data?.fetchedOn || season?.end || season?.start || 0),
          totals
        };
      } catch (error) {
        return null;
      }
    }));

    return results
      .filter((season) => season && Number.isFinite(season.season))
      .sort((a, b) => a.season - b.season);
  } catch (error) {
    return [];
  }
}

function getDefaultRaidSeasonRange() {
  const seasons = PLAYER_PAGE_STATE.raidSeasons;
  if (seasons.length === 0) return { start: null, end: null };

  return {
    start: seasons[Math.max(0, seasons.length - 10)].season,
    end: seasons[seasons.length - 1].season
  };
}

function ensureRaidSeasonRange() {
  const defaults = getDefaultRaidSeasonRange();
  if (defaults.start === null) {
    PLAYER_PAGE_STATE.raidStartSeason = null;
    PLAYER_PAGE_STATE.raidEndSeason = null;
    return;
  }

  const seasons = PLAYER_PAGE_STATE.raidSeasons;
  const minimum = seasons[0].season;
  const maximum = seasons[seasons.length - 1].season;
  const start = Number.isFinite(PLAYER_PAGE_STATE.raidStartSeason)
    ? PLAYER_PAGE_STATE.raidStartSeason
    : defaults.start;
  const end = Number.isFinite(PLAYER_PAGE_STATE.raidEndSeason)
    ? PLAYER_PAGE_STATE.raidEndSeason
    : defaults.end;

  PLAYER_PAGE_STATE.raidStartSeason = Math.max(minimum, Math.min(maximum, Math.min(start, end)));
  PLAYER_PAGE_STATE.raidEndSeason = Math.max(
    PLAYER_PAGE_STATE.raidStartSeason,
    Math.min(maximum, Math.max(start, end))
  );
}

function getVisibleRaidSeasons() {
  ensureRaidSeasonRange();
  return PLAYER_PAGE_STATE.raidSeasons.filter((season) => (
    season.season >= PLAYER_PAGE_STATE.raidStartSeason
    && season.season <= PLAYER_PAGE_STATE.raidEndSeason
  ));
}

function renderRaidSeasonRangeControls() {
  const container = document.getElementById('raid-season-range-controls');
  if (!container) return;

  const hasSeasons = PLAYER_PAGE_STATE.raidSeasons.length > 0;
  container.hidden = PLAYER_PAGE_STATE.activeView !== 'raid';
  ensureRaidSeasonRange();

  const startInput = document.getElementById('raid-start-season');
  const endInput = document.getElementById('raid-end-season');
  if (!startInput || !endInput) return;

  const minimum = hasSeasons ? PLAYER_PAGE_STATE.raidSeasons[0].season : '';
  const maximum = hasSeasons ? PLAYER_PAGE_STATE.raidSeasons.at(-1).season : '';
  [startInput, endInput].forEach((input) => {
    input.min = minimum;
    input.max = maximum;
    input.disabled = !hasSeasons;
  });
  startInput.value = PLAYER_PAGE_STATE.raidStartSeason ?? '';
  endInput.value = PLAYER_PAGE_STATE.raidEndSeason ?? '';
}

function bindRaidSeasonRangeControls() {
  const startInput = document.getElementById('raid-start-season');
  const endInput = document.getElementById('raid-end-season');
  if (!startInput || !endInput) return;

  const updateRange = () => {
    PLAYER_PAGE_STATE.raidStartSeason = Number(startInput.value);
    PLAYER_PAGE_STATE.raidEndSeason = Number(endInput.value);
    renderRaidSeasonRangeControls();
    renderChart();
  };

  startInput.addEventListener('change', updateRange);
  endInput.addEventListener('change', updateRange);
}

function renderPlayerSelect() {
  const select = document.getElementById('player-select');
  if (!select) return;

  const playerIds = new Set();
  const sourceData = PLAYER_PAGE_STATE.activeView === 'raid'
    ? PLAYER_PAGE_STATE.raidSeasons
    : PLAYER_PAGE_STATE.wars;

  sourceData.forEach((data) => {
    const perPlayer = PLAYER_PAGE_STATE.activeView === 'raid' ? data.totals : data.perPlayer;
    perPlayer.forEach((_, playerId) => {
      playerIds.add(playerId);
    });
  });

  const knownPlayerIds = PLAYER_PAGE_STATE.activeView === 'raid'
    ? [...playerIds].filter((id) => hasCurrentRaidDamage(id))
    : [...playerIds];

  const players = knownPlayerIds
    .filter((id) => getKnownPlayerName(id))
    .map((id) => ({ id, name: getKnownPlayerName(id) }))
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

  const allPlayersOption = document.createElement('option');
  allPlayersOption.value = ALL_PLAYERS_OPTION_ID;
  allPlayersOption.textContent = 'All players';
  select.appendChild(allPlayersOption);

  players.forEach((player) => {
    const option = document.createElement('option');
    option.value = player.id;
    option.textContent = player.name;
    select.appendChild(option);
  });

  const isValidSelection = PLAYER_PAGE_STATE.selectedPlayerId === ALL_PLAYERS_OPTION_ID
    || players.some((player) => player.id === PLAYER_PAGE_STATE.selectedPlayerId);

  if (!PLAYER_PAGE_STATE.selectedPlayerId || !isValidSelection) {
    PLAYER_PAGE_STATE.selectedPlayerId = ALL_PLAYERS_OPTION_ID;
  }

  select.value = PLAYER_PAGE_STATE.selectedPlayerId;
}

function renderRaidChart() {
  const svg = document.getElementById('player-chart');
  if (!svg) return;

  const seasons = getVisibleRaidSeasons();
  const selectedPlayerId = PLAYER_PAGE_STATE.selectedPlayerId;
  if (!selectedPlayerId || seasons.length === 0) {
    svg.innerHTML = '';
    renderPlayerChartLegend([]);
    setSummaryText('No guild raid history is available.');
    return;
  }

  const playerIds = selectedPlayerId === ALL_PLAYERS_OPTION_ID
    ? Array.from(new Set(seasons.flatMap((season) => Array.from(season.totals.keys()))))
    : [selectedPlayerId];
  const players = playerIds.filter((id) => hasCurrentRaidDamage(id)).map((id) => ({
    id,
    name: getKnownPlayerName(id),
    values: seasons.map((season) => Number(season.totals.get(id) || 0)),
    color: getChartPlayerColor(id)
  })).filter((player) => getKnownPlayerName(player.id) && (
    selectedPlayerId !== ALL_PLAYERS_OPTION_ID
    || !PLAYER_PAGE_STATE.raidTrendFilter
    || getRaidTrend(player.values) === PLAYER_PAGE_STATE.raidTrendFilter
  ));
  if (players.length === 0) {
    svg.innerHTML = '';
    renderPlayerChartLegend([]);
    setSummaryText('No players match the selected trend filter.');
    return;
  }
  renderPlayerChartLegend(players);
  const maximumDamage = Math.max(0, ...players.flatMap((player) => player.values));
  const yMax = Math.max(1000000, Math.ceil(maximumDamage / 1000000) * 1000000);
  const width = 1200;
  const height = 620;
  const padding = { top: 34, right: 24, bottom: 70, left: 68 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xForIndex = (index) => seasons.length <= 1
    ? padding.left + plotWidth / 2
    : padding.left + (index / (seasons.length - 1)) * plotWidth;
  const yForDamage = (damage) => padding.top + (1 - (Number(damage || 0) / yMax)) * plotHeight;
  const escapeText = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const ticks = Array.from({ length: 6 }, (_, index) => (yMax / 5) * index);
  const grid = ticks.map((tick) => {
    const y = yForDamage(tick);
    return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(100,116,139,0.35)" stroke-width="1" />
      <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="rgba(148,163,184,0.9)">${formatDamage(tick)}</text>`;
  }).join('');
  const xLabelIndexes = getXAxisLabelIndexes(seasons.length);
  const xLabels = seasons
    .map((season, index) => xLabelIndexes.has(index)
      ? `<text x="${xForIndex(index)}" y="${height - 18}" text-anchor="middle" font-size="11" fill="rgba(148,163,184,0.95)">Season ${season.season}</text>`
      : '')
    .join('');
  const seriesPaths = players.map((player) => {
    const color = player.color;
    const points = player.values
      .map((damage, index) => ({ damage, index }))
      .filter((point) => point.damage > 0)
      .map((point) => ({
        ...point,
        season: seasons[point.index].season,
        x: xForIndex(point.index),
        y: yForDamage(point.damage)
      }));
    const path = points.map((point) => `${point.x},${point.y}`).join(' L ');
    const markers = points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="2.8" fill="${color}"><title>Season ${point.season}: ${formatDamage(point.damage)} damage</title></circle>`).join('');
    const finalPoint = points[points.length - 1];
    if (!finalPoint) return '';
    const label = selectedPlayerId === ALL_PLAYERS_OPTION_ID ? '' : `<text x="${Math.min(finalPoint.x + 8, width - padding.right - 90)}" y="${Math.max(finalPoint.y - 6, padding.top + 12)}" font-size="11" fill="${color}">${escapeText(player.name)}</text>`;
    return `<path d="M ${path}" fill="none" stroke="${color}" stroke-width="${selectedPlayerId === ALL_PLAYERS_OPTION_ID ? 1.7 : 2.5}" stroke-linecap="round" stroke-linejoin="round" />${markers}${label}`;
  }).join('');
  const selectedPlayer = selectedPlayerId === ALL_PLAYERS_OPTION_ID ? null : players[0];
  let runningDamageTotal = 0;
  let seasonsWithDamage = 0;
  const runningAverages = selectedPlayer
    ? selectedPlayer.values.map((damage) => {
      if (damage > 0) {
        runningDamageTotal += damage;
        seasonsWithDamage += 1;
        return runningDamageTotal / seasonsWithDamage;
      }
      return null;
    })
    : [];
  const runningAveragePath = runningAverages
    .map((damage, index) => ({ damage, index }))
    .filter((point) => point.damage !== null)
    .map((point) => `${xForIndex(point.index)},${yForDamage(point.damage)}`)
    .join(' L ');
  const finalRunningAverage = runningAverages.findLast((damage) => damage !== null);
  const runningAverageAnnotation = selectedPlayer && Number.isFinite(finalRunningAverage)
    ? `<text x="${width - padding.right}" y="16" text-anchor="end" fill="rgba(251,191,36,1)" font-size="12">Running average: ${formatDamage(finalRunningAverage)}</text>`
    : '';

  svg.innerHTML = `<rect x="0" y="0" width="${width}" height="${height}" fill="rgba(2,6,23,0.25)"></rect>
    ${grid}
    <line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" stroke="rgba(148,163,184,0.7)" stroke-width="1.2" />
    <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}" stroke="rgba(148,163,184,0.7)" stroke-width="1.2" />
    ${seriesPaths}
    ${runningAveragePath ? `<path d="M ${runningAveragePath}" fill="none" stroke="rgba(251,191,36,0.95)" stroke-width="2.2" stroke-dasharray="7 5" stroke-linecap="round" stroke-linejoin="round" />` : ''}
    ${xLabels}
    <text x="${padding.left}" y="16" fill="rgba(186,230,253,0.95)" font-size="12">Total damage per guild raid season</text>
    ${runningAverageAnnotation}`;

  if (selectedPlayerId === ALL_PLAYERS_OPTION_ID) {
    setSummaryText(`${players.length} players across ${seasons.length} guild raid seasons. Select a player to focus their damage history.`);
    return;
  }

  const player = players[0];
  const totalDamage = player.values.reduce((sum, damage) => sum + damage, 0);
  setSummaryText(`${player.name}: ${formatDamage(totalDamage)} total damage across ${seasons.length} guild raid seasons.`);
}

function renderChart() {
  if (PLAYER_PAGE_STATE.activeView === 'raid') {
    renderRaidChart();
    return;
  }

  const svg = document.getElementById('player-chart');
  if (!svg) return;

  const selectedPlayerId = PLAYER_PAGE_STATE.selectedPlayerId;
  if (!selectedPlayerId) {
    svg.innerHTML = '';
    renderPlayerChartLegend([]);
    setSummaryText('No player data available.');
    return;
  }

  const wars = PLAYER_PAGE_STATE.wars;
  const isAllPlayersSelected = selectedPlayerId === ALL_PLAYERS_OPTION_ID;
  const width = 1200;
  const height = 620;
  const padding = { top: 28, right: 24, bottom: 84, left: 56 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const xForIndex = (index) => {
    if (wars.length <= 1) return padding.left + plotWidth / 2;
    return padding.left + (index / (wars.length - 1)) * plotWidth;
  };

  const escapeText = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  if (isAllPlayersSelected) {
    const playerIdSet = new Set();
    wars.forEach((war) => {
      war.perPlayer.forEach((_, playerId) => {
        playerIdSet.add(playerId);
      });
    });

    const players = Array.from(playerIdSet)
      .filter((id) => getKnownPlayerName(id))
      .map((id) => ({ id, name: getKnownPlayerName(id) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const playerSeries = players.map((player) => {
      const rows = wars.map((war, index) => {
        const stats = war.perPlayer.get(player.id) || { attackScores: [], defenseScores: [] };
        const attackScores = Array.isArray(stats.attackScores) ? stats.attackScores : [];
        const defenseScores = Array.isArray(stats.defenseScores) ? stats.defenseScores : [];
        const combinedScores = attackScores.concat(defenseScores);

        return {
          war,
          index,
          avg: average(combinedScores),
          attackCount: attackScores.length,
          defenseCount: defenseScores.length
        };
      });

      return {
        ...player,
        rows,
        totalAttacks: rows.reduce((sum, row) => sum + row.attackCount, 0),
        totalDefenses: rows.reduce((sum, row) => sum + row.defenseCount, 0)
      };
    }).filter((series) => series.rows.some((row) => row.avg !== null));
    renderPlayerChartLegend(playerSeries);

    const avgValues = [];
    playerSeries.forEach((series) => {
      series.rows.forEach((row) => {
        if (row.avg !== null) avgValues.push(row.avg);
      });
    });

    const { yMin, yMax } = getChartYDomain(avgValues);

    const yForScore = (score) => {
      const clamped = Math.max(yMin, Math.min(yMax, Number(score || 0)));
      const normalized = (clamped - yMin) / Math.max(yMax - yMin, 1);
      return padding.top + (1 - normalized) * plotHeight;
    };

    const yTicks = getChartTicks(yMin, yMax);

    const grid = yTicks.map((tick) => {
      const y = yForScore(tick);
      return `
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(100,116,139,0.35)" stroke-width="1" />
        <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="rgba(148,163,184,0.9)">${Math.round(tick)}</text>
      `;
    }).join('');

    const xLabelIndexes = getXAxisLabelIndexes(wars.length);
    const xLabels = wars.map((war, index) => {
      if (!xLabelIndexes.has(index)) return '';
      const x = xForIndex(index);
      const shortLabel = String(war.label || war.key || `War ${index + 1}`);
      return `<text x="${x}" y="${height - 18}" text-anchor="middle" font-size="11" fill="rgba(148,163,184,0.95)">${escapeText(shortLabel)}</text>`;
    }).join('');

    const seriesPaths = playerSeries.map((series) => {
      const points = series.rows
        .filter((row) => row.avg !== null)
        .map((row) => ({ index: row.index, x: xForIndex(row.index), y: yForScore(row.avg) }));

      if (points.length === 0) return '';

      const color = getChartPlayerColor(series.id);
      const pathData = points.map((point) => `${point.x},${point.y}`).join(' L ');
      const markers = points
        .map((point) => `<circle cx="${point.x}" cy="${point.y}" r="2.7" fill="${color}"><title>${escapeText(series.rows[point.index].war.label || series.rows[point.index].war.key || `War ${point.index + 1}`)}: ${Math.round(series.rows[point.index].avg)}</title></circle>`)
        .join('');
      const lastPoint = points[points.length - 1];
      const labelX = Math.min(lastPoint.x + 6, width - padding.right - 40);
      const labelY = Math.max(lastPoint.y - 5, padding.top + 10);

      return `
        <path d="M ${pathData}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        ${markers}
        <text x="${labelX}" y="${labelY}" font-size="10" fill="${color}">${escapeText(series.name)}</text>
      `;
    }).join('');

    svg.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(2,6,23,0.25)"></rect>
      ${grid}
      <line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" stroke="rgba(148,163,184,0.7)" stroke-width="1.2" />
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}" stroke="rgba(148,163,184,0.7)" stroke-width="1.2" />

      ${seriesPaths}
      ${xLabels}

      <text x="${padding.left}" y="14" fill="rgba(186,230,253,0.95)" font-size="12">Each line = one player (attack + defense average per war)</text>
    `;

    const totalAttacks = playerSeries.reduce((sum, series) => sum + series.totalAttacks, 0);
    const totalDefenses = playerSeries.reduce((sum, series) => sum + series.totalDefenses, 0);
    setSummaryText(`All players: ${playerSeries.length} lines, ${totalAttacks} attacks and ${totalDefenses} defenses across ${wars.length} wars.`);
    return;
  }

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
  renderPlayerChartLegend([{ id: selectedPlayerId, name: getKnownPlayerName(selectedPlayerId) || selectedPlayerId }]);

  const avgValues = [];
  chartRows.forEach((row) => {
    if (row.attackAvg !== null) avgValues.push(row.attackAvg);
    if (row.defenseAvg !== null) avgValues.push(row.defenseAvg);
  });

  const { yMin, yMax } = getChartYDomain(avgValues);

  const yForScore = (score) => {
    const clamped = Math.max(yMin, Math.min(yMax, Number(score || 0)));
    const normalized = (clamped - yMin) / Math.max(yMax - yMin, 1);
    return padding.top + (1 - normalized) * plotHeight;
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

  const yTicks = getChartTicks(yMin, yMax);

  const grid = yTicks.map((tick) => {
    const y = yForScore(tick);
    return `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(100,116,139,0.35)" stroke-width="1" />
      <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="rgba(148,163,184,0.9)">${Math.round(tick)}</text>
    `;
  }).join('');

  const xLabelIndexes = getXAxisLabelIndexes(chartRows.length);
  const xLabels = chartRows.map((row) => {
    if (!xLabelIndexes.has(row.index)) return '';
    const x = xForIndex(row.index);
    const shortLabel = String(row.war.label || row.war.key || `War ${row.index + 1}`);
    return `<text x="${x}" y="${height - 18}" text-anchor="middle" font-size="11" fill="rgba(148,163,184,0.95)">${escapeText(shortLabel)}</text>`;
  }).join('');

  const attackMarkers = chartRows
    .filter((row) => row.attackAvg !== null)
    .map((row) => `<circle cx="${xForIndex(row.index)}" cy="${yForScore(row.attackAvg)}" r="3.5" fill="rgba(6,182,212,1)"><title>${escapeText(row.war.label || row.war.key || `War ${row.index + 1}`)}: ${Math.round(row.attackAvg)} average attack</title></circle>`)
    .join('');

  const defenseMarkers = chartRows
    .filter((row) => row.defenseAvg !== null)
    .map((row) => `<circle cx="${xForIndex(row.index)}" cy="${yForScore(row.defenseAvg)}" r="3.5" fill="rgba(245,158,11,1)"><title>${escapeText(row.war.label || row.war.key || `War ${row.index + 1}`)}: ${Math.round(row.defenseAvg)} average defense</title></circle>`)
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

  const totalAttacks = chartRows.reduce((sum, row) => sum + row.attackScores.length, 0);
  const totalDefenses = chartRows.reduce((sum, row) => sum + row.defenseScores.length, 0);
  const playerName = PLAYER_PAGE_STATE.playerNameMap.get(selectedPlayerId) || selectedPlayerId;
  setSummaryText(`${playerName}: ${totalAttacks} attacks and ${totalDefenses} defenses across ${chartRows.length} wars.`);
}

async function initializePlayerPage() {
  setSummaryText('Loading player history...');

  const [datasets, raidSeasons, playerDirectory] = await Promise.all([
    loadDatasetManifest(),
    loadRaidPlayerStats(),
    fetch(PLAYER_DIRECTORY_URL, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : [])
      .catch(() => [])
  ]);
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
  PLAYER_PAGE_STATE.raidSeasons = raidSeasons;
  ensureRaidSeasonRange();

  (Array.isArray(playerDirectory) ? playerDirectory : []).forEach((player) => {
    const playerId = String(player?.id || '').trim();
    const playerName = String(player?.name || '').trim();
    if (playerId && playerName) PLAYER_PAGE_STATE.playerNameMap.set(playerId, playerName);
  });
  PLAYER_PAGE_STATE.wars.forEach((war) => {
    war.nameMap.forEach((name, playerId) => {
      if (!PLAYER_PAGE_STATE.playerNameMap.has(playerId)) {
        PLAYER_PAGE_STATE.playerNameMap.set(playerId, name);
      }
    });
  });

  renderPlayerSelect();
  renderRaidSeasonRangeControls();
  renderRaidTrendFilters();

  const select = document.getElementById('player-select');
  if (select) {
    select.addEventListener('change', (event) => {
      PLAYER_PAGE_STATE.selectedPlayerId = String(event.target.value || '');
      renderRaidTrendFilters();
      renderChart();
    });
  }

  const chartPanel = document.getElementById('player-chart-panel');
  const description = document.getElementById('player-page-description');
  document.querySelectorAll('[data-player-view]').forEach((tab) => {
    tab.addEventListener('click', () => {
      PLAYER_PAGE_STATE.activeView = String(tab.dataset.playerView || 'raid');
      document.querySelectorAll('[data-player-view]').forEach((button) => {
        const isActive = button === tab;
        button.setAttribute('aria-selected', String(isActive));
        button.classList.toggle('border-cyan-400', isActive);
        button.classList.toggle('text-cyan-200', isActive);
        button.classList.toggle('border-transparent', !isActive);
        button.classList.toggle('text-slate-400', !isActive);
      });
      if (chartPanel) chartPanel.setAttribute('aria-labelledby', tab.id);
      if (description) {
        description.textContent = PLAYER_PAGE_STATE.activeView === 'raid'
          ? 'Select a guild member to compare their total damage across guild raid seasons.'
          : 'Select a guild member to compare average attack and defense score per war.';
      }
      renderRaidSeasonRangeControls();
      renderRaidTrendFilters();
      renderPlayerSelect();
      renderChart();
    });
  });

  renderChart();
}

initializePlayerPage();
