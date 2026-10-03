const DEFAULT_DATASETS = {
  current: {
    label: 'Active war',
    sourceLabel: 'Current snapshot',
    url: './data/war/current.json'
  }
};

let DATASETS = { ...DEFAULT_DATASETS };
let datasetsLoaded = false;

let activeDatasetKey = 'current';
let seasonGroups = [];
let activeSeasonWarRecords = [];
let selectedWarDatasetKey = '';

function getDefaultDatasetKey() {
  if (Object.prototype.hasOwnProperty.call(DATASETS, 'current')) {
    return 'current';
  }

  return Object.keys(DATASETS)[0] || 'current';
}

function getDatasetKeyFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const dataset = params.get('dataset');
  if (dataset && Object.prototype.hasOwnProperty.call(DATASETS, dataset)) {
    return dataset;
  }
  return getDefaultDatasetKey();
}

function normalizeDatasets(manifestDatasets) {
  if (!Array.isArray(manifestDatasets) || manifestDatasets.length === 0) {
    return null;
  }

  const normalized = {};

  manifestDatasets.forEach((dataset) => {
    const key = typeof dataset?.key === 'string' ? dataset.key.trim() : '';
    const label = typeof dataset?.label === 'string' ? dataset.label.trim() : '';
    const sourceLabel = typeof dataset?.sourceLabel === 'string' ? dataset.sourceLabel.trim() : '';
    const url = typeof dataset?.url === 'string' ? dataset.url.trim() : '';
    const start = typeof dataset?.start === 'string' ? dataset.start.trim() : '';
    const end = typeof dataset?.end === 'string' ? dataset.end.trim() : '';

    if (!key || !label || !sourceLabel || !url) return;

    normalized[key] = { label, sourceLabel, url, start: start || null, end: end || null };
  });

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function shouldDisplayCurrentDataset(data) {
  if (data === null || data === undefined) {
    return false;
  }

  if (typeof data !== 'object') {
    return false;
  }

  if (Array.isArray(data)) {
    return data.length > 0;
  }

  return Object.keys(data).length > 0;
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
  if (datasetsLoaded) return;

  try {
    const manifestUrl = await getDatasetManifestUrl();
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (response.ok) {
      const manifest = await response.json();
      const normalized = normalizeDatasets(manifest?.datasets);
      if (normalized) {
        DATASETS = { ...DEFAULT_DATASETS, ...normalized };
      }
    }
  } catch (error) {
    DATASETS = { ...DEFAULT_DATASETS };
  }

  if (Object.prototype.hasOwnProperty.call(DATASETS, 'current')) {
    try {
      const currentResponse = await fetch(DATASETS.current.url, { cache: 'no-store' });
      if (currentResponse.ok) {
        const currentData = await currentResponse.json();

        if (!shouldDisplayCurrentDataset(currentData)) {
          delete DATASETS.current;
        }
      }
    } catch (error) {
      // Keep current dataset visible if we cannot inspect it.
    }
  }

  datasetsLoaded = true;
}

function updateDatasetInUrl(datasetKey, { replace = true } = {}) {
  const params = new URLSearchParams(window.location.search);
  params.set('dataset', datasetKey);
  const newQuery = params.toString();
  const newUrl = `${window.location.pathname}${newQuery ? `?${newQuery}` : ''}${window.location.hash}`;
  if (newUrl === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;

  if (replace) window.history.replaceState({}, '', newUrl);
  else window.history.pushState({}, '', newUrl);
}

let guildSnapshots = [];
let activeGuildIndex = 0;
let portraitMap = {};
let missingPortraitMap = {};
let portraitMapStaged = {};
let portraitSourceImageManifest = [];
let portraitSourceImageManifestSet = new Set();
let selectedUnassignedImage = '';

let playerSummaryLoaded = false;
let playerSummaryLoading = false;
let playerSummarySeasons = [];
let selectedPlayerSummarySeasonIndex = 0;
let playerSummarySort = { key: 'totalScore', direction: 'desc' };
let expandedPlayerSummaryUserIds = new Set();
let activePlayerSummaryTab = 'attack';
let playerSummaryDefenseSort = { key: 'timesDefended', direction: 'desc' };
let expandedDefensePlayerUserIds = new Set();
let dragState = null;
let activeMapDropTarget = null;
let portraitMapperInitialized = false;
let battleLogGuildNameMap = new Map();
let defenseWarRows = [];
let attackWarRows = [];
let defensePlayerSearch = '';
let defensePlayerSearchInitialized = false;
let attackPlayerSearch = '';
let attackPlayerSearchInitialized = false;
const MISSING_UNIT_AVATAR_URL = './img/missing-unit.svg';
const battleLogFilters = {
  sort: 'newest',
  guild: '',
  season: '',
  war: '',
  result: 'all',
  cleanup: 'all',
  mode: 'attacks',
  zoneType: '',
  attackerPlayer: '',
  defenderPlayer: '',
  attackerUnitIds: [],
  defenderUnitIds: []
};
const BATTLE_LOG_QUERY_KEYS = {
  sort: 'battleSort',
  guild: 'battleGuild',
  season: 'battleSeason',
  war: 'battleWar',
  result: 'battleResult',
  cleanup: 'battleCleanup',
  mode: 'battleMode',
  zoneType: 'battleZone',
  attackerPlayer: 'battleAttacker',
  defenderPlayer: 'battleDefender',
  attackerUnitIds: 'battleAttackerUnits',
  defenderUnitIds: 'battleDefenderUnits'
};
const battleLogFilterOptions = {
  guild: [],
  season: [],
  war: [],
  attacker: [],
  defender: []
};

function loadBattleLogFiltersFromUrl() {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  const read = (key, fallback = '') => params.get(BATTLE_LOG_QUERY_KEYS[key]) ?? fallback;
  const readList = (key) => read(key).split(',').map((value) => value.trim()).filter(Boolean);
  const validOrFallback = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;

  battleLogFilters.sort = validOrFallback(read('sort'), ['newest', 'score-desc', 'score-asc'], 'newest');
  battleLogFilters.guild = read('guild');
  battleLogFilters.season = read('season');
  battleLogFilters.war = read('war');
  battleLogFilters.result = validOrFallback(read('result'), ['all', 'win', 'loss'], 'all');
  battleLogFilters.cleanup = validOrFallback(read('cleanup'), ['all', 'yes', 'no'], 'all');
  battleLogFilters.mode = validOrFallback(read('mode'), ['attacks', 'defenses'], 'attacks');
  battleLogFilters.zoneType = read('zoneType');
  battleLogFilters.attackerPlayer = read('attackerPlayer');
  battleLogFilters.defenderPlayer = read('defenderPlayer');
  battleLogFilters.attackerUnitIds = readList('attackerUnitIds');
  battleLogFilters.defenderUnitIds = readList('defenderUnitIds');
}

function syncBattleLogFiltersToUrl() {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  const values = {
    sort: battleLogFilters.sort !== 'newest' ? battleLogFilters.sort : '',
    guild: battleLogFilters.guild,
    season: battleLogFilters.season,
    war: battleLogFilters.war,
    result: battleLogFilters.result !== 'all' ? battleLogFilters.result : '',
    cleanup: battleLogFilters.cleanup !== 'all' ? battleLogFilters.cleanup : '',
    mode: battleLogFilters.mode !== 'attacks' ? battleLogFilters.mode : '',
    zoneType: battleLogFilters.zoneType,
    attackerPlayer: battleLogFilters.attackerPlayer,
    defenderPlayer: battleLogFilters.defenderPlayer,
    attackerUnitIds: battleLogFilters.attackerUnitIds.join(','),
    defenderUnitIds: battleLogFilters.defenderUnitIds.join(',')
  };

  Object.entries(BATTLE_LOG_QUERY_KEYS).forEach(([key, queryKey]) => {
    if (values[key]) params.set(queryKey, values[key]);
    else params.delete(queryKey);
  });

  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState({}, '', nextUrl);
  }
}
const battleLogPlayerFilterOptions = {
  attacker: [],
  defender: []
};
let battleLogTileTypeOptions = [];
let battleLogFiltersInitialized = false;
let battleLogPageTabsInitialized = false;
let battleLogDataLoaded = false;
let battleLogDataLoading = false;
let leaderboardLayout = 'table';
let leaderboardLayoutInitialized = false;
let leaderboardSort = { key: 'score', direction: 'desc' };
let leaderboardSearch = '';
let legendVisibilityInitialized = false;
const legendVisibility = {
  token: {
    win: true,
    defeat: true,
    abandoned: true,
    cleanup: true,
    'easy-game': true
  },
  scoreTier: {
    bronze: true,
    silver: true,
    gold: true
  },
  buff: {}
};
let legendBlockKeys = {
  token: ['win', 'defeat', 'abandoned', 'cleanup', 'easy-game'],
  scoreTier: ['bronze', 'silver', 'gold'],
  buff: []
};
let guildProjectionLoading = true;
let guildTabsLoading = true;
let legendFilterLoading = true;

const MAX_TOKEN_SCORE = (typeof globalThis !== 'undefined' && Number.isFinite(Number(globalThis.MAX_TOKEN_SCORE)))
  ? Number(globalThis.MAX_TOKEN_SCORE)
  : 1600;
const TOKEN_SLOTS_PER_PLAYER = 10;
const POSSIBLE_TILE_SCORE = (typeof globalThis !== 'undefined' && Number.isFinite(Number(globalThis.POSSIBLE_TILE_SCORE)))
  ? Number(globalThis.POSSIBLE_TILE_SCORE)
  : 520000;
const SCORE_TIER_GOLD = MAX_TOKEN_SCORE;     // 1600
const SCORE_TIER_SILVER = 1400;
const SCORE_TIER_BRONZE = 1200;
const AVATAR_BASE_URL = 'https://webstore-assets.loki.snowprintstudios.com/live/images';

// Frame filenames on tacticus.xyz are hashed, so we map known frame IDs.
const AVATAR_FRAME_URLS = {
  frameMythic01: 'https://tacticus.xyz/assets/frames/ui_avatar_frame_framemythic01-90960f24.png'
};

const SKILL_BUFF_MULTIPLIERS = {
  EnvDefenderHealthBuff2: 1.25,
  EnvArmourSupplies: 1.1,
  EnvFlakFire: 1.2,
  EnvArtillerySupport: 1.15,
  EnvAngelsOfDeath: 1.1,
  EnvFortified: 1.025
};

function makeLegendBuffKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isLegendEnabled(block, key) {
  const blockState = legendVisibility?.[block];
  if (block === 'buff') {
    return Boolean(blockState?.[key] ?? false);
  }
  return Boolean(blockState?.[key] ?? true);
}

function setLegendEnabled(block, key, enabled) {
  if (!legendVisibility[block]) legendVisibility[block] = {};
  legendVisibility[block][key] = Boolean(enabled);
}

function rerenderLeaderboardFromLegendToggle() {
  const snapshot = guildSnapshots[activeGuildIndex];
  if (!snapshot) return;
  renderTable(snapshot);
  renderBuffLegend(snapshot);
}

function getTokenLegendOutcomeKey(token) {
  const isUsed = token && typeof token === 'object' && Object.prototype.hasOwnProperty.call(token, 'hasScore');
  if (!isUsed || token.abandoned) return 'abandoned';
  if (!token.hasScore || token.defended) return 'defeat';
  return 'win';
}

function getTokenScoreTierKey(token) {
  const isUsed = token && typeof token === 'object' && Object.prototype.hasOwnProperty.call(token, 'hasScore');
  if (!isUsed || token.abandoned || !token.hasScore) return null;

  const tokenScore = Number(token.score || 0);
  const { core: coreTokenScore } = getCoreScore(tokenScore);

  if (coreTokenScore >= SCORE_TIER_GOLD) return 'gold';
  if (coreTokenScore >= SCORE_TIER_SILVER) return 'silver';
  if (coreTokenScore >= SCORE_TIER_BRONZE) return 'bronze';
  return null;
}

function setupLegendVisibilityToggle() {
  const legendContainer = document.getElementById('buff-legend');
  if (!legendContainer) return;

  legendContainer.setAttribute('aria-readonly', 'true');
  legendContainer.style.pointerEvents = 'none';
  legendContainer.querySelectorAll('*').forEach((element) => {
    element.setAttribute('aria-disabled', 'true');
    element.style.pointerEvents = 'none';
    element.tabIndex = -1;
    element.setAttribute('tabindex', '-1');
  });
  return;
}

function getCoreScore(value, zoneType = null) {
  const numericValue = Number(value) || 0;

  if (numericValue <= MAX_TOKEN_SCORE) {
    return { core: numericValue, bonus: 0 };
  }

  const zoneBonusMap = (typeof globalThis !== 'undefined' && globalThis.TILE_SCORES && typeof globalThis.TILE_SCORES === 'object')
    ? globalThis.TILE_SCORES
    : {};
  const mappedBonus = Number(zoneBonusMap[String(zoneType || '')] || 0);
  const bonusCandidates = Array.from(new Set([
    mappedBonus,
    40000,
    30000,
    16000,
    10000
  ].filter((bonus) => Number.isFinite(bonus) && bonus > 0)));

  for (const bonus of bonusCandidates) {
    const core = numericValue - bonus;
    if (core >= 0 && core <= MAX_TOKEN_SCORE) {
      return { core, bonus };
    }
  }

  const fallbackCore = Math.min(numericValue, MAX_TOKEN_SCORE);
  return { core: fallbackCore, bonus: Math.max(numericValue - fallbackCore, 0) };
}

function formatValue(value) {
  if (value === null || value === undefined || value === 0) return '—';

  const { core, bonus } = getCoreScore(value);

  if (bonus > 0) {
    return `<span class="inline-flex flex-col items-start gap-0.5"><span class="font-semibold text-slate-200">${core.toLocaleString()}</span><span class="text-xs font-medium text-slate-500">(${bonus.toLocaleString()})</span></span>`;
  }

  return `<span class="inline-flex flex-col items-start gap-0.5"><span class="font-semibold text-slate-200">${core.toLocaleString()}</span></span>`;
}

function formatCountWithCleanup(count, cleanupCount) {
  const countText = Number(count || 0).toLocaleString();
  return cleanupCount > 0 ? `${countText} (${Number(cleanupCount).toLocaleString()}🧹)` : countText;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function getPrimaryEventResponseData(data) {
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

function getLatestActivityTimestamp(data) {
  const logs = getPrimaryEventResponseData(data)?.activityLogs;
  if (!Array.isArray(logs) || logs.length === 0) return null;

  let maxTimestamp = 0;

  logs.forEach((log) => {
    const createdOn = Number(log?.createdOn || 0);
    if (Number.isFinite(createdOn) && createdOn > maxTimestamp) {
      maxTimestamp = createdOn;
    }
  });

  return maxTimestamp > 0 ? maxTimestamp : null;
}

function renderLastUpdated({ responseLastModified, dataTimestamp }) {
  const el = document.getElementById('last-updated');
  if (!el) return;

  const fromHeader = responseLastModified ? formatDateTime(responseLastModified) : null;
  if (fromHeader) {
    el.textContent = fromHeader;
    return;
  }

  const fromData = dataTimestamp ? formatDateTime(dataTimestamp) : null;
  el.textContent = fromData || 'Unknown';
}

function getAvatarImageUrl(avatarUnitId) {
  const normalized = String(avatarUnitId || '').trim().toLowerCase();
  if (!normalized) return null;
  return `${AVATAR_BASE_URL}/avatar_${normalized}.png`;
}

function getFrameImageUrl(avatarFrameId) {
  if (!avatarFrameId) return null;
  return AVATAR_FRAME_URLS[avatarFrameId] || null;
}

function renderPlayerAvatar(player) {
  const avatarSrc = getAvatarImageUrl(player.avatarUnitId);
  const frameSrc = getFrameImageUrl(player.avatarFrameId);
  const avatarAlt = `${player.name || 'Player'} avatar`;

  const avatarImg = avatarSrc
    ? `<img class="absolute inset-1 z-10 h-9 w-9 rounded-full bg-slate-900/95 object-cover" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(avatarAlt)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
    : '';
  const frameImg = frameSrc
    ? `<img class="pointer-events-none absolute inset-0 z-0 h-11 w-11 object-contain" src="${escapeHtml(frameSrc)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
    : '';

  return `<span class="relative h-11 w-11 shrink-0">${avatarImg}${frameImg}</span>`;
}

function colorFor(name) {
  const s = String(name || '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) % 360;
  }
  return `hsl(${hash},72%,56%)`;
}

function getHealthBarColor(percent) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const hue = Math.round((clamped / 100) * 120);
  return `hsl(${hue}, 80%, 46%)`;
}

function renderBuffs(buffs) {
  if (!Array.isArray(buffs) || buffs.length === 0) return '';
  const items = buffs.map((b) => {
    const name = (b && (b.abilityId || b.name || b.id)) || String(b || '');
    const key = makeLegendBuffKey(name);
    if (key && !isLegendEnabled('buff', key)) return '';
    const safe = escapeHtml(name);
    const color = colorFor(name);
    return `<span class="inline-block h-3 w-3 rounded-full border border-white/10" title="${safe}" style="background:${color}"></span>`;
  }).filter(Boolean);

  if (items.length === 0) return '';

  return `<div class="mt-1 flex justify-center gap-1.5">${items.join('')}</div>`;
}

function getBattleFlags(log) {
  const defenderUnits = Array.isArray(log?.defender?.units) ? log.defender.units : [];
  const defended = defenderUnits.some((unit) => Object.prototype.hasOwnProperty.call(unit, 'remainingHPAfter'));
  const cleanup = defenderUnits.some((unit) => {
    if (!Object.prototype.hasOwnProperty.call(unit, 'remainingHPBefore')) return true;
    const remaining = Number(unit.remainingHPBefore ?? 0);
    const start = Number(unit.startHPBefore ?? 0);
    return remaining < start;
  });

  return { defended, cleanup };
}

function calculateSkillRating(token) {
  if (!token || !token.hasScore || token.abandoned) return 0;

  const baseScore = Number(token.score || 0);
  if (baseScore <= 0) return 0;

  let rating = baseScore;
  const uniqueBuffs = new Set((token.buffs || []).map((b) => (b && (b.abilityId || b.name || b.id)) || ''));

  uniqueBuffs.forEach((buffName) => {
    const multiplier = SKILL_BUFF_MULTIPLIERS[buffName];
    if (multiplier) rating *= multiplier;
  });

  if (token.cleanup) {
    rating *= 0.75;
  }

  if (token.easyGame) {
    rating *= 0.1;
  }

  // Win doubles rating, lose keeps rating as-is.
  const isWin = !token.defended;
  rating *= isWin ? 2 : 1;

  return rating / 10;
}

function buildFallbackSnapshot() {
  return {
    eventName: 'Fallback snapshot',
    source: 'Offline placeholder',
    players: [
      {
        name: 'No data loaded',
        tokens: Array.from({ length: TOKEN_SLOTS_PER_PLAYER }, () => ({ score: 0, abandoned: false }))
      }
    ],
    battles: []
  };
}

function buildSnapshot(data) {
  console.log({ data });
  const eventResponseData = getPrimaryEventResponseData(data);
  const playerData = eventResponseData?.playerData || [];
  const activityLogs = eventResponseData?.activityLogs || [];
  const guildData = eventResponseData?.guildData || [];
  const playerNames = new Map(playerData.map((player) => [player.userId, player.displayName]));
  console.log({ playerNames });
  const playerProfiles = new Map(playerData.map((player) => [player.userId, {
    avatarUnitId: player.avatarUnitId || null,
    avatarFrameId: player.avatarFrameId || null
  }]));

  const guildBuckets = new Map();
  const guildBattleLogs = new Map();
  const userTeamIndex = new Map();
  const guildTeamIndexes = guildData
    .map((guild) => Number(guild.teamIndex))
    .filter((teamIndex) => Number.isFinite(teamIndex));
  const teamIndexSet = new Set(guildTeamIndexes);

  const assignTeamIfValid = (userId, teamIndex) => {
    if (!userId || userTeamIndex.has(userId)) return;
    if (!teamIndexSet.has(teamIndex)) return;
    userTeamIndex.set(userId, teamIndex);
  };

  const normalizeForTagMatch = (value) => String(value || '').toUpperCase();
  const teamTagMatchers = guildData.map((guild) => {
    const teamIndex = Number(guild.teamIndex);
    const acronym = String(guild.name || '')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .toUpperCase();

    const tags = new Set();
    if (acronym.length >= 2) {
      tags.add(`[${acronym}]`);
      tags.add(`〔${acronym}〕`);
      tags.add(`(${acronym})`);
      tags.add(` ${acronym} `);
    }

    return { teamIndex, tags: Array.from(tags) };
  });

  const inferTeamFromDisplayName = (displayName) => {
    const normalizedName = normalizeForTagMatch(` ${displayName || ''} `);
    const matches = [];

    teamTagMatchers.forEach(({ teamIndex, tags }) => {
      const found = tags.some((tag) => normalizedName.includes(normalizeForTagMatch(tag)));
      if (found) matches.push(teamIndex);
    });

    if (matches.length === 1) return matches[0];
    return null;
  };

  guildData.forEach((guild) => {
    const teamIndex = Number(guild.teamIndex);
    guildBuckets.set(teamIndex, new Map());
    guildBattleLogs.set(teamIndex, []);
  });

  const getOpposingTeamIndex = (teamIndex) => {
    if (guildTeamIndexes.length !== 2) return null;
    return guildTeamIndexes.find((idx) => idx !== teamIndex) ?? null;
  };

  activityLogs.forEach((log) => {
    const teamIndex = Number(log?.teamIndex);
    const userId = log?.userId;

    if (!Number.isFinite(teamIndex) || !userId) return;
    if (!guildBuckets.has(teamIndex)) return;
    if (log?.type !== 'battleFinished') {
      return;
    }
    assignTeamIfValid(userId, teamIndex);

    const defenderUserId = log?.defender?.userId;
    const opposingTeamIndex = getOpposingTeamIndex(teamIndex);
    if (defenderUserId && Number.isFinite(opposingTeamIndex)) {
      assignTeamIfValid(defenderUserId, opposingTeamIndex);
    }
  });

  playerData.forEach((player) => {
    const userId = player?.userId;
    if (!userId || userTeamIndex.has(userId)) return;

    const inferredTeamIndex = inferTeamFromDisplayName(player?.displayName);
    if (Number.isFinite(inferredTeamIndex)) {
      assignTeamIfValid(userId, inferredTeamIndex);
    }
  });

  const countPlayersPerTeam = () => {
    const counts = new Map(guildTeamIndexes.map((teamIndex) => [teamIndex, 0]));
    userTeamIndex.forEach((teamIndex) => {
      counts.set(teamIndex, (counts.get(teamIndex) || 0) + 1);
    });
    return counts;
  };

  playerData.forEach((player) => {
    const userId = player?.userId;
    if (!userId || userTeamIndex.has(userId)) return;

    const counts = countPlayersPerTeam();
    const smallestTeamIndex = guildTeamIndexes.reduce((smallest, teamIndex) => {
      if (smallest === null) return teamIndex;
      return (counts.get(teamIndex) || 0) < (counts.get(smallest) || 0) ? teamIndex : smallest;
    }, null);

    if (Number.isFinite(smallestTeamIndex)) {
      assignTeamIfValid(userId, smallestTeamIndex);
    }
  });

  playerData.forEach((player) => {
    const userId = player?.userId;
    if (!userId) return;

    const teamIndex = userTeamIndex.get(userId);
    if (!Number.isFinite(teamIndex)) return;
    const bucket = guildBuckets.get(teamIndex);

    if (!bucket) return;
    if (!bucket.has(userId)) bucket.set(userId, []);
  });

  for (const log of activityLogs) {
    if (log.type !== 'battleFinished') continue;

    const teamIndex = Number(log.teamIndex ?? 1);
    const bucket = guildBuckets.get(teamIndex);

    if (!bucket) continue;

    const userId = log.userId;
    const hasScore = Object.prototype.hasOwnProperty.call(log, 'score');
    const abandoned = !!log.abandoned;
    let entryScore = 0;
    let tileScore = 0;
    let defended = false;
    let cleanup = false;

    if (hasScore) {
      const scored = getCoreScore(Number(log.score || 0));
      entryScore = scored.core;
      const { bonus } = scored;
      // Raw score above 1600 includes a tile-clear component in the thousands.
      tileScore = bonus;
    }

    if (!abandoned) {
      const flags = getBattleFlags(log);
      defended = flags.defended;
      cleanup = flags.cleanup;
    }

    // extract buffs if present on the log (common shapes: log.buffs or log.attacker.buffs)
    let buffs = [];
    if (Array.isArray(log.buffs)) {
      buffs = log.buffs;
    } else if (log.attacker && Array.isArray(log.attacker.buffs)) {
      buffs = log.attacker.buffs;
    }

    if (!bucket.has(userId)) {
      bucket.set(userId, []);
    }

    const skillRating = calculateSkillRating({
      score: entryScore,
      abandoned,
      defended,
      cleanup,
      hasScore,
      buffs,
      easyGame: isEasyGameBattle(log)
    });

    bucket.get(userId).push({ score: entryScore, tileScore, skillRating, abandoned, defended, cleanup, hasScore, buffs, easyGame: isEasyGameBattle(log) });

    const defenderUserId = log?.defender?.userId || null;
    const defenderTeamIndex = getOpposingTeamIndex(teamIndex);
    const attackerUnits = Array.isArray(log?.attacker?.units) ? log.attacker.units : [];
    const defenderUnits = Array.isArray(log?.defender?.units) ? log.defender.units : [];
    const attackerMachineOfWar = log?.attacker?.machineOfWar || null;
    const defenderMachineOfWar = log?.defender?.machineOfWar || null;
    const rawScore = hasScore ? Number(log.score || 0) : 0;
    const attackerAvatarUnitId = playerProfiles.get(userId)?.avatarUnitId || null;
    const defenderAvatarUnitId = playerProfiles.get(defenderUserId)?.avatarUnitId || null;

    if (guildBattleLogs.has(teamIndex)) {
      guildBattleLogs.get(teamIndex).push({
        id: log?.id || `${userId || 'unknown'}-${log?.createdOn || 0}`,
        createdOn: Number(log?.createdOn || 0),
        zoneType: log?.zone?.type || null,
        attackerUserId: userId || null,
        attackerName: playerNames.get(userId) || userId || 'Unknown attacker',
        attackerAvatarUnitId,
        defenderUserId,
        defenderName: playerNames.get(defenderUserId) || defenderUserId || 'Unknown defender',
        defenderAvatarUnitId,
        attackerTeamIndex: teamIndex,
        defenderTeamIndex: Number.isFinite(defenderTeamIndex) ? defenderTeamIndex : null,
        hasScore,
        abandoned,
        defended,
        cleanup,
        easyGame: isEasyGameBattle(log),
        score: rawScore,
        attackerUnits,
        defenderUnits,
        attackerMachineOfWar,
        defenderMachineOfWar
      });
    }
  }

  return guildData.map((guild) => {
    const bucket = guildBuckets.get(Number(guild.teamIndex)) || new Map();
    const players = Array.from(bucket.entries())
      .map(([userId, scores]) => {
          const tokens = Array.from({ length: 10 }, (_, index) => scores[index] || { score: 0, abandoned: false });
          const usedTokens = tokens.filter((entry) => Object.prototype.hasOwnProperty.call(entry, 'hasScore')).length;
          const totalScore = tokens.reduce((sum, entry) => sum + (entry.abandoned ? 0 : entry.score), 0);
          const averageScore = usedTokens > 0 ? Math.round(totalScore / usedTokens) : 0;
          const tilesCleared = tokens.filter((entry) => entry.tileScore > 0).length;
          const tileScore = tokens.reduce((sum, entry) => sum + (entry.tileScore || 0), 0);
          const totalSkillRating = tokens.reduce((sum, entry) => sum + (entry.skillRating || 0), 0);

        return {
          name: playerNames.get(userId) || userId,
          userId,
          avatarUnitId: playerProfiles.get(userId)?.avatarUnitId || null,
          avatarFrameId: playerProfiles.get(userId)?.avatarFrameId || null,
          tokens,
          usedTokens,
          totalScore,
          averageScore,
          tilesCleared,
          tileScore,
          totalSkillRating
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore);

    return {
      teamIndex: Number(guild.teamIndex),
      name: guild.name,
      players,
      battles: (guildBattleLogs.get(Number(guild.teamIndex)) || []).sort((a, b) => b.createdOn - a.createdOn)
    };
  });
}

function buildRows(snapshot) {
  return snapshot.players
    .map((player) => ({
      ...player,
      avatarUnitId: player.avatarUnitId || null,
      avatarFrameId: player.avatarFrameId || null,
      tokens: Array.isArray(player.tokens)
        ? player.tokens.map((token) => ({
            ...token,
            easyGame: !!token?.easyGame
          }))
        : [],
      usedTokens: player.usedTokens ?? player.tokens.filter((entry) => Object.prototype.hasOwnProperty.call(entry, 'hasScore')).length,
      totalScore: player.totalScore ?? player.tokens.reduce((sum, entry) => sum + (entry.abandoned ? 0 : entry.score), 0),
      averageScore: player.averageScore ?? (player.usedTokens > 0 ? Math.round(player.totalScore / player.usedTokens) : 0),
      totalSkillRating: player.totalSkillRating ?? player.tokens.reduce((sum, entry) => sum + (entry.skillRating || 0), 0)
    }))
    .sort((a, b) => b.totalScore - a.totalScore);
}

function summarizeGuild(snapshot) {
  const rows = buildRows(snapshot);
  console.log(rows);
  const isUsedToken = (token) => token && typeof token === 'object' && Object.prototype.hasOwnProperty.call(token, 'hasScore');
  const totalPlayers = rows.length > 30 ? 30 : rows.length;
  const totalTokenSlots = totalPlayers * TOKEN_SLOTS_PER_PLAYER;
  const usedTokens = rows.reduce((sum, player) => sum + player.usedTokens, 0);
  const remainingTokens = Math.max(totalTokenSlots - usedTokens, 0);
  const tokenScore = rows.reduce((sum, player) => sum + player.totalScore, 0);
  const tileScore = rows.reduce((sum, player) => sum + player.tileScore, 0);
  const currentTotal = tokenScore + tileScore;
  const avgPerUsedToken = usedTokens > 0 ? tokenScore / usedTokens : 0;
  const cappedAvgPerToken = Math.min(avgPerUsedToken, MAX_TOKEN_SCORE);
  const projectedTokenGain = Math.round(remainingTokens * cappedAvgPerToken);
  const projectedTokenScore = tokenScore + projectedTokenGain;
  const projectedFinal = currentTotal + projectedTokenGain;
  const totalWins = rows.reduce((sum, player) => sum + player.tokens.reduce((tokenSum, token) => {
    if (!isUsedToken(token) || token.abandoned) return tokenSum;
    const isWin = !!token.hasScore && !token.defended && Number(token.score || 0) > 0;
    return tokenSum + (isWin ? 1 : 0);
  }, 0), 0);
  const totalCleanupWins = rows.reduce((sum, player) => sum + player.tokens.reduce((tokenSum, token) => {
    if (!isUsedToken(token) || token.abandoned) return tokenSum;
    const isWin = !!token.hasScore && !token.defended && Number(token.score || 0) > 0;
    return tokenSum + (isWin && token.cleanup ? 1 : 0);
  }, 0), 0);
  const totalDefeats = rows.reduce((sum, player) => sum + player.tokens.reduce((tokenSum, token) => {
    if (!isUsedToken(token) || token.abandoned) return tokenSum;
    const isWin = !!token.hasScore && !token.defended && Number(token.score || 0) > 0;
    return tokenSum + (isWin ? 0 : 1);
  }, 0), 0);
  const totalCleanupDefeats = rows.reduce((sum, player) => sum + player.tokens.reduce((tokenSum, token) => {
    if (!isUsedToken(token) || token.abandoned) return tokenSum;
    const isWin = !!token.hasScore && !token.defended && Number(token.score || 0) > 0;
    return tokenSum + (!isWin && token.cleanup ? 1 : 0);
  }, 0), 0);
  const totalAbandoned = rows.reduce((sum, player) => sum + player.tokens.reduce((tokenSum, token) => tokenSum + (token && token.abandoned ? 1 : 0), 0), 0);
  const totalUnused = rows.reduce((sum, player) => sum + player.tokens.reduce((tokenSum, token) => tokenSum + (isUsedToken(token) ? 0 : 1), 0), 0);

  return {
    teamIndex: snapshot.teamIndex,
    name: snapshot.name,
    rows,
    totalPlayers,
    totalTokenSlots,
    usedTokens,
    remainingTokens,
    tokenScore,
    tileScore,
    currentTotal,
    avgPerUsedToken,
    projectedTokenGain,
    projectedTokenScore,
    projectedFinal,
    totalWins,
    totalCleanupWins,
    totalDefeats,
    totalCleanupDefeats,
    totalAbandoned,
    totalUnused
  };
}

function renderGuildTokenProjectionTable() {
  const tableBody = document.getElementById('guild-token-projection-body');

  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = '';

  const renderSkeletonRow = () => {
    const cellMarkup = Array.from({ length: 11 }, (_, index) => `
      <td class="${index === 0 ? 'py-2 pr-3 align-middle' : index === 5 || index === 8 ? 'border-l border-slate-700/60 py-2 pl-3 pr-3 align-middle' : index === 10 ? 'border-l border-slate-700/60 py-2 pl-3 align-middle' : 'py-2 pr-3 align-middle'}">
        <div class="h-6 w-full animate-pulse rounded bg-slate-700/60"></div>
      </td>
    `).join('');

    return `<tr class="leading-none" style="height: 3rem; min-height: 3rem;">${cellMarkup}</tr>`;
  };

  if (guildProjectionLoading || !Array.isArray(guildSnapshots) || guildSnapshots.length === 0) {
    tableBody.innerHTML = Array.from({ length: 2 }, renderSkeletonRow).join('');
    return;
  }

  const summaries = guildSnapshots.map((snapshot) => summarizeGuild(snapshot));
  const activeTeamIndex = guildSnapshots[activeGuildIndex]?.teamIndex;

  summaries
    .sort((a, b) => {
      const aIsPraetorians = String(a.name || '').toLowerCase().includes('praetorians');
      const bIsPraetorians = String(b.name || '').toLowerCase().includes('praetorians');
      if (aIsPraetorians !== bIsPraetorians) {
        return aIsPraetorians ? -1 : 1;
      }

      const aIsActive = Number(a.teamIndex) === Number(activeTeamIndex);
      const bIsActive = Number(b.teamIndex) === Number(activeTeamIndex);

      if (aIsActive !== bIsActive) {
        return aIsActive ? -1 : 1;
      }

      return b.projectedTokenScore - a.projectedTokenScore;
    })
    .forEach((guild) => {
      const row = document.createElement('tr');
      row.style.height = '3rem';
      row.style.minHeight = '3rem';
      const tileScorePct = POSSIBLE_TILE_SCORE > 0 ? Math.round((guild.tileScore / POSSIBLE_TILE_SCORE) * 100) : 0;
      row.innerHTML = `
        <td class="py-1 pr-3 font-semibold text-emerald-100">${escapeHtml(guild.name)} (${guild.totalPlayers.toLocaleString()})</td>
        <td class="border-l border-slate-700/60 py-1 pl-3 pr-3 text-slate-200">${guild.totalTokenSlots.toLocaleString()}</td>
        <td class="py-1 pr-3 text-slate-200">${guild.usedTokens.toLocaleString()}</td>
        <td class="py-1 pr-3 text-slate-200">${guild.remainingTokens.toLocaleString()}</td>
        <td class="py-1 pr-3 text-cyan-200">${guild.avgPerUsedToken.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
        <td class="border-l border-slate-700/60 py-1 pl-3 pr-3 text-slate-200">${formatCountWithCleanup(guild.totalWins, guild.totalCleanupWins)}</td>
        <td class="py-1 pr-3 text-slate-200">${formatCountWithCleanup(guild.totalDefeats, guild.totalCleanupDefeats)}</td>
        <td class="py-1 pr-3 text-slate-200">${guild.totalAbandoned.toLocaleString()}</td>
        <td class="border-l border-slate-700/60 py-1 pl-3 pr-3 text-slate-200">${guild.tokenScore.toLocaleString()}</td>
        <td class="py-1 pr-3 font-semibold text-emerald-200">${guild.projectedTokenScore.toLocaleString()}</td>
        <td class="border-l border-slate-700/60 py-1 pl-3 text-slate-200">${guild.tileScore.toLocaleString()} (${tileScorePct}%)</td>
      `;
      tableBody.appendChild(row);
    });
}

function renderGuildTabs() {
  const tabsContainer = document.getElementById('guild-tabs');

  if (!tabsContainer) return;

  tabsContainer.innerHTML = '';

  const renderSkeletonButton = (index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inline-flex min-h-[2.25rem] items-center justify-center rounded-full border border-slate-700 bg-slate-800/70 px-4 py-2 text-sm font-semibold leading-4 text-slate-300 opacity-90';
    button.setAttribute('disabled', 'disabled');
    button.innerHTML = '<span class="block h-4 w-20 animate-pulse rounded-full bg-slate-700/70"></span>';
    return button;
  };

  if (guildTabsLoading || !Array.isArray(guildSnapshots) || guildSnapshots.length === 0) {
    const skeletonCount = Math.max(2, Math.min(4, guildSnapshots?.length || 2));
    Array.from({ length: skeletonCount }, (_, index) => renderSkeletonButton(index)).forEach((button) => tabsContainer.appendChild(button));
    return;
  }

  const attackIndex = getDefaultActiveGuildIndex(guildSnapshots);
  const tabs = [
    { label: 'Attack', index: attackIndex },
    ...(guildSnapshots.length > 1
      ? [{ label: 'Defence', index: guildSnapshots.findIndex((_, index) => index !== attackIndex) }]
      : [])
  ];

  tabs.forEach(({ label, index }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `inline-flex min-h-[2.25rem] items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold leading-4 transition ${index === activeGuildIndex ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200 shadow-lg shadow-cyan-500/10' : 'border-slate-700 bg-slate-800/70 text-slate-300 hover:border-slate-500 hover:text-white'}`;
    button.textContent = label;
    button.addEventListener('click', () => {
      activeGuildIndex = index;
      renderActiveGuild();
    });

    tabsContainer.appendChild(button);
  });
}

function getDefaultActiveGuildIndex(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return 0;
  }

  const praetoriansIndex = snapshots.findIndex((guild) => String(guild?.name || '').toLowerCase().includes('praetorians of terra'));
  return praetoriansIndex >= 0 ? praetoriansIndex : 0;
}

const SEASON_GAP_DAYS = 5; // real inter-war gaps run ~1-2 days; season breaks run ~2-3 weeks
const MAX_WARS_PER_SEASON = 6;

function extractDatasetDate(datasetKey, dataset) {
  if (dataset?.end) {
    const end = new Date(dataset.end);
    if (!Number.isNaN(end.getTime())) return end;
  }
  const source = `${datasetKey} ${dataset?.label || ''}`;
  const match = source.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function extractDatasetStart(datasetKey, dataset) {
  if (dataset?.start) {
    const start = new Date(dataset.start);
    if (!Number.isNaN(start.getTime())) return start;
  }
  return extractDatasetDate(datasetKey, dataset);
}

function formatSeasonDate(date) {
  return date.toISOString().slice(0, 10);
}

function groupDatasetsIntoSeasons(entries) {
  // entries: [datasetKey, dataset][], sorted by end date descending (undated entries excluded)
  const groups = [];
  let currentGroup = null;
  let previousStart = null;

  entries.forEach(([datasetKey, dataset]) => {
    const end = extractDatasetDate(datasetKey, dataset);
    const start = extractDatasetStart(datasetKey, dataset);

    // gap = time between this war's end and the next (later) war's start already seen
    const gapDays = previousStart ? (previousStart - end) / (1000 * 60 * 60 * 24) : Infinity;

    if (!currentGroup || gapDays > SEASON_GAP_DAYS || currentGroup.entries.length >= MAX_WARS_PER_SEASON) {
      currentGroup = { label: null, startDate: start, endDate: end, entries: [] };
      groups.push(currentGroup);
    }

    currentGroup.entries.push([datasetKey, dataset]);
    currentGroup.startDate = start;
    previousStart = start;
  });

  groups.forEach((group) => {
    if (!group.startDate) return;
    group.label = group.entries.length > 1
      ? `Season ${formatSeasonDate(group.startDate)} to ${formatSeasonDate(group.endDate)}`
      : `Season ${formatSeasonDate(group.startDate)}`;
  });

  return groups;
}

function renderWarSeasonCards(records) {
  const grid = document.getElementById('war-season-wars-grid');
  if (!grid) return;

  if (!Array.isArray(records) || records.length === 0) {
    grid.innerHTML = '<p class="col-span-full rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-6 text-center text-sm text-slate-400">Loading wars...</p>';
    return;
  }

  const options = records.map((record) => {
    const opponentName = record.opponentSnapshot?.name || 'Unknown opponent';
    const warDate = extractDatasetDate(record.dataset.key, record.dataset);
    return `<option value="${escapeHtml(record.dataset.key)}">${escapeHtml(opponentName)} - ${escapeHtml(warDate ? formatSeasonDate(warDate) : 'Unknown date')}</option>`;
  }).join('');

  grid.innerHTML = `
    <label for="war-opponent-select" class="sr-only">Opponent war</label>
    <select id="war-opponent-select" class="w-full rounded-md border border-slate-600 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-slate-100 sm:max-w-xl">
      ${options}
    </select>`;
  const select = document.getElementById('war-opponent-select');
  if (!select) return;

  select.value = selectedWarDatasetKey || records[0].dataset.key;
  select.addEventListener('change', () => {
    const datasetKey = select.value;
    if (!datasetKey || !Object.prototype.hasOwnProperty.call(DATASETS, datasetKey)) return;
    selectedWarDatasetKey = datasetKey;
    activeDatasetKey = datasetKey;
    updateDatasetInUrl(datasetKey, { replace: false });
    loadGuildData();
  });
}

function setWarSummaryVisibility(isVisible) {
  const summary = document.getElementById('war-selected-summary');
  if (summary) summary.classList.toggle('hidden', !isVisible);
}

function renderDatasetTabs() {
  const datasetSelect = document.getElementById('dataset-select');
  const sourceLabel = document.getElementById('source-label');

  if (!datasetSelect) return;

  datasetSelect.innerHTML = '';

  const entries = Object.entries(DATASETS);
  const datedEntries = entries
    .filter(([key, dataset]) => extractDatasetDate(key, dataset))
    .sort(([keyA, a], [keyB, b]) => extractDatasetDate(keyB, b) - extractDatasetDate(keyA, a));
  const undatedEntries = entries.filter(([key, dataset]) => !extractDatasetDate(key, dataset));
  const seasons = groupDatasetsIntoSeasons(datedEntries);
  seasonGroups = seasons;

  undatedEntries.forEach(([datasetKey, dataset]) => {
    const option = document.createElement('option');
    option.value = datasetKey;
    option.textContent = dataset.label;
    datasetSelect.appendChild(option);
  });

  seasons.forEach((season) => {
    const option = document.createElement('option');
    const firstEntry = season.entries[0];
    option.value = firstEntry?.[0] || '';
    option.textContent = season.startDate && season.endDate
      ? `War season - ${formatSeasonDate(season.startDate)} - ${formatSeasonDate(season.endDate)}`
      : 'War season';
    datasetSelect.appendChild(option);
  });

  if (!datasetSelect.dataset.initialized) {
    datasetSelect.addEventListener('change', (event) => {
      const selectedKey = event.target.value;
      if (!Object.prototype.hasOwnProperty.call(DATASETS, selectedKey)) return;
      if (selectedKey === activeDatasetKey) return;

      selectedWarDatasetKey = '';
      activeDatasetKey = selectedKey;
      updateDatasetInUrl(activeDatasetKey, { replace: false });
      loadGuildData();
    });

    window.addEventListener('popstate', () => {
      const key = getDatasetKeyFromUrl();
      if (key === activeDatasetKey) return;

      activeDatasetKey = key;
      loadGuildData();
    });

    datasetSelect.dataset.initialized = 'true';
  }

  const activeSeason = seasons.find((season) => season.entries.some(([datasetKey]) => datasetKey === activeDatasetKey));
  datasetSelect.value = activeSeason?.entries?.[0]?.[0] || activeDatasetKey;

  if (sourceLabel) {
    sourceLabel.textContent = DATASETS[activeDatasetKey]?.sourceLabel || 'Unknown source';
  }
}

function getActivityTimestampRange(data) {
  const logs = getPrimaryEventResponseData(data)?.activityLogs;
  if (!Array.isArray(logs) || logs.length === 0) return { start: null, end: null };

  let min = Infinity;
  let max = 0;

  logs.forEach((log) => {
    const createdOn = Number(log?.createdOn || 0);
    if (Number.isFinite(createdOn) && createdOn > 0) {
      if (createdOn > max) max = createdOn;
      if (createdOn < min) min = createdOn;
    }
  });

  return {
    start: min === Infinity ? null : min,
    end: max > 0 ? max : null
  };
}

async function loadPlayerSummaryData() {
  if (playerSummaryLoaded || playerSummaryLoading) return;
  playerSummaryLoading = true;

  await loadDatasetManifest();

  const loaded = [];

  for (const [key, dataset] of Object.entries(DATASETS)) {
    try {
      const response = await fetch(dataset.url, { cache: 'no-store' });
      if (!response.ok) continue;

      const data = await response.json();
      const snapshots = buildSnapshot(data);
      const targetIndex = getDefaultActiveGuildIndex(snapshots);
      const snapshot = snapshots[targetIndex];
      if (!snapshot || !Array.isArray(snapshot.players) || snapshot.players.length === 0) continue;

      // Opponent's attack log doubles as our defense log (their attacker vs. our defender).
      const opponentSnapshot = snapshots.find((entry, index) => index !== targetIndex) || null;
      const opponentBattles = Array.isArray(opponentSnapshot?.battles) ? opponentSnapshot.battles : [];

      const { start, end } = getActivityTimestampRange(data);
      if (!end) continue;

      loaded.push({
        key,
        label: dataset.label,
        start: new Date(start || end).toISOString(),
        end: new Date(end).toISOString(),
        snapshot,
        opponentBattles
      });
    } catch (error) {
      console.error(`Failed to load dataset ${key} for player summary`, error);
    }
  }

  loaded.sort((a, b) => new Date(b.end) - new Date(a.end));

  const seasons = groupDatasetsIntoSeasons(loaded.map((entry) => [entry.key, entry]));
  playerSummarySeasons = seasons.map((season) => ({
    label: season.label || 'Unknown season',
    datasets: season.entries.map(([, entry]) => entry)
  }));

  playerSummaryLoading = false;
  playerSummaryLoaded = true;
}

function summarizePlayerSeason(season, userId) {
  let spent = 0;
  let totalScore = 0;
  let wins = 0;
  let cleanupWins = 0;
  let defeats = 0;
  let cleanupDefeats = 0;
  let abandoned = 0;
  let totalSkillRating = 0;
  const wars = [];

  season.datasets.forEach((dataset) => {
    const player = dataset.snapshot.players.find((entry) => entry.userId === userId);
    const skillRating = player ? Number(player.totalSkillRating || 0) : 0;
    wars.push({ label: dataset.label, player: player || null, skillRating });

    if (!player) return;

    totalSkillRating += skillRating;

    player.tokens.forEach((token) => {
      const isUsed = token && Object.prototype.hasOwnProperty.call(token, 'hasScore');
      if (isUsed) {
        spent += 1;
        if (!token.abandoned) {
          totalScore += Number(token.score || 0);
          const isWin = !!token.hasScore && !token.defended && Number(token.score || 0) > 0;
          if (isWin) {
            wins += 1;
            if (token.cleanup) cleanupWins += 1;
          } else {
            defeats += 1;
            if (token.cleanup) cleanupDefeats += 1;
          }
        }
      }
      if (token.abandoned) abandoned += 1;
    });
  });

  const totalTokens = season.datasets.length * TOKEN_SLOTS_PER_PLAYER;
  const remaining = Math.max(totalTokens - spent, 0);
  const avgPerToken = spent > 0 ? totalScore / spent : 0;
  const possibleScore = totalTokens * MAX_TOKEN_SCORE;
  const avgSkillRating = season.datasets.length > 0 ? totalSkillRating / season.datasets.length : 0;

  return { totalTokens, spent, remaining, avgPerToken, wins, cleanupWins, defeats, cleanupDefeats, abandoned, totalScore, possibleScore, totalSkillRating, avgSkillRating, wars };
}

function summarizePlayerDefenseSeason(season, userId) {
  let timesDefended = 0;
  let attackerLost = 0;
  const wars = [];

  season.datasets.forEach((dataset) => {
    const battles = Array.isArray(dataset.opponentBattles) ? dataset.opponentBattles : [];
    const defenseBattles = battles.filter((battle) => battle.defenderUserId === userId && !battle.abandoned);
    const warAttackerLost = defenseBattles.filter((battle) => battle.defended).length;

    timesDefended += defenseBattles.length;
    attackerLost += warAttackerLost;

    wars.push({
      label: dataset.label,
      timesDefended: defenseBattles.length,
      attackerLost: warAttackerLost,
      attackerLostPct: defenseBattles.length > 0 ? (warAttackerLost / defenseBattles.length) * 100 : 0
    });
  });

  const attackerLostPct = timesDefended > 0 ? (attackerLost / timesDefended) * 100 : 0;

  return { timesDefended, attackerLost, attackerLostPct, wars };
}

function renderPlayerSummarySeasonSelect() {
  const select = document.getElementById('player-summary-season-select');
  if (!select) return;

  if (!playerSummarySeasons.length) {
    select.innerHTML = '<option value="">No seasons available</option>';
    return;
  }

  select.innerHTML = playerSummarySeasons
    .map((season, index) => `<option value="${index}">${escapeHtml(season.label)}</option>`)
    .join('');
  select.value = String(selectedPlayerSummarySeasonIndex);

  if (!select.dataset.initialized) {
    select.addEventListener('change', (event) => {
      selectedPlayerSummarySeasonIndex = Number(event.target.value) || 0;
      expandedPlayerSummaryUserIds.clear();
      expandedDefensePlayerUserIds.clear();
      renderPlayerSummaryBody();
    });
    select.dataset.initialized = 'true';
  }
}

function getSeasonPlayerOptions(season) {
  const namesById = new Map();
  season.datasets.forEach((dataset) => {
    dataset.snapshot.players.forEach((player) => {
      if (player?.userId && !namesById.has(player.userId)) {
        namesById.set(player.userId, player.name || player.userId);
      }
    });
  });
  return Array.from(namesById.entries()).map(([userId, name]) => ({ userId, name }));
}

function sortPlayerSummaryRows(rows) {
  const { key, direction } = playerSummarySort;
  const dir = direction === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    if (key === 'name') {
      return dir * a.name.localeCompare(b.name);
    }
    return dir * (Number(a.stats[key] || 0) - Number(b.stats[key] || 0));
  });
}

function renderPlayerSummarySortHeader(key, label, { sticky = false } = {}) {
  const isActive = playerSummarySort.key === key;
  const arrow = isActive ? (playerSummarySort.direction === 'asc' ? '▲' : '▼') : '';
  const thClass = sticky
    ? 'sticky left-0 top-0 z-20 min-w-[15rem] whitespace-nowrap bg-slate-800/95 px-4 py-3 font-semibold'
    : 'whitespace-nowrap px-4 py-3 font-semibold';
  return `
    <th class="${thClass}">
      <button type="button" data-sort-key="${key}" class="inline-flex items-center gap-1 text-slate-200 hover:text-cyan-200">
        ${escapeHtml(label)}<span class="w-2.5 text-[10px] text-cyan-300">${arrow}</span>
      </button>
    </th>
  `;
}

function renderTokenCardHtml(token) {
  const tokenVisual = getTokenVisual(token);
  return `
    <div class="min-w-[4.5rem] flex-1 basis-[4.5rem] rounded-md bg-slate-900/40 p-1.5 text-center">
      <div class="inline-flex items-center justify-center ${tokenVisual.stateClass}">${tokenVisual.display}</div>
      <div class="mt-1.5">${tokenVisual.buffsHtml}</div>
    </div>
  `;
}

function renderPlayerSummaryDetailRow(player) {
  const warsHtml = player.stats.wars.map((war) => {
    const skillRatingBadge = `<span class="text-violet-300">Skill rating: ${Number(war.skillRating || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>`;

    if (!war.player) {
      return `
        <div>
          <div class="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">${escapeHtml(war.label)}</div>
          <div class="rounded-md border border-dashed border-slate-700 bg-slate-900/40 p-3 text-xs text-slate-500">Did not play</div>
        </div>
      `;
    }

    const tokenCards = war.player.tokens.map(renderTokenCardHtml).join('');
    return `
      <div>
        <div class="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <span>${escapeHtml(war.label)}</span>
          ${skillRatingBadge}
        </div>
        <div class="flex flex-wrap gap-2">${tokenCards}</div>
      </div>
    `;
  }).join('');

  return `
    <tr class="border-t border-slate-800/60 bg-slate-950/40">
      <td colspan="10" class="px-4 py-3">
        <div class="flex flex-col gap-3">${warsHtml}</div>
      </td>
    </tr>
  `;
}

function renderPlayerSummaryBody() {
  renderPlayerSummaryAttackBody();
  renderPlayerSummaryDefenceBody();
}

function renderPlayerSummaryAttackBody() {
  const container = document.getElementById('player-summary-attack-body');
  if (!container) return;

  const season = playerSummarySeasons[selectedPlayerSummarySeasonIndex];

  if (!season) {
    container.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-6 text-center text-sm text-slate-400">
        No season data available.
      </div>
    `;
    return;
  }

  const players = getSeasonPlayerOptions(season).map(({ userId, name }) => {
    const stats = summarizePlayerSeason(season, userId);
    const avatarSource = stats.wars.find((war) => war.player)?.player || null;
    return {
      userId,
      name,
      avatarUnitId: avatarSource?.avatarUnitId || null,
      avatarFrameId: avatarSource?.avatarFrameId || null,
      stats
    };
  });

  const sortedPlayers = sortPlayerSummaryRows(players);

  const rowsHtml = sortedPlayers.map((player, index) => {
    const isExpanded = expandedPlayerSummaryUserIds.has(player.userId);
    const stats = player.stats;
    const avatarHtml = renderPlayerAvatar(player);
    const mainRow = `
      <tr class="transition-colors duration-150 hover:bg-cyan-400/10">
        <td class="sticky left-0 z-10 min-w-[15rem] whitespace-nowrap bg-slate-900/95 px-4 py-3 font-semibold text-slate-50">
          <button type="button" data-toggle-player="${escapeHtml(player.userId)}" class="flex w-full items-center gap-2 text-left hover:text-cyan-200">
            <span class="inline-block w-3 shrink-0 text-slate-400">${isExpanded ? '▾' : '▸'}</span>
            <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-400/20 text-xs font-bold text-cyan-100">${index + 1}</span>
            ${avatarHtml}
            <span class="truncate">${escapeHtml(player.name)}</span>
          </button>
        </td>
        <td class="px-4 py-3">${stats.totalTokens.toLocaleString()}</td>
        <td class="px-4 py-3">${stats.spent.toLocaleString()}</td>
        <td class="px-4 py-3">${stats.remaining.toLocaleString()}</td>
        <td class="px-4 py-3 text-cyan-200">${stats.avgPerToken.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
        <td class="px-4 py-3">${formatCountWithCleanup(stats.wins, stats.cleanupWins)}</td>
        <td class="px-4 py-3">${formatCountWithCleanup(stats.defeats, stats.cleanupDefeats)}</td>
        <td class="px-4 py-3">${stats.abandoned.toLocaleString()}</td>
        <td class="px-4 py-3 font-semibold text-amber-300">${stats.totalScore.toLocaleString()}</td>
        <td class="px-4 py-3 text-violet-300 font-semibold">${stats.avgSkillRating.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
      </tr>
    `;

    return mainRow + (isExpanded ? renderPlayerSummaryDetailRow(player) : '');
  }).join('');

  container.innerHTML = `
    <div class="w-full overflow-hidden rounded-xl border border-slate-800/80">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-left text-xs sm:text-sm" style="table-layout: auto;">
          <thead class="bg-slate-800/90 text-slate-200">
            <tr>
              ${renderPlayerSummarySortHeader('name', 'Player', { sticky: true })}
              ${renderPlayerSummarySortHeader('totalTokens', 'Total tokens')}
              ${renderPlayerSummarySortHeader('spent', 'Spent')}
              ${renderPlayerSummarySortHeader('remaining', 'Remaining')}
              ${renderPlayerSummarySortHeader('avgPerToken', 'Avg/token')}
              ${renderPlayerSummarySortHeader('wins', 'Wins')}
              ${renderPlayerSummarySortHeader('defeats', 'Defeats')}
              ${renderPlayerSummarySortHeader('abandoned', 'Abandoned')}
              ${renderPlayerSummarySortHeader('totalScore', 'Total score')}
              ${renderPlayerSummarySortHeader('avgSkillRating', 'Avg skill rating')}
            </tr>
          </thead>
          <tbody class="text-slate-100">${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-sort-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.sortKey;
      if (playerSummarySort.key === key) {
        playerSummarySort.direction = playerSummarySort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        playerSummarySort = { key, direction: key === 'name' ? 'asc' : 'desc' };
      }
      renderPlayerSummaryAttackBody();
    });
  });

  container.querySelectorAll('[data-toggle-player]').forEach((button) => {
    button.addEventListener('click', () => {
      const userId = button.dataset.togglePlayer;
      if (expandedPlayerSummaryUserIds.has(userId)) {
        expandedPlayerSummaryUserIds.delete(userId);
      } else {
        expandedPlayerSummaryUserIds.add(userId);
      }
      renderPlayerSummaryAttackBody();
    });
  });
}

function renderPlayerSummaryDefenceDetailRow(player) {
  const warsHtml = player.stats.wars.map((war) => `
    <div class="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-900/40 px-3 py-2 text-xs">
      <span class="font-semibold uppercase tracking-wide text-slate-400">${escapeHtml(war.label)}</span>
      <span class="text-slate-200">Defended: <span class="font-semibold">${war.timesDefended.toLocaleString()}</span></span>
      <span class="text-rose-200">Attacker lost: <span class="font-semibold">${war.attackerLost.toLocaleString()}</span></span>
      <span class="text-rose-200">Attacker lost %: <span class="font-semibold">${war.attackerLostPct.toLocaleString(undefined, { maximumFractionDigits: 1 })}%</span></span>
    </div>
  `).join('');

  return `
    <tr class="border-t border-slate-800/60 bg-slate-950/40">
      <td colspan="4" class="px-4 py-3">
        <div class="flex flex-col gap-2">${warsHtml}</div>
      </td>
    </tr>
  `;
}

function sortPlayerSummaryDefenseRows(rows) {
  const { key, direction } = playerSummaryDefenseSort;
  const dir = direction === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    if (key === 'name') {
      return dir * a.name.localeCompare(b.name);
    }
    return dir * (Number(a.stats[key] || 0) - Number(b.stats[key] || 0));
  });
}

function renderPlayerSummaryDefenseSortHeader(key, label, { sticky = false } = {}) {
  const isActive = playerSummaryDefenseSort.key === key;
  const arrow = isActive ? (playerSummaryDefenseSort.direction === 'asc' ? '▲' : '▼') : '';
  const thClass = sticky
    ? 'sticky left-0 top-0 z-20 min-w-[15rem] whitespace-nowrap bg-slate-800/95 px-4 py-3 font-semibold'
    : 'whitespace-nowrap px-4 py-3 font-semibold';
  return `
    <th class="${thClass}">
      <button type="button" data-defense-sort-key="${key}" class="inline-flex items-center gap-1 text-slate-200 hover:text-cyan-200">
        ${escapeHtml(label)}<span class="w-2.5 text-[10px] text-cyan-300">${arrow}</span>
      </button>
    </th>
  `;
}

function renderPlayerSummaryDefenceBody() {
  const container = document.getElementById('player-summary-defence-body');
  if (!container) return;

  const season = playerSummarySeasons[selectedPlayerSummarySeasonIndex];

  if (!season) {
    container.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-6 text-center text-sm text-slate-400">
        No season data available.
      </div>
    `;
    return;
  }

  const players = getSeasonPlayerOptions(season).map(({ userId, name }) => {
    const stats = summarizePlayerDefenseSeason(season, userId);
    const avatarSource = season.datasets
      .map((dataset) => dataset.snapshot.players.find((entry) => entry.userId === userId))
      .find(Boolean) || null;
    return {
      userId,
      name,
      avatarUnitId: avatarSource?.avatarUnitId || null,
      avatarFrameId: avatarSource?.avatarFrameId || null,
      stats
    };
  });

  const sortedPlayers = sortPlayerSummaryDefenseRows(players);

  const rowsHtml = sortedPlayers.map((player, index) => {
    const isExpanded = expandedDefensePlayerUserIds.has(player.userId);
    const stats = player.stats;
    const avatarHtml = renderPlayerAvatar(player);
    const mainRow = `
      <tr class="transition-colors duration-150 hover:bg-cyan-400/10">
        <td class="sticky left-0 z-10 min-w-[15rem] whitespace-nowrap bg-slate-900/95 px-4 py-3 font-semibold text-slate-50">
          <button type="button" data-toggle-defense-player="${escapeHtml(player.userId)}" class="flex w-full items-center gap-2 text-left hover:text-cyan-200">
            <span class="inline-block w-3 shrink-0 text-slate-400">${isExpanded ? '▾' : '▸'}</span>
            <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-400/20 text-xs font-bold text-cyan-100">${index + 1}</span>
            ${avatarHtml}
            <span class="truncate">${escapeHtml(player.name)}</span>
          </button>
        </td>
        <td class="px-4 py-3">${stats.timesDefended.toLocaleString()}</td>
        <td class="px-4 py-3 font-semibold text-rose-300">${stats.attackerLost.toLocaleString()}</td>
        <td class="px-4 py-3 text-rose-200">${stats.attackerLostPct.toLocaleString(undefined, { maximumFractionDigits: 1 })}%</td>
      </tr>
    `;

    return mainRow + (isExpanded ? renderPlayerSummaryDefenceDetailRow(player) : '');
  }).join('');

  container.innerHTML = `
    <div class="w-full overflow-hidden rounded-xl border border-slate-800/80">
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-left text-xs sm:text-sm" style="table-layout: auto;">
          <thead class="bg-slate-800/90 text-slate-200">
            <tr>
              ${renderPlayerSummaryDefenseSortHeader('name', 'Player', { sticky: true })}
              ${renderPlayerSummaryDefenseSortHeader('timesDefended', 'Times defended')}
              ${renderPlayerSummaryDefenseSortHeader('attackerLost', 'Attacker lost')}
              ${renderPlayerSummaryDefenseSortHeader('attackerLostPct', 'Attacker lost %')}
            </tr>
          </thead>
          <tbody class="text-slate-100">${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-defense-sort-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.defenseSortKey;
      if (playerSummaryDefenseSort.key === key) {
        playerSummaryDefenseSort.direction = playerSummaryDefenseSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        playerSummaryDefenseSort = { key, direction: key === 'name' ? 'asc' : 'desc' };
      }
      renderPlayerSummaryDefenceBody();
    });
  });

  container.querySelectorAll('[data-toggle-defense-player]').forEach((button) => {
    button.addEventListener('click', () => {
      const userId = button.dataset.toggleDefensePlayer;
      if (expandedDefensePlayerUserIds.has(userId)) {
        expandedDefensePlayerUserIds.delete(userId);
      } else {
        expandedDefensePlayerUserIds.add(userId);
      }
      renderPlayerSummaryDefenceBody();
    });
  });
}

async function initPlayerSummaryTab() {
  const attackContainer = document.getElementById('player-summary-attack-body');
  const defenceContainer = document.getElementById('player-summary-defence-body');
  const select = document.getElementById('player-summary-season-select');

  if (playerSummaryLoaded) {
    renderPlayerSummarySeasonSelect();
    renderPlayerSummaryBody();
    return;
  }

  if (select) select.innerHTML = '<option value="">Loading seasons...</option>';
  const loadingMessage = `
    <div class="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-6 text-center text-sm text-slate-400">
      Loading season data...
    </div>
  `;
  if (attackContainer) attackContainer.innerHTML = loadingMessage;
  if (defenceContainer) defenceContainer.innerHTML = loadingMessage;

  await loadPlayerSummaryData();
  renderPlayerSummarySeasonSelect();
  renderPlayerSummaryBody();
}

function renderActiveGuild() {
  const snapshot = guildSnapshots[activeGuildIndex];
  console.log({guildSnapshots, activeGuildIndex, snapshot});

  if (!snapshot) return;

  renderTable(snapshot);
  renderBuffLegend(snapshot);
  renderBattleLog(snapshot);
  renderTokenTiming(snapshot);
  renderGuildTabs();
}

function getTokenCountColorClass(count) {
  if (count >= 10) return 'text-emerald-400';
  if (count === 9) return 'text-lime-300';
  if (count >= 5) return 'text-yellow-300';
  return 'text-rose-400';
}

function formatDurationHours(ms) {
  const hours = ms / 3600000;
  if (hours < 1) return `${Math.round(ms / 60000)}m`;
  return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
}

let tokenTimingSort = { key: 'name', direction: 'asc' };

function renderTokenTiming(snapshot) {
  const container = document.getElementById('token-timing-chart');
  if (!container) return;

  // Shared axis across both guilds so Attack/Defence views line up.
  const allTimes = guildSnapshots
    .flatMap((guild) => guild?.battles || [])
    .map((battle) => battle.createdOn)
    .filter((time) => time > 0);
  if (!snapshot || allTimes.length === 0) {
    container.innerHTML = '<div class="rounded-lg border border-dashed border-slate-500/40 p-3 text-slate-400">No token activity for this war yet.</div>';
    return;
  }

  const minTime = Math.min(...allTimes);
  const maxTime = Math.max(...allTimes);
  const range = Math.max(maxTime - minTime, 1);
  const toPct = (time) => ((time - minTime) / range) * 100;

  const battlesByUser = new Map();
  (snapshot.battles || []).forEach((battle) => {
    if (!(battle.createdOn > 0)) return;
    if (!battlesByUser.has(battle.attackerUserId)) battlesByUser.set(battle.attackerUserId, []);
    battlesByUser.get(battle.attackerUserId).push(battle);
  });

  const compareName = (a, b) => String(a.player.name).localeCompare(String(b.player.name), undefined, { sensitivity: 'base' });
  const sortValue = { tokens: (row) => row.battles.length, span: (row) => row.span };
  const sortDirection = tokenTimingSort.direction === 'asc' ? 1 : -1;
  const rows = (snapshot.players || []).map((player) => {
    const battles = (battlesByUser.get(player.userId) || []).slice().sort((a, b) => a.createdOn - b.createdOn);
    const span = battles.length > 1 ? battles[battles.length - 1].createdOn - battles[0].createdOn : 0;
    return { player, battles, span };
  }).sort((a, b) => {
    const getValue = sortValue[tokenTimingSort.key];
    const primary = getValue ? getValue(a) - getValue(b) : compareName(a, b);
    return primary * sortDirection || compareName(a, b);
  });

  const tickStep = range > 3 * 86400000 ? 24 * 3600000 : 12 * 3600000;
  const firstTick = new Date(minTime);
  firstTick.setMinutes(0, 0, 0);
  firstTick.setHours(tickStep === 24 * 3600000 ? 24 : (firstTick.getHours() < 12 ? 12 : 24));
  const ticks = [];
  for (let tick = firstTick.getTime(); tick < maxTime; tick += tickStep) ticks.push(tick);
  const tickFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const gridLines = ticks.map((tick) => `<div class="pointer-events-none absolute inset-y-0 border-l border-slate-700/50" style="left:${toPct(tick)}%"></div>`).join('');
  const axisLabels = ticks.map((tick) => `<span class="absolute -translate-x-1/2 whitespace-nowrap text-[10px] text-slate-500" style="left:${toPct(tick)}%">${escapeHtml(tickFormat.format(tick))}</span>`).join('');

  const dotClass = (battle) => {
    const fill = { abandoned: 'bg-slate-500', defeat: 'bg-rose-500', win: 'bg-emerald-500' }[getTokenLegendOutcomeKey(battle)];
    return `${fill} border-slate-900`;
  };

  const rowHtml = rows.map(({ player, battles, span }) => {
    const points = battles.map((battle) => `${toPct(battle.createdOn)},50`).join(' ');
    const line = battles.length > 1
      ? `<svg class="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="#64748b" stroke-width="1.5" stroke-opacity="0.8" vector-effect="non-scaling-stroke" /></svg>`
      : '';
    const dots = battles.map((battle, index) => {
      const label = `Token ${index + 1}: ${formatDateTime(battle.createdOn) || ''} - ${battle.abandoned ? 'Abandoned' : `${Math.round(battle.score).toLocaleString()} pts${battle.defended ? ' (lost)' : ''}`} vs ${battle.defenderName}`;
      return `<span class="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${dotClass(battle)}" style="left:${toPct(battle.createdOn)}%" title="${escapeHtml(label)}"></span>`;
    }).join('');

    return `
      <div class="flex items-center border-b border-slate-800/80 last:border-b-0">
        <div class="flex w-72 shrink-0 items-center gap-2 py-1.5 pr-3">
          <span class="min-w-0 flex-1 truncate text-sm text-slate-200" title="${escapeHtml(player.name)}">${escapeHtml(player.name)}</span>
          <span class="w-16 shrink-0 text-right text-xs font-bold tabular-nums ${getTokenCountColorClass(battles.length)}">${battles.length}</span>
          <span class="w-20 shrink-0 text-right text-xs tabular-nums text-slate-400">${battles.length > 1 ? formatDurationHours(span) : '-'}</span>
        </div>
        <div class="relative h-8 flex-1">${gridLines}${line}${dots}</div>
      </div>`;
  }).join('');

  const sortHeader = (key, label, widthClass) => {
    const isActive = tokenTimingSort.key === key;
    const arrow = isActive ? (tokenTimingSort.direction === 'asc' ? '▲' : '▼') : '';
    return `<button type="button" data-timing-sort-key="${key}" class="${widthClass} inline-flex items-center gap-1 font-semibold uppercase tracking-wide ${key === 'name' ? 'justify-start' : 'justify-end'} ${isActive ? 'text-cyan-200' : 'text-slate-400'} hover:text-cyan-200">${label}<span class="text-[10px]">${arrow}</span></button>`;
  };

  container.innerHTML = `
    <div class="min-w-[720px]">
      <div class="mb-2 flex flex-wrap gap-4 text-xs text-slate-400">
        <span class="inline-flex items-center gap-1.5"><span class="h-3.5 w-3.5 rounded-full border-2 border-slate-900 bg-emerald-500"></span>Win</span>
        <span class="inline-flex items-center gap-1.5"><span class="h-3.5 w-3.5 rounded-full border-2 border-slate-900 bg-rose-500"></span>Lost</span>
        <span class="inline-flex items-center gap-1.5"><span class="h-3.5 w-3.5 rounded-full border-2 border-slate-900 bg-slate-500"></span>Abandoned</span>
      </div>
      <div class="flex items-end border-b border-slate-700 pb-1">
        <div class="flex w-72 shrink-0 gap-2 pr-3 text-xs">${sortHeader('name', 'Player', 'flex-1')}${sortHeader('tokens', 'Tokens', 'w-16')}${sortHeader('span', 'Timespan', 'w-20')}</div>
        <div class="relative h-4 flex-1">${axisLabels}</div>
      </div>
      ${rowHtml}
    </div>`;

  container.querySelectorAll('[data-timing-sort-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.timingSortKey;
      tokenTimingSort = tokenTimingSort.key === key
        ? { key, direction: tokenTimingSort.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'name' ? 'asc' : 'desc' };
      renderTokenTiming(snapshot);
    });
  });
}

function isMobileLeaderboardLayout() {
  return window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
}

function syncLeaderboardLayoutButtons() {
  const tableBtn = document.getElementById('leaderboard-layout-table');
  const cardsBtn = document.getElementById('leaderboard-layout-cards');
  if (!tableBtn || !cardsBtn) return;

  const makeActive = (button) => {
    button.classList.add('border-cyan-400', 'bg-cyan-500/15', 'text-cyan-200');
    button.classList.remove('border-slate-500/50', 'bg-slate-900/80', 'text-slate-300');
  };
  const makeInactive = (button) => {
    button.classList.remove('border-cyan-400', 'bg-cyan-500/15', 'text-cyan-200');
    button.classList.add('border-slate-500/50', 'bg-slate-900/80', 'text-slate-300');
  };

  if (leaderboardLayout === 'cards') {
    makeActive(cardsBtn);
    makeInactive(tableBtn);
  } else {
    makeActive(tableBtn);
    makeInactive(cardsBtn);
  }
}

function applyLeaderboardLayout() {
  const tableWrap = document.getElementById('leaderboard-table-wrap');
  const cardsWrap = document.getElementById('leaderboard-cards');
  const layoutControls = document.getElementById('leaderboard-layout-controls');
  if (!tableWrap || !cardsWrap) return;

  const mobile = isMobileLeaderboardLayout();
  if (mobile) {
    leaderboardLayout = 'cards';
  } else if (!leaderboardLayout) {
    leaderboardLayout = 'table';
  }

  const useCards = leaderboardLayout === 'cards';
  tableWrap.classList.toggle('hidden', useCards);
  cardsWrap.classList.toggle('hidden', !useCards);

  if (layoutControls) {
    layoutControls.style.display = mobile ? 'none' : 'flex';
  }

  syncLeaderboardLayoutButtons();
}

function setupLeaderboardLayoutToggle() {
  if (leaderboardLayoutInitialized) return;

  const tableBtn = document.getElementById('leaderboard-layout-table');
  const cardsBtn = document.getElementById('leaderboard-layout-cards');
  if (!tableBtn || !cardsBtn) return;

  tableBtn.addEventListener('click', () => {
    leaderboardLayout = 'table';
    applyLeaderboardLayout();
  });

  cardsBtn.addEventListener('click', () => {
    leaderboardLayout = 'cards';
    applyLeaderboardLayout();
  });

  const mediaQuery = window.matchMedia('(max-width: 767px)');
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', applyLeaderboardLayout);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(applyLeaderboardLayout);
  }

  leaderboardLayoutInitialized = true;
  applyLeaderboardLayout();
}

function getBattleUnitLabel(unit) {
  if (!unit || typeof unit !== 'object') return 'Unknown unit';

  const raw = unit.displayName
    || unit.name
    || unit.unitTypeId
    || unit.baseCharacterId
    || unit.unitId
    || unit.characterId
    || unit.id;

  if (!raw) return 'Unknown unit';
  return String(raw).replace(/_/g, ' ');
}

function getBattleUnitId(unit) {
  if (!unit || typeof unit !== 'object') return null;

  const rawId = unit.avatarUnitId
    || unit.unitTypeId
    || unit.baseCharacterId
    || unit.unitId
    || unit.characterId
    || unit.id;

  if (!rawId) return null;
  return String(rawId).trim();
}

function isEasyGameBattle(battle) {
  if (!battle || typeof battle !== 'object') return false;

  const attackerUnits = Array.isArray(battle?.attackerUnits)
    ? battle.attackerUnits
    : (Array.isArray(battle?.attacker?.units) ? battle.attacker.units : []);
  const defenderUnits = Array.isArray(battle?.defenderUnits)
    ? battle.defenderUnits
    : (Array.isArray(battle?.defender?.units) ? battle.defender.units : []);

  const attackerMachineOfWar = battle?.attackerMachineOfWar || battle?.attacker?.machineOfWar || null;
  const defenderMachineOfWar = battle?.defenderMachineOfWar || battle?.defender?.machineOfWar || null;

  const sideCandidates = [
    buildBattleSideUnits(attackerUnits, attackerMachineOfWar),
    buildBattleSideUnits(defenderUnits, defenderMachineOfWar)
  ];

  return sideCandidates.some((units) => Array.isArray(units) && units.some((unit) => getBattleUnitId(unit) === 'templNpc1Initiate'));
}

function getEasyGameBadgeHtml({ easyGame = false, tileScore = 0, includeBuildingIcon = false } = {}) {
  if (!easyGame) return '';

  const buildingIcon = Number(tileScore || 0) > 0 || includeBuildingIcon
    ? '<span class="inline-flex h-3.5 w-3.5 items-center justify-center text-[10px] leading-none" title="Tile score win" aria-label="Tile score win">🏢</span>'
    : '';

  return `<span class="inline-flex items-center gap-1" title="Easy game" aria-label="Easy game">` +
    '<span class="inline-flex h-2.5 w-2.5 shrink-0 rounded-full border border-red-500 bg-black"></span>' +
    `${buildingIcon}` +
    '</span>';
}

function getBattleUnitAvatarUrl(unit) {
  if (!unit || typeof unit !== 'object') return null;

  const exactUnitId = getBattleUnitId(unit);
  return getBattleUnitAvatarUrlFromUnitId(exactUnitId);
}

function getBattleUnitAvatarUrlFromUnitId(unitId) {
  const exactUnitId = String(unitId || '').trim();
  if (!exactUnitId) return null;

  const mappedImage = getPortraitImageForUnitIdFromMap(exactUnitId, portraitMap);
  if (isUnknownPortraitTarget(mappedImage)) {
    return MISSING_UNIT_AVATAR_URL;
  }

  const normalizedImage = sanitizeFilename(mappedImage);
  if (portraitSourceImageManifestSet.has(normalizedImage)) {
    return `./img-temp/${normalizedImage}`;
  }

  return `./img/${normalizedImage}`;
}

function getUnitIdPrefix(unitId) {
  const id = String(unitId || '').trim();
  if (!id) return 'unknown';
  const match = id.match(/^[a-z]+/);
  return match && match[0] ? match[0] : 'unknown';
}

function sanitizeFilename(name) {
  return String(name || '').trim();
}

function isUnknownPortraitTarget(value) {
  const normalized = sanitizeFilename(value).toLowerCase();
  return !normalized || normalized === 'unknown' || normalized === 'null';
}

function getPortraitImageForUnitIdFromMap(unitId, mapObj) {
  const normalizedUnitId = sanitizeFilename(unitId);
  if (!normalizedUnitId || !mapObj || typeof mapObj !== 'object') return '';

  if (Object.prototype.hasOwnProperty.call(mapObj, normalizedUnitId)) {
    return sanitizeFilename(mapObj[normalizedUnitId]);
  }

  const normalizedLower = normalizedUnitId.toLowerCase();
  const matchKey = Object.keys(mapObj).find((key) => key.toLowerCase() === normalizedLower);
  return matchKey ? sanitizeFilename(mapObj[matchKey]) : '';
}

function setPortraitImageForUnitIdOnMap(unitId, imageName, mapObj) {
  const normalizedUnitId = sanitizeFilename(unitId);
  const normalizedImage = sanitizeFilename(imageName);
  if (!normalizedUnitId || !mapObj || typeof mapObj !== 'object') return;

  if (Object.prototype.hasOwnProperty.call(mapObj, normalizedUnitId)) {
    mapObj[normalizedUnitId] = normalizedImage;
    return;
  }

  const normalizedLower = normalizedUnitId.toLowerCase();
  const matchKey = Object.keys(mapObj).find((key) => key.toLowerCase() === normalizedLower);
  if (matchKey) {
    mapObj[matchKey] = normalizedImage;
    return;
  }

  mapObj[normalizedUnitId] = normalizedImage;
}

function getAssignedUnitIdForImageFromMap(imageName, mapObj) {
  const normalizedImage = sanitizeFilename(imageName);
  if (!normalizedImage || !mapObj || typeof mapObj !== 'object') return '';

  const entries = Object.entries(mapObj);
  for (let i = 0; i < entries.length; i += 1) {
    const [unitId, mappedImage] = entries[i];
    if (sanitizeFilename(mappedImage) === normalizedImage) {
      return sanitizeFilename(unitId);
    }
  }

  return '';
}

function getUnitIdsFromLoadedSnapshots() {
  const ids = new Set();

  (guildSnapshots || []).forEach((snapshot) => {
    const battles = Array.isArray(snapshot?.battles) ? snapshot.battles : [];

    battles.forEach((battle) => {
      ['attacker', 'defender'].forEach((side) => {
        const sideUnits = side === 'attacker'
          ? buildBattleSideUnits(battle?.attackerUnits, battle?.attackerMachineOfWar)
          : buildBattleSideUnits(battle?.defenderUnits, battle?.defenderMachineOfWar);

        sideUnits.forEach((unit) => {
          const unitId = getBattleUnitId(unit);
          if (unitId) ids.add(unitId);
        });
      });
    });
  });

  return ids;
}

function getAllKnownUnitIds() {
  const fromPortraitMap = Object.keys(portraitMap || {});
  const fromMissingMap = Object.keys(missingPortraitMap || {});
  const fromStagedMap = Object.keys(portraitMapStaged || {});
  const fromLoadedSnapshots = Array.from(getUnitIdsFromLoadedSnapshots());
  return Array.from(new Set([
    ...fromPortraitMap,
    ...fromMissingMap,
    ...fromStagedMap,
    ...fromLoadedSnapshots
  ])).sort((a, b) => a.localeCompare(b));
}

function isPortraitImageFileName(value) {
  return /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(String(value || '').trim());
}

function getAllKnownSourceImageNames() {
  const merged = new Set([
    ...(portraitSourceImageManifest || []),
    ...Object.values(portraitMap || {}),
    ...Object.values(portraitMapStaged || {})
  ].map((name) => sanitizeFilename(name)).filter((name) => name && isPortraitImageFileName(name) && name.startsWith('ui_image_portrait')));

  return Array.from(merged).sort((a, b) => a.localeCompare(b));
}

function ensureManifestImagesInStagedMap() {
  // Source images are tracked in manifest; staged map stores characterId -> image.
}

function getUnassignedImages() {
  const assignedImages = new Set(
    Object.values(portraitMapStaged || {})
      .map((value) => sanitizeFilename(value))
      .filter((value) => value && !isUnknownPortraitTarget(value))
  );

  return getAllKnownSourceImageNames()
    .filter((name) => !assignedImages.has(name))
    .sort((a, b) => a.localeCompare(b));
}

function setActiveMapDropTarget(target) {
  if (activeMapDropTarget === target) return;

  if (activeMapDropTarget) {
    activeMapDropTarget.classList.remove('ring-2', 'ring-cyan-300/70');
  }

  activeMapDropTarget = target || null;

  if (activeMapDropTarget) {
    activeMapDropTarget.classList.add('ring-2', 'ring-cyan-300/70');
  }
}

function getAssignedSourceImageForUnitIdFromMap(unitId, mapObj) {
  const mappedImage = getPortraitImageForUnitIdFromMap(unitId, mapObj);
  return isUnknownPortraitTarget(mappedImage) ? '' : mappedImage;
}

function getAssignedSourceImageForUnitId(unitId) {
  return getAssignedSourceImageForUnitIdFromMap(unitId, portraitMapStaged);
}

function assignImageToUnitId(unitId, imageName) {
  const normalizedUnitId = sanitizeFilename(unitId);
  const normalizedImage = sanitizeFilename(imageName);
  if (!normalizedUnitId || !normalizedImage) return;

  const currentlyAssignedUnitId = getAssignedUnitIdForImageFromMap(normalizedImage, portraitMapStaged);
  if (currentlyAssignedUnitId && currentlyAssignedUnitId !== normalizedUnitId) {
    setPortraitImageForUnitIdOnMap(currentlyAssignedUnitId, 'unknown', portraitMapStaged);
  }

  setPortraitImageForUnitIdOnMap(normalizedUnitId, normalizedImage, portraitMapStaged);
}

function clearUnitIdAssignment(unitId) {
  const normalizedUnitId = sanitizeFilename(unitId);
  if (!normalizedUnitId) return;

  if (!Object.keys(portraitMapStaged || {}).some((key) => key.toLowerCase() === normalizedUnitId.toLowerCase())) {
    return;
  }

  setPortraitImageForUnitIdOnMap(normalizedUnitId, 'unknown', portraitMapStaged);
}

function getMappingChangeCount() {
  const allUnitIds = Array.from(new Set([
    ...Object.keys(portraitMap || {}),
    ...Object.keys(portraitMapStaged || {})
  ])).sort((a, b) => a.localeCompare(b));

  return allUnitIds.reduce((count, unitId) => {
    const base = sanitizeFilename(getPortraitImageForUnitIdFromMap(unitId, portraitMap) || 'unknown');
    const staged = sanitizeFilename(getPortraitImageForUnitIdFromMap(unitId, portraitMapStaged) || 'unknown');
    return count + (base !== staged ? 1 : 0);
  }, 0);
}

function getGroupedUnitIds(searchText = '') {
  const needle = String(searchText || '').trim().toLowerCase();
  const grouped = new Map();

  getAllKnownUnitIds().forEach((unitId) => {
    if (needle && !unitId.toLowerCase().includes(needle)) return;
    const prefix = getUnitIdPrefix(unitId);
    if (!grouped.has(prefix)) grouped.set(prefix, []);
    grouped.get(prefix).push(unitId);
  });

  return Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([prefix, ids]) => ({
      prefix,
      ids: ids.sort((a, b) => a.localeCompare(b))
    }));
}

function setMappingWarning() {
  const warningEl = document.getElementById('mapping-warning');
  if (!warningEl) return;

  const overlaps = Object.keys(missingPortraitMap || {}).filter((unitId) => {
    const mappedImage = getPortraitImageForUnitIdFromMap(unitId, portraitMap);
    return Boolean(mappedImage && !isUnknownPortraitTarget(mappedImage));
  });

  if (overlaps.length === 0) {
    warningEl.classList.add('hidden');
    warningEl.textContent = '';
    return;
  }

  warningEl.classList.remove('hidden');
  warningEl.textContent = `Found ${overlaps.length} IDs in both maps. Assigned portrait map value used as baseline.`;
}

function renderMappingUnassignedList() {
  const listEl = document.getElementById('mapping-unassigned-list');
  const countEl = document.getElementById('mapping-unassigned-count');
  if (!listEl || !countEl) return;

  const imagePool = getUnassignedImages();
  countEl.textContent = `${imagePool.length} images`;

  if (imagePool.length === 0) {
    listEl.innerHTML = '<div class="col-span-full rounded-lg border border-dashed border-emerald-400/35 bg-emerald-500/10 p-3 text-xs text-emerald-200">All source images already assigned in portrait-map.</div>';
    return;
  }

  listEl.innerHTML = `${imagePool.map((fileName) => {
    const isSelected = selectedUnassignedImage === fileName;
    const primarySrc = `./img-temp/${fileName}`;
    const fallbackSrc = `./img/${fileName}`;
    return `
      <button
        type="button"
        class="group rounded-lg border p-2 text-left transition ${isSelected ? 'border-cyan-300 bg-cyan-500/15' : 'border-slate-600/70 bg-slate-900/70 hover:border-cyan-400/60'}"
        data-map-unassigned="${escapeHtml(fileName)}"
        draggable="true"
        title="${escapeHtml(fileName)}"
      >
        <img class="h-20 w-20 rounded object-cover" src="${escapeHtml(primarySrc)}" alt="${escapeHtml(fileName)}" loading="lazy" onerror="if(!this.dataset.fallbackTried){this.dataset.fallbackTried='1'; this.src='${escapeHtml(fallbackSrc)}'; return;} this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}';" />
        <div class="mt-1 truncate text-[11px] text-slate-300">${escapeHtml(fileName)}</div>
      </button>
    `;
  }).join('')}`;

}

function renderMappingGroups() {
  const groupsEl = document.getElementById('mapping-groups');
  const idCountEl = document.getElementById('mapping-id-count');
  const searchEl = document.getElementById('mapping-search');
  if (!groupsEl || !idCountEl) return;

  const groups = getGroupedUnitIds(searchEl ? searchEl.value : '');
  const totalIds = groups.reduce((sum, group) => sum + group.ids.length, 0);
  idCountEl.textContent = `${totalIds} ids`;

  if (groups.length === 0) {
    groupsEl.innerHTML = '<div class="rounded-lg border border-dashed border-slate-500/50 p-3 text-xs text-slate-400">No IDs match search.</div>';
    return;
  }

  groupsEl.innerHTML = groups.map((group) => {
    const cards = group.ids.map((unitId) => {
      const assignedSourceImage = getAssignedSourceImageForUnitId(unitId);
      const baseAssignedSourceImage = getAssignedSourceImageForUnitIdFromMap(unitId, portraitMap);
      const currentPortraitFile = baseAssignedSourceImage;
      // Show staged assignment first so drag/drop updates are immediately visible.
      const previewFile = assignedSourceImage || currentPortraitFile;
      const previewPrimarySrc = previewFile ? `./img-temp/${previewFile}` : MISSING_UNIT_AVATAR_URL;
      const previewFallbackSrc = previewFile ? `./img/${previewFile}` : '';
      const previewOnError = previewFile
        ? `if(!this.dataset.fallbackTried){this.dataset.fallbackTried='1'; this.src='${escapeHtml(previewFallbackSrc)}'; return;} this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}';`
        : `this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}';`;
      const isAssigned = Boolean(assignedSourceImage);
      const isChanged = baseAssignedSourceImage !== assignedSourceImage;

      return `
        <article
          class="rounded-lg border p-2 ${isAssigned ? 'border-emerald-400/30 bg-emerald-500/5' : 'border-dashed border-slate-500/70 bg-slate-900/65'} ${isChanged ? 'ring-1 ring-cyan-400/60' : ''}"
          data-map-target="${escapeHtml(unitId)}"
          draggable="${isAssigned ? 'true' : 'false'}"
        >
          <div class="mb-2 flex items-center justify-between gap-2">
            <div class="truncate text-xs font-semibold text-slate-200">${escapeHtml(unitId)}</div>
            ${isAssigned ? '<button type="button" class="rounded border border-slate-500/60 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-rose-400/60 hover:text-rose-200" data-map-clear="' + escapeHtml(unitId) + '">clear</button>' : ''}
          </div>
          <div class="rounded-md ${isAssigned ? 'border border-slate-600/70' : 'border border-dashed border-slate-500/80'} p-1">
            <img
              class="h-20 w-20 rounded object-cover ${isAssigned ? '' : 'opacity-60'}"
              src="${escapeHtml(previewPrimarySrc)}"
              alt="${escapeHtml(unitId)}"
              loading="lazy"
              onerror="${previewOnError}"
            />
          </div>
          <div class="mt-1 truncate text-[11px] ${isAssigned ? 'text-emerald-200' : 'text-slate-400'}">${isAssigned ? escapeHtml(assignedSourceImage) : 'Drop source image here'}</div>
          <div class="mt-0.5 truncate text-[10px] text-slate-500">${currentPortraitFile ? 'current img: ' + escapeHtml(currentPortraitFile) : 'no current img portrait'}</div>
          <div class="mt-0.5 truncate text-[10px] text-slate-500">${baseAssignedSourceImage ? 'baseline source: ' + escapeHtml(baseAssignedSourceImage) : 'baseline source: none'}</div>
          <div class="mt-0.5 truncate text-[10px] ${isChanged ? 'text-cyan-300' : 'text-slate-600'}">
            ${isChanged ? 'staged changed' : 'staged same as baseline'}
          </div>
        </article>
      `;
    }).join('');

    return `
      <section class="rounded-xl border border-slate-700/70 bg-slate-900/45 p-3">
        <div class="mb-2 text-xs font-bold uppercase tracking-wide text-cyan-300">${escapeHtml(group.prefix)} (${group.ids.length})</div>
        <div class="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-4">${cards}</div>
      </section>
    `;
  }).join('');

}

function buildPortraitMapExportDiff() {
  const updates = {};
  const allUnitIds = Array.from(new Set([
    ...Object.keys(portraitMap || {}),
    ...Object.keys(portraitMapStaged || {})
  ])).sort((a, b) => a.localeCompare(b));

  allUnitIds.forEach((unitId) => {
    const base = sanitizeFilename(getPortraitImageForUnitIdFromMap(unitId, portraitMap) || 'unknown');
    const staged = sanitizeFilename(getPortraitImageForUnitIdFromMap(unitId, portraitMapStaged) || 'unknown');
    if (base !== staged) {
      updates[unitId] = staged || 'unknown';
    }
  });

  return updates;
}

function buildMissingMapExportOptionA() {
  const result = { ...(missingPortraitMap || {}) };
  const mappedUnitIds = new Set(
    Object.keys(portraitMapStaged || {})
      .filter((unitId) => !isUnknownPortraitTarget(getPortraitImageForUnitIdFromMap(unitId, portraitMapStaged)))
      .map((unitId) => sanitizeFilename(unitId).toLowerCase())
      .filter(Boolean)
  );

  Object.keys(result).forEach((unitId) => {
    const normalizedUnitId = sanitizeFilename(unitId).toLowerCase();
    if (normalizedUnitId && mappedUnitIds.has(normalizedUnitId)) {
      delete result[unitId];
    }
  });
  return result;
}

function renderPortraitMapperExports() {
  const portraitOut = document.getElementById('mapping-export-portrait');
  const missingOut = document.getElementById('mapping-export-missing');
  if (!portraitOut || !missingOut) return;

  portraitOut.value = JSON.stringify(buildPortraitMapExportDiff(), null, 2);
  missingOut.value = JSON.stringify(buildMissingMapExportOptionA(), null, 2);
}

function renderPortraitMapper() {
  const changeCountEl = document.getElementById('mapping-change-count');
  if (changeCountEl) {
    changeCountEl.textContent = `${getMappingChangeCount()} changed`;
  }

  setMappingWarning();
  renderMappingUnassignedList();
  renderMappingGroups();
}

function resetPortraitMapperStaged() {
  portraitMapStaged = { ...(portraitMap || {}) };
  ensureManifestImagesInStagedMap();
  selectedUnassignedImage = '';
  dragState = null;
  setActiveMapDropTarget(null);
  renderPortraitMapper();
  renderPortraitMapperExports();
}

function setupPortraitMapperEvents() {
  if (portraitMapperInitialized) return;

  const searchEl = document.getElementById('mapping-search');
  const resetButton = document.getElementById('mapping-reset');
  const exportButton = document.getElementById('mapping-export');
  const unassignDrop = document.getElementById('mapping-unassigned-drop');
  const groupsEl = document.getElementById('mapping-groups');
  const unassignedListEl = document.getElementById('mapping-unassigned-list');

  if (!searchEl || !resetButton || !exportButton || !unassignDrop || !groupsEl || !unassignedListEl) return;

  searchEl.addEventListener('input', () => {
    renderMappingGroups();
  });

  resetButton.addEventListener('click', () => {
    resetPortraitMapperStaged();
  });

  exportButton.addEventListener('click', () => {
    renderPortraitMapperExports();
  });

  unassignDrop.addEventListener('dragover', (event) => {
    event.preventDefault();
    unassignDrop.classList.add('border-rose-400/80', 'text-rose-200');
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  });

  unassignDrop.addEventListener('dragleave', () => {
    unassignDrop.classList.remove('border-rose-400/80', 'text-rose-200');
  });

  unassignDrop.addEventListener('drop', (event) => {
    event.preventDefault();
    unassignDrop.classList.remove('border-rose-400/80', 'text-rose-200');
    const dataUnitId = event.dataTransfer ? event.dataTransfer.getData('text/unit-id') : '';
    const unitId = sanitizeFilename(dataUnitId || (dragState && dragState.unitId) || '');
    if (!unitId) return;
    clearUnitIdAssignment(unitId);
    dragState = null;
    setActiveMapDropTarget(null);
    renderPortraitMapper();
  });

  unassignedListEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-map-unassigned]');
    if (!button) return;
    selectedUnassignedImage = button.getAttribute('data-map-unassigned') || '';
    renderPortraitMapper();
  });

  unassignedListEl.addEventListener('dragstart', (event) => {
    const button = event.target.closest('[data-map-unassigned]');
    if (!button) return;
    const imageName = button.getAttribute('data-map-unassigned') || '';
    dragState = { kind: 'image', imageName };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', imageName);
    }
  });

  groupsEl.addEventListener('click', (event) => {
    const clearButton = event.target.closest('[data-map-clear]');
    if (clearButton) {
      event.stopPropagation();
      const unitId = clearButton.getAttribute('data-map-clear') || '';
      if (!unitId) return;
      clearUnitIdAssignment(unitId);
      renderPortraitMapper();
      return;
    }

    const targetCard = event.target.closest('[data-map-target]');
    if (!targetCard || !selectedUnassignedImage) return;

    const unitId = targetCard.getAttribute('data-map-target') || '';
    if (!unitId) return;

    assignImageToUnitId(unitId, selectedUnassignedImage);
    selectedUnassignedImage = '';
    renderPortraitMapper();
  });

  groupsEl.addEventListener('dragstart', (event) => {
    const targetCard = event.target.closest('[data-map-target]');
    if (!targetCard) return;

    const unitId = targetCard.getAttribute('data-map-target') || '';
    const assigned = getAssignedSourceImageForUnitId(unitId);
    if (!assigned) return;

    dragState = { kind: 'assigned-card', unitId };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/unit-id', unitId);
    }
  });

  groupsEl.addEventListener('dragover', (event) => {
    const targetCard = event.target.closest('[data-map-target]');
    if (!targetCard) {
      setActiveMapDropTarget(null);
      return;
    }

    event.preventDefault();
    setActiveMapDropTarget(targetCard);
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  });

  groupsEl.addEventListener('drop', (event) => {
    const targetCard = event.target.closest('[data-map-target]');
    if (!targetCard) return;

    event.preventDefault();
    setActiveMapDropTarget(null);

    const unitId = targetCard.getAttribute('data-map-target') || '';
    const dataImage = event.dataTransfer ? event.dataTransfer.getData('text/plain') : '';
    const imageName = sanitizeFilename(dataImage || (dragState && dragState.imageName) || '');
    if (!imageName || !unitId) return;

    assignImageToUnitId(unitId, imageName);
    selectedUnassignedImage = '';
    dragState = null;
    renderPortraitMapper();
  });

  groupsEl.addEventListener('dragleave', (event) => {
    const related = event.relatedTarget;
    if (related && groupsEl.contains(related)) return;
    setActiveMapDropTarget(null);
  });

  groupsEl.addEventListener('dragend', () => {
    setActiveMapDropTarget(null);
  });

  portraitMapperInitialized = true;
}

async function loadMissingPortraitMap() {
  try {
    const response = await fetch('./data/static/unitid-missing-portrait-map.json', { cache: 'no-store' });
    if (!response.ok) {
      missingPortraitMap = {};
      return;
    }
    const json = await response.json();
    missingPortraitMap = json && typeof json === 'object' ? json : {};
  } catch (error) {
    missingPortraitMap = {};
  }
}

async function loadPortraitMap() {
  try {
    const response = await fetch('./data/static/portrait-map.json', { cache: 'no-store' });
    if (!response.ok) {
      portraitMap = {};
      return;
    }
    const json = await response.json();
    portraitMap = json && typeof json === 'object' ? json : {};
  } catch (error) {
    portraitMap = {};
  }
}

async function loadPortraitImageManifest() {
  try {
    const response = await fetch('./data/static/image-manifest.json', { cache: 'no-store' });
    if (!response.ok) {
      portraitSourceImageManifest = [];
      portraitSourceImageManifestSet = new Set();
      return;
    }

    const json = await response.json();
    if (!Array.isArray(json)) {
      portraitSourceImageManifest = [];
      return;
    }

    portraitSourceImageManifest = json
      .map((name) => sanitizeFilename(name))
      .filter((name) => name && isPortraitImageFileName(name) && name.startsWith('ui_image_portrait'));
    portraitSourceImageManifestSet = new Set(portraitSourceImageManifest);
  } catch (error) {
    portraitSourceImageManifest = [];
    portraitSourceImageManifestSet = new Set();
  }
}

async function initializePortraitMapper() {
  await loadPortraitMap();
  await loadMissingPortraitMap();
  await loadPortraitImageManifest();
  setupPortraitMapperEvents();
  resetPortraitMapperStaged();
}

function renderBattleUnits(units, side = 'attacker') {
  if (!Array.isArray(units) || units.length === 0) {
    return '<span class="inline-flex rounded-full border border-slate-500/40 bg-slate-900/70 px-2 py-1 text-xs text-slate-400">No units captured</span>';
  }

  const selectedUnitIds = side === 'defender'
    ? battleLogFilters.defenderUnitIds
    : battleLogFilters.attackerUnitIds;
  const selectedSet = new Set(selectedUnitIds || []);
  const hasActiveSideFilter = selectedSet.size > 0;

  return units
    .map((unit) => {
      const unitLabel = getBattleUnitLabel(unit);
      const unitId = getBattleUnitId(unit);
      const avatarUrl = getBattleUnitAvatarUrl(unit);
      const safeAvatarUrl = avatarUrl || MISSING_UNIT_AVATAR_URL;
      const isMatched = unitId && selectedSet.has(unitId);
      const sideMatchClass = isMatched
        ? (side === 'defender' ? ' border-pink-400 outline outline-2 outline-pink-400/60 outline-offset-2' : ' border-sky-400 outline outline-2 outline-sky-400/60 outline-offset-2')
        : '';
      const sideMutedClass = hasActiveSideFilter && !isMatched ? ' opacity-50 grayscale saturate-75' : '';
      const startHp = Number(unit?.startHPBefore);
      const remainingBeforeHp = Number(unit?.remainingHPBefore);
      const hasHealthData = side === 'defender' && Number.isFinite(startHp) && startHp > 0;
      const currentHp = hasHealthData
        ? (Number.isFinite(remainingBeforeHp) && remainingBeforeHp >= 0 ? Math.min(remainingBeforeHp, startHp) : startHp)
        : 0;
      const percent = hasHealthData
        ? Math.max(0, Math.min(100, Math.round((currentHp / startHp) * 100)))
        : 0;
      const healthColor = hasHealthData ? getHealthBarColor(percent) : '';
      const healthBarHtml = hasHealthData
        ? `<span class="h-1.5 w-9 overflow-hidden rounded-full border border-slate-400/35 bg-slate-600/60" title="${escapeHtml(unitLabel)} start HP: ${Math.round(currentHp).toLocaleString()} / ${Math.round(startHp).toLocaleString()}"><span class="block h-full" style="width:${percent}%; background:${healthColor}"></span></span>`
        : '';

      return `<span class="inline-flex flex-col items-center gap-0.5"><span class="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-slate-400/25 bg-slate-900/85 text-xs text-slate-300${sideMatchClass}${sideMutedClass}" title="${escapeHtml(unitLabel)}"><img class="h-full w-full object-cover" src="${escapeHtml(safeAvatarUrl)}" alt="${escapeHtml(unitLabel)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}';"></span>${healthBarHtml}</span>`;
    })
    .join('');
}

function buildBattleSideUnits(units, machineOfWar) {
  const sideUnits = Array.isArray(units) ? [...units] : [];

  if (machineOfWar && typeof machineOfWar === 'object') {
    const machineLabel = getBattleUnitLabel(machineOfWar);
    sideUnits.push({
      ...machineOfWar,
      displayName: `Machine of War: ${machineLabel}`
    });
  }

  return sideUnits;
}

function getBattleOutcome(battle) {
  if (battle.abandoned) return 'other';
  if (!battle.hasScore) return 'loss';
  if (Number(battle.score || 0) > 0) {
    return battle.defended ? 'loss' : 'win';
  }
  return 'other';
}

function getBattleRawScore(battle) {
  if (!battle || battle.abandoned || !battle.hasScore) return 0;
  return Number(battle.score || 0);
}

function getBattleFilterKeyForSide(side) {
  return side === 'attacker' ? 'attackerUnitIds' : 'defenderUnitIds';
}

function getBattlePlayerFilterKeyForSide(side) {
  return side === 'attacker' ? 'attackerPlayer' : 'defenderPlayer';
}

function getBattlePlayerFilterValue(battle, side) {
  const isAttacker = side === 'attacker';
  const userId = String(isAttacker ? (battle?.attackerUserId || '') : (battle?.defenderUserId || '')).trim();
  const playerName = String(isAttacker ? (battle?.attackerName || '') : (battle?.defenderName || '')).trim();

  if (userId) return `id:${userId}`;
  if (playerName) return `name:${playerName}`;
  return '';
}

function getBattlePlayerFilterLabel(battle, side) {
  const isAttacker = side === 'attacker';
  const userId = String(isAttacker ? (battle?.attackerUserId || '') : (battle?.defenderUserId || '')).trim();
  const playerName = String(isAttacker ? (battle?.attackerName || '') : (battle?.defenderName || '')).trim();

  return playerName || userId || 'Unknown player';
}

function getBattlePlayerAvatarUrl(battle, side) {
  const avatarUnitId = side === 'attacker'
    ? battle?.attackerAvatarUnitId
    : battle?.defenderAvatarUnitId;
  return getAvatarImageUrl(avatarUnitId) || MISSING_UNIT_AVATAR_URL;
}

function toggleBattleFilterDropdown(side, isVisible) {
  const dropdown = document.getElementById(`battle-filter-${side}-dropdown`);
  if (!dropdown) return;
  dropdown.classList.toggle('hidden', !isVisible);
}

function getBattleSideUnitIds(battle, side) {
  const sideUnits = side === 'attacker'
    ? buildBattleSideUnits(battle.attackerUnits, battle.attackerMachineOfWar)
    : buildBattleSideUnits(battle.defenderUnits, battle.defenderMachineOfWar);

  return sideUnits
    .map((unit) => getBattleUnitId(unit))
    .filter(Boolean);
}

function updateBattleLogTileTypeFilterOptions(snapshot) {
  const zoneSelect = document.getElementById('battle-filter-zone');
  if (!zoneSelect) return;

  const battles = Array.isArray(snapshot?.battles) ? snapshot.battles : [];
  const tileTypes = new Set();

  battles.forEach((battle) => {
    const zoneType = String(battle?.zoneType || '').trim();
    if (zoneType) tileTypes.add(zoneType);
  });

  battleLogTileTypeOptions = Array.from(tileTypes).sort((a, b) => a.localeCompare(b));

  if (battleLogFilters.zoneType && !battleLogTileTypeOptions.includes(battleLogFilters.zoneType)) {
    battleLogFilters.zoneType = '';
  }

  zoneSelect.innerHTML = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'All tile types';
  zoneSelect.appendChild(defaultOption);

  battleLogTileTypeOptions.forEach((tileType) => {
    const option = document.createElement('option');
    option.value = tileType;
    option.textContent = tileType;
    zoneSelect.appendChild(option);
  });

  zoneSelect.value = battleLogFilters.zoneType || '';
}

function getGuildNameByTeamIndex(teamIndex) {
  const normalizedTeamIndex = Number(teamIndex);
  if (!Number.isFinite(normalizedTeamIndex)) return 'Unknown guild';

  if (battleLogGuildNameMap.has(normalizedTeamIndex)) {
    return String(battleLogGuildNameMap.get(normalizedTeamIndex));
  }

  const snapshot = (guildSnapshots || []).find((guild) => Number(guild?.teamIndex) === normalizedTeamIndex);
  if (snapshot?.name) return String(snapshot.name);
  return `Team ${normalizedTeamIndex}`;
}

function getLoadedDatasetDescriptors() {
  const seenUrls = new Set();
  return Object.entries(DATASETS)
    .map(([key, dataset]) => ({ key, ...dataset }))
    .filter((dataset) => {
      const normalizedUrl = String(dataset?.url || '').trim();
      if (!normalizedUrl) return false;
      if (seenUrls.has(normalizedUrl)) return false;
      seenUrls.add(normalizedUrl);
      return true;
    });
}

function getBattleLineupKey(units, machineOfWar) {
  return buildBattleSideUnits(units, machineOfWar)
    .map((unit) => getBattleUnitId(unit))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join('|');
}

function getDefenseCoreScore(battle) {
  return getCoreScore(getBattleRawScore(battle)).core;
}

function resetBattleLogScroll() {
  const reset = () => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const scrollContainer = document.querySelector('.site-scroll');
    if (scrollContainer) scrollContainer.scrollTop = 0;
  };

  reset();
  requestAnimationFrame(() => {
    reset();
    requestAnimationFrame(reset);
  });
}

function openWarTeamBattleLog(role, playerId, lineupKey) {
  const isDefense = role === 'defense';
  battleLogFilters.sort = 'newest';
  battleLogFilters.guild = '';
  battleLogFilters.season = '';
  battleLogFilters.war = '';
  battleLogFilters.result = 'all';
  battleLogFilters.cleanup = 'all';
  battleLogFilters.mode = isDefense ? 'defenses' : 'attacks';
  battleLogFilters.zoneType = '';
  battleLogFilters.attackerPlayer = isDefense ? '' : `id:${String(playerId || '').trim()}`;
  battleLogFilters.defenderPlayer = isDefense ? `id:${String(playerId || '').trim()}` : '';
  battleLogFilters.attackerUnitIds = isDefense ? [] : String(lineupKey || '').split('|').filter(Boolean);
  battleLogFilters.defenderUnitIds = isDefense ? String(lineupKey || '').split('|').filter(Boolean) : [];
  syncBattleLogFiltersToUrl();

  const battleLogTab = document.getElementById('war-top-tab-log');
  if (battleLogTab) {
    battleLogTab.click();
  } else if (typeof AppNav !== 'undefined' && typeof AppNav.setParams === 'function') {
    AppNav.setParams({ warView: 'log' });
  }

  resetBattleLogScroll();

  if (battleLogDataLoaded && guildSnapshots[activeGuildIndex]) {
    renderBattleLog(guildSnapshots[activeGuildIndex]);
  }
}

function renderDefences() {
  renderWarTeams('defense');
}

function renderAttacks() {
  renderWarTeams('attack');
}

function renderWarTeams(role) {
  const isDefense = role === 'defense';
  const prefix = isDefense ? 'defences' : 'attacks';
  const playerIdField = isDefense ? 'defenderUserId' : 'attackerUserId';
  const rows = isDefense ? defenseWarRows : attackWarRows;
  const searchTerm = (isDefense ? defensePlayerSearch : attackPlayerSearch).toLowerCase();
  const list = document.getElementById(`${prefix}-list`);
  const summary = document.getElementById(`${prefix}-summary`);
  const empty = document.getElementById(`${prefix}-empty`);
  if (!list) return;

  const currentRows = rows.filter((row) => row.datasetKey === activeDatasetKey);
  const allRows = rows;
  const averageBattleScore = (scoreRows) => scoreRows.length > 0
    ? scoreRows.reduce((sum, row) => sum + getDefenseCoreScore(row), 0) / scoreRows.length
    : 0;
  const currentByPlayer = new Map();
  const currentByLineup = new Map();
  const allByLineup = new Map();

  allRows.forEach((row) => {
    if (!allByLineup.has(row.lineupKey)) allByLineup.set(row.lineupKey, []);
    allByLineup.get(row.lineupKey).push(row);
  });

  currentRows.forEach((row) => {
    const playerId = String(row[playerIdField] || '').trim();
    if (!playerId) return;
    if (!currentByLineup.has(row.lineupKey)) currentByLineup.set(row.lineupKey, []);
    currentByLineup.get(row.lineupKey).push(row);
    if (!currentByPlayer.has(playerId)) currentByPlayer.set(playerId, new Map());
    const lineups = currentByPlayer.get(playerId);
    const existing = lineups.get(row.lineupKey) || { latest: row, rows: [] };
    existing.rows.push(row);
    if (row.createdOn > existing.latest.createdOn) existing.latest = row;
    lineups.set(row.lineupKey, existing);
  });

  const players = Array.from(currentByPlayer.entries())
    .map(([playerId, lineups]) => ({
      playerId,
      name: String(Array.from(lineups.values())[0]?.latest?.[isDefense ? 'defenderName' : 'attackerName'] || playerId),
      lineups: Array.from(lineups.values())
        .sort((a, b) => {
          const aScore = a.rows.reduce((sum, row) => sum + getDefenseCoreScore(row), 0) / Math.max(a.rows.length, 1);
          const bScore = b.rows.reduce((sum, row) => sum + getDefenseCoreScore(row), 0) / Math.max(b.rows.length, 1);
          return (isDefense ? aScore - bScore : bScore - aScore) || b.latest.createdOn - a.latest.createdOn;
        })
        .slice(0, isDefense ? 5 : 10)
    }))
    .filter((player) => !searchTerm || player.name.toLowerCase().includes(searchTerm))
    .sort((a, b) => a.name.localeCompare(b.name));

  list.innerHTML = players.map((player) => `
    <article class="rounded-xl border border-slate-700/80 bg-slate-950/45 p-3">
      <div class="mb-3 flex items-center gap-2 border-b border-slate-700/70 pb-2">
        ${renderPlayerAvatar({ name: player.name, avatarUnitId: player.lineups[0]?.latest?.[isDefense ? 'defenderAvatarUnitId' : 'attackerAvatarUnitId'], avatarFrameId: player.lineups[0]?.latest?.[isDefense ? 'defenderAvatarFrameId' : 'attackerAvatarFrameId'] })}
        <h3 class="font-bold text-slate-100">${escapeHtml(player.name)}</h3>
        <div class="ml-auto grid w-72 shrink-0 grid-cols-2 gap-x-3 text-right text-[11px] font-semibold text-slate-300">
          <span>Average this war</span>
          <span>Average all wars</span>
        </div>
      </div>
      <div class="flex flex-col gap-2">
        ${player.lineups.map((lineup) => {
          const row = lineup.latest;
          const currentLineupRows = currentByLineup.get(row.lineupKey) || [];
          const allLineupRows = allByLineup.get(row.lineupKey) || [];
          const playerCurrentLineupRows = currentLineupRows.filter((entry) => entry[playerIdField] === player.playerId);
          const playerAllLineupRows = allLineupRows.filter((entry) => entry[playerIdField] === player.playerId);
          const playerCurrentAverage = averageBattleScore(playerCurrentLineupRows);
          const playerAllAverage = averageBattleScore(playerAllLineupRows);
          const guildCurrentAverage = averageBattleScore(currentLineupRows);
          const guildAllAverage = averageBattleScore(allLineupRows);
          const battleEntries = lineup.rows
            .slice()
            .sort((a, b) => b.createdOn - a.createdOn);
          const units = isDefense
            ? buildBattleSideUnits(row.defenderUnits, row.defenderMachineOfWar)
            : buildBattleSideUnits(row.attackerUnits, row.attackerMachineOfWar);
          const avatarStrip = units.map((unit) => {
            const imageUrl = getBattleUnitAvatarUrl(unit) || MISSING_UNIT_AVATAR_URL;
            const unitLabel = getBattleUnitLabel(unit);
            return `<img class="h-8 w-8 rounded-md border border-slate-700 bg-slate-950 object-cover" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(unitLabel)}" title="${escapeHtml(unitLabel)}" loading="lazy" onerror="this.src='${MISSING_UNIT_AVATAR_URL}'">`;
          }).join('');
          const battleMarkup = battleEntries.map((battle) => {
            const attackerName = String(battle.attackerName || battle.attackerUserId || 'Unknown attacker');
            const defenderName = String(battle.defenderName || row.defenderName || 'Unknown defender');
            const attackerUnits = buildBattleSideUnits(battle.attackerUnits, battle.attackerMachineOfWar);
            const defenderUnits = buildBattleSideUnits(battle.defenderUnits, battle.defenderMachineOfWar);
            const defended = Boolean(battle.defended);
            const positiveOutcome = isDefense ? defended : !defended;
            const stateClass = positiveOutcome
              ? 'rounded-md bg-emerald-400/20 px-2 py-1 text-lime-100'
              : 'rounded-md bg-rose-400/20 px-2 py-1 text-rose-200';
            const stateLabel = isDefense
              ? (defended ? 'Defended' : 'Breached')
              : (defended ? 'Defeated' : 'Won');
            const zoneLabel = battle.zoneType
              ? `<span class="rounded-full border border-slate-500/50 bg-slate-900/70 px-2 py-0.5 text-xs text-slate-300">${escapeHtml(battle.zoneType)}</span>`
              : '';
            return `<article class="grid grid-cols-1 justify-items-center gap-3 border-t border-slate-700/60 py-3 first:border-t-0 md:grid-cols-3 md:justify-items-stretch">
              <div class="flex min-w-0 flex-col items-center gap-2 text-center md:items-start md:text-left">
                <div class="truncate font-bold text-slate-200">${escapeHtml(attackerName)}</div>
                <div class="flex flex-wrap justify-center gap-1.5 md:justify-start">${renderBattleUnits(attackerUnits, 'attacker')}</div>
              </div>
              <div class="flex min-w-28 flex-col items-center justify-center gap-1 text-center">
                <span class="inline-flex items-center ${stateClass}"><span class="font-semibold text-slate-200">${Math.round(getDefenseCoreScore(battle)).toLocaleString()}</span></span>
                <span class="text-xs uppercase tracking-wide text-slate-300">${stateLabel}</span>
                ${zoneLabel}
                <span class="text-[11px] text-slate-500">${escapeHtml(formatDateTime(Number(battle.createdOn || 0)) || 'Unknown time')}</span>
              </div>
              <div class="flex min-w-0 flex-col items-center gap-2 text-center md:items-end md:text-right">
                <div class="truncate font-bold text-slate-200">${escapeHtml(defenderName)}</div>
                <div class="flex flex-wrap justify-center gap-1.5 md:justify-end">${renderBattleUnits(defenderUnits, 'defender')}</div>
              </div>
            </article>`;
          }).join('');

          return `<details class="rounded-lg border border-slate-700/70 bg-slate-900/55">
            <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm marker:hidden">
              <button type="button" class="flex min-w-0 items-center gap-1.5 overflow-hidden text-left" data-war-team="${role}" data-player-id="${escapeHtml(player.playerId)}" data-lineup-key="${escapeHtml(row.lineupKey)}" title="Open this ${isDefense ? 'defence' : 'attack'} team in the Battle Log" aria-label="Open ${escapeHtml(player.name)} ${isDefense ? 'defence' : 'attack'} team in the Battle Log">${avatarStrip}<span class="ml-1 text-lg leading-none text-cyan-300" aria-hidden="true">&#128065;</span></button>
              <span class="grid w-72 shrink-0 grid-cols-2 gap-x-3 gap-y-1 text-right text-[11px] tabular-nums">
                <span class="text-pink-200" title="Your average this war">You: ${Math.round(playerCurrentAverage).toLocaleString()} (${playerCurrentLineupRows.length})<br><span class="text-slate-400" title="Guild average this war">Guild: ${Math.round(guildCurrentAverage).toLocaleString()} (${currentLineupRows.length})</span></span>
                <span class="text-pink-200" title="Your average over all wars">You: ${Math.round(playerAllAverage).toLocaleString()} (${playerAllLineupRows.length})<br><span class="text-slate-400" title="Guild average over all wars">Guild: ${Math.round(guildAllAverage).toLocaleString()} (${allLineupRows.length})</span></span>
              </span>
            </summary>
            <div class="border-t border-slate-700/70 p-2.5"><div class="flex flex-col divide-y divide-slate-700/60">${battleMarkup}</div></div>
          </details>`;
        }).join('')}
      </div>
    </article>`).join('');

  list.querySelectorAll('[data-war-team]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.blur();
      openWarTeamBattleLog(button.dataset.warTeam, button.dataset.playerId, button.dataset.lineupKey);
    });
  });

  if (summary) summary.textContent = `${players.length.toLocaleString()} players${searchTerm ? ' matching the search' : ''} with current ${isDefense ? 'defense' : 'attack'} teams.`;
  if (empty) {
    empty.textContent = `No ${isDefense ? 'defense' : 'attack'} teams are available for the current war yet.`;
    empty.classList.toggle('hidden', players.length > 0);
  }
}

function setupWarTeamPlayerSearch(role) {
  const isDefense = role === 'defense';
  const input = document.getElementById(`${isDefense ? 'defences' : 'attacks'}-player-search`);
  if (!input || (isDefense ? defensePlayerSearchInitialized : attackPlayerSearchInitialized)) return;

  input.value = isDefense ? defensePlayerSearch : attackPlayerSearch;
  input.addEventListener('input', (event) => {
    const search = String(event.target.value || '').trim().toLowerCase();
    if (isDefense) defensePlayerSearch = search;
    else attackPlayerSearch = search;
    renderWarTeams(role);
  });

  if (isDefense) defensePlayerSearchInitialized = true;
  else attackPlayerSearchInitialized = true;
}

function setupDefencesPlayerSearch() {
  setupWarTeamPlayerSearch('defense');
}

function setupAttacksPlayerSearch() {
  setupWarTeamPlayerSearch('attack');
}

async function loadWarTeamHistory(role) {
  const isDefense = role === 'defense';
  const setRows = (rows) => {
    if (isDefense) defenseWarRows = rows;
    else attackWarRows = rows;
    renderWarTeams(role);
  };

  try {
    await loadDatasetManifest();
    const datasets = getLoadedDatasetDescriptors();
    const rowsByWar = await Promise.all(datasets.map(async (dataset) => {
      try {
        const response = await fetch(dataset.url, { cache: 'no-store' });
        if (!response.ok) return [];
        const data = await response.json();
        const snapshots = buildSnapshot(data);
        const targetTeamIndex = getPrimaryGuildTeamIndexFromData(data) || null;
        const targetIndex = Number(targetTeamIndex);
        const targetSnapshot = snapshots.find((snapshot) => Number(snapshot?.teamIndex) === targetIndex) || snapshots[0];
        const opponentSnapshot = snapshots.find((snapshot) => Number(snapshot?.teamIndex) !== Number(targetSnapshot?.teamIndex));
        const sourceSnapshot = isDefense ? opponentSnapshot : targetSnapshot;
        const teamField = isDefense ? 'defenderTeamIndex' : 'attackerTeamIndex';
        const playerField = isDefense ? 'defenderUserId' : 'attackerUserId';
        const unitsField = isDefense ? 'defenderUnits' : 'attackerUnits';
        const machineField = isDefense ? 'defenderMachineOfWar' : 'attackerMachineOfWar';
        return (Array.isArray(sourceSnapshot?.battles) ? sourceSnapshot.battles : [])
          .filter((battle) => Number(battle?.[teamField]) === Number(targetSnapshot?.teamIndex) && battle?.[playerField])
          .map((battle) => ({ ...battle, datasetKey: dataset.key, lineupKey: getBattleLineupKey(battle[unitsField], battle[machineField]) }))
          .filter((row) => row.lineupKey);
      } catch (error) {
        return [];
      }
    }));
    setRows(rowsByWar.flat());
  } catch (error) {
    setRows([]);
  }
}

async function loadDefenseHistory() {
  await loadWarTeamHistory('defense');
}

async function loadAttackHistory() {
  await loadWarTeamHistory('attack');
}

function getPrimaryGuildTeamIndexFromData(data) {
  const guildData = Array.isArray(getPrimaryEventResponseData(data)?.guildData) ? getPrimaryEventResponseData(data).guildData : [];
  const guildMatch = guildData.find((guild) => String(guild?.name || '').includes('Praetorians of Terra'));
  const fallbackGuild = guildMatch || guildData.find((guild) => Number.isFinite(Number(guild?.teamIndex)));
  const teamIndex = Number(fallbackGuild?.teamIndex);
  return Number.isFinite(teamIndex) ? teamIndex : null;
}

function getPrimaryGuildNameFromData(data) {
  const guildData = Array.isArray(getPrimaryEventResponseData(data)?.guildData) ? getPrimaryEventResponseData(data).guildData : [];
  const guildMatch = guildData.find((guild) => String(guild?.name || '').includes('Praetorians of Terra'));
  if (guildMatch?.name) {
    return String(guildMatch.name);
  }

  const fallbackGuild = guildData.find((guild) => Number.isFinite(Number(guild?.teamIndex)));
  return String(fallbackGuild?.name || 'Praetorians of Terra');
}

function pickGuildSnapshotForAllWars(snapshots, teamIndex, guildName) {
  const numericTeamIndex = Number(teamIndex);

  if (Number.isFinite(numericTeamIndex)) {
    const teamIndexMatch = snapshots.find((guild) => Number(guild?.teamIndex) === numericTeamIndex);
    if (teamIndexMatch) return teamIndexMatch;
  }

  const guildNameMatch = snapshots.find((guild) => String(guild?.name || '').includes(String(guildName || 'Praetorians of Terra')));
  if (guildNameMatch) return guildNameMatch;

  return snapshots[0] || null;
}

function normalizeBattleForAllWars(battle, canonicalTeamIndex) {
  return {
    ...battle,
    attackerTeamIndex: canonicalTeamIndex
  };
}

function getBattleRoleLabel(role) {
  return role === 'defense' ? 'Defense' : 'Attack';
}

function getAverageCoreScoreForBattles(battles) {
  const source = Array.isArray(battles) ? battles : [];
  if (source.length === 0) return 0;

  const totalCoreScore = source.reduce((sum, battle) => {
    return sum + getCoreScore(getBattleRawScore(battle)).core;
  }, 0);

  return totalCoreScore / source.length;
}

function buildWarPerformancePoint(dataset, dataTimestamp, battles) {
  const source = Array.isArray(battles) ? battles : [];
  const wins = source.filter((battle) => getBattleOutcome(battle) === 'win');
  const losses = source.filter((battle) => getBattleOutcome(battle) === 'loss');

  return {
    key: String(dataset?.key || ''),
    label: String(dataset?.label || 'Unknown war'),
    timestamp: Number(dataTimestamp || 0),
    averagePerWar: getAverageCoreScoreForBattles(source),
    averagePerWin: wins.length > 0 ? getAverageCoreScoreForBattles(wins) : 0,
    averagePerLoss: losses.length > 0 ? getAverageCoreScoreForBattles(losses) : 0,
    battleCount: source.length
  };
}

function setupBattleLogPageTabs() {
  if (battleLogPageTabsInitialized) return;

  const battleHistoryBtn = document.getElementById('tab-btn-battle-history');
  const guildPerformanceBtn = document.getElementById('tab-btn-guild-performance');
  const playerAttackBtn = document.getElementById('tab-btn-player-attack');
  const playerDefenseBtn = document.getElementById('tab-btn-player-defense');
  const battleHistoryPanel = document.getElementById('tab-panel-battle-history');
  const guildPerformancePanel = document.getElementById('tab-panel-guild-performance');
  const playerAttackPanel = document.getElementById('tab-panel-player-attack');
  const playerDefensePanel = document.getElementById('tab-panel-player-defense');

  if (!battleHistoryBtn || !guildPerformanceBtn || !playerAttackBtn || !playerDefenseBtn || !battleHistoryPanel || !guildPerformancePanel || !playerAttackPanel || !playerDefensePanel) return;
  const isStandaloneBattleLogPage = document.body?.dataset?.page === 'battle-log';

  const applyTabState = (tab) => {
    const tabs = [
      { name: 'battle-history', label: 'Battle history', button: battleHistoryBtn, panel: battleHistoryPanel },
      { name: 'guild-performance', label: 'Guild performance', button: guildPerformanceBtn, panel: guildPerformancePanel },
      { name: 'player-attack', label: 'Attack performance', button: playerAttackBtn, panel: playerAttackPanel },
      { name: 'player-defense', label: 'Def performance', button: playerDefenseBtn, panel: playerDefensePanel }
    ];

    const active = tabs.find((tabItem) => tabItem.name === tab) || tabs[0];

    tabs.forEach((tabItem) => {
      const isActive = tabItem === active;
      tabItem.panel.classList.toggle('hidden', !isActive);
      tabItem.button.classList.toggle('border-cyan-400', isActive);
      tabItem.button.classList.toggle('text-cyan-300', isActive);
      tabItem.button.classList.toggle('border-transparent', !isActive);
      tabItem.button.classList.toggle('text-slate-400', !isActive);
    });

    if (isStandaloneBattleLogPage) {
      AppNav.renderBreadcrumb([
        { label: 'Home', href: 'index.html' },
        { label: 'Battle Log', params: { tab: null } },
        { label: active.label }
      ], applyTabsFromUrl);
    }
  };

  const applyTabsFromUrl = () => applyTabState(AppNav.get('tab') || 'battle-history');

  const navigateToTab = (tab) => {
    AppNav.setParams({ tab: tab === 'battle-history' ? null : tab });
    applyTabsFromUrl();
  };

  battleHistoryBtn.addEventListener('click', () => navigateToTab('battle-history'));
  guildPerformanceBtn.addEventListener('click', () => navigateToTab('guild-performance'));
  playerAttackBtn.addEventListener('click', () => navigateToTab('player-attack'));
  playerDefenseBtn.addEventListener('click', () => navigateToTab('player-defense'));

  AppNav.onChange(applyTabsFromUrl);
  applyTabsFromUrl();
  battleLogPageTabsInitialized = true;
}

let playerAttackTotalsSort = { key: 'averageScore', direction: 'desc' };
let playerDefenseTotalsSort = { key: 'averageScore', direction: 'asc' };

const PLAYER_TOTALS_COLUMNS = [
  { key: 'name', label: 'Player' },
  { key: 'averageScore', label: 'Average score' },
  { key: 'totalScore', label: 'Total score' },
  { key: 'battles', label: 'Battles' },
  { key: 'wins', label: 'Wins' },
  { key: 'losses', label: 'Loses' }
];

function getBattleOutcomeForGuildRole(battle, role) {
  const baseOutcome = getBattleOutcome(battle);
  if (role === 'defense') {
    if (baseOutcome === 'win') return 'loss';
    if (baseOutcome === 'loss') return 'win';
  }
  return baseOutcome;
}

function renderPlayerTotalsTable(battles, role = 'attack') {
  const isDefenseRole = role === 'defense';
  const tableHead = document.getElementById(isDefenseRole ? 'player-defense-head' : 'player-attack-head');
  const tableBody = document.getElementById(isDefenseRole ? 'player-defense-body' : 'player-attack-body');
  const summary = document.getElementById(isDefenseRole ? 'player-defense-summary' : 'player-attack-summary');
  const emptyState = document.getElementById(isDefenseRole ? 'player-defense-empty' : 'player-attack-empty');
  if (!tableBody) return;

  const source = (Array.isArray(battles) ? battles : []).filter((battle) => {
    const battleRole = String(battle?.battleRole || 'attack');
    return isDefenseRole ? battleRole === 'defense' : battleRole === 'attack';
  });
  const aggregateMap = new Map();

  source.forEach((battle) => {
    const userId = String(isDefenseRole ? (battle?.defenderUserId || '') : (battle?.attackerUserId || '')).trim();
    const name = String(isDefenseRole ? (battle?.defenderName || '') : (battle?.attackerName || '')).trim() || 'Unknown player';
    const key = userId || `name:${name.toLowerCase()}`;
    const coreScore = getCoreScore(getBattleRawScore(battle)).core;

    if (!aggregateMap.has(key)) {
      aggregateMap.set(key, {
        name,
        totalScore: 0,
        battles: 0,
        wins: 0,
        losses: 0,
        cleanupWins: 0
      });
    }

    const entry = aggregateMap.get(key);
    entry.totalScore += coreScore;
    entry.battles += 1;

    const outcome = getBattleOutcomeForGuildRole(battle, role);
    if (outcome === 'win') {
      entry.wins += 1;
      if (battle?.cleanup) {
        entry.cleanupWins += 1;
      }
    } else if (outcome === 'loss') {
      entry.losses += 1;
    }
  });

  const sort = isDefenseRole ? playerDefenseTotalsSort : playerAttackTotalsSort;

  const rows = Array.from(aggregateMap.values())
    .map((entry) => ({
      ...entry,
      averageScore: entry.battles > 0 ? entry.totalScore / entry.battles : 0
    }))
    .sort((a, b) => {
      const key = sort.key;
      const sign = sort.direction === 'asc' ? 1 : -1;
      if (key === 'name') {
        return sign * String(a.name).localeCompare(String(b.name));
      }
      const valA = Number(a[key]) || 0;
      const valB = Number(b[key]) || 0;
      if (valA !== valB) return sign * (valA - valB);
      return a.name.localeCompare(b.name);
    });

  if (summary) {
    summary.textContent = `${rows.length.toLocaleString()} players`;
  }

  if (tableHead) {
    tableHead.innerHTML = `<tr>${PLAYER_TOTALS_COLUMNS.map((column) => {
      const isSorted = sort.key === column.key;
      const arrow = isSorted ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th class="px-3 py-2" aria-sort="${isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}">
        <button type="button" data-totals-sort="${column.key}" data-role="${role}" class="uppercase tracking-wide transition-colors hover:text-slate-100 ${isSorted ? 'text-cyan-300' : ''}">${escapeHtml(column.label)}${arrow}</button>
      </th>`;
    }).join('')}</tr>`;

    tableHead.querySelectorAll('[data-totals-sort]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.getAttribute('data-totals-sort');
        const currentSort = isDefenseRole ? playerDefenseTotalsSort : playerAttackTotalsSort;
        if (currentSort.key === key) {
          currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
          currentSort.key = key;
          currentSort.direction = key === 'name' ? 'asc' : (isDefenseRole && key === 'averageScore' ? 'asc' : 'desc');
        }
        const activeBattles = Array.isArray(guildSnapshots[activeGuildIndex]?.battles) ? guildSnapshots[activeGuildIndex].battles : [];
        renderPlayerTotalsTable(activeBattles, role);
      });
    });
  }

  tableBody.innerHTML = '';

  if (rows.length === 0) {
    if (emptyState) {
      emptyState.textContent = isDefenseRole
        ? 'No defense performance data available yet.'
        : 'No attack performance data available yet.';
      emptyState.classList.remove('hidden');
    }
    return;
  }

  if (emptyState) {
    emptyState.classList.add('hidden');
  }

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="px-3 py-2 font-semibold text-slate-100">${escapeHtml(row.name)}</td>
      <td class="px-3 py-2 text-emerald-200">${row.averageScore.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
      <td class="px-3 py-2 text-cyan-200">${row.totalScore.toLocaleString()}</td>
      <td class="px-3 py-2 text-slate-300">${row.battles.toLocaleString()}</td>
      <td class="px-3 py-2 text-emerald-200">${formatCountWithCleanup(row.wins, row.cleanupWins)}</td>
      <td class="px-3 py-2 text-rose-200">${row.losses.toLocaleString()}</td>
    `;
    tableBody.appendChild(tr);
  });
}

function renderGuildPerformanceChart(points) {
  const chart = document.getElementById('guild-performance-chart');
  const summary = document.getElementById('guild-performance-summary');
  const emptyState = document.getElementById('guild-performance-empty');
  if (!chart) return;

  const source = Array.isArray(points) ? [...points] : [];
  const sortedPoints = source
    .filter((point) => point && typeof point === 'object')
    .sort((a, b) => {
      const ta = Number(a.timestamp || 0);
      const tb = Number(b.timestamp || 0);
      if (ta !== tb) return ta - tb;
      return String(a.label || '').localeCompare(String(b.label || ''));
    });

  if (summary) {
    summary.textContent = `${sortedPoints.length.toLocaleString()} wars analyzed`;
  }

  if (sortedPoints.length === 0) {
    chart.innerHTML = '';
    if (emptyState) {
      emptyState.textContent = 'No war performance data available yet.';
      emptyState.classList.remove('hidden');
    }
    return;
  }

  if (emptyState) {
    emptyState.classList.add('hidden');
  }

  const viewWidth = 960;
  const viewHeight = 360;
  const margin = { top: 20, right: 26, bottom: 70, left: 60 };
  const innerWidth = viewWidth - margin.left - margin.right;
  const innerHeight = viewHeight - margin.top - margin.bottom;

  const allValues = sortedPoints.flatMap((point) => [point.averagePerWar, point.averagePerWin, point.averagePerLoss]);
  const maxValue = Math.max(100, ...allValues.map((value) => Number(value || 0)));
  const yMax = Math.max(MAX_TOKEN_SCORE, Math.ceil(maxValue / 100) * 100);
  const yTicks = 5;

  const xAt = (index) => {
    if (sortedPoints.length === 1) return margin.left + innerWidth / 2;
    return margin.left + (index * innerWidth) / (sortedPoints.length - 1);
  };

  const yAt = (value) => {
    const normalized = Math.max(0, Math.min(yMax, Number(value || 0)));
    return margin.top + innerHeight - (normalized / yMax) * innerHeight;
  };

  const buildPath = (valueKey) => {
    return sortedPoints
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xAt(index).toFixed(1)} ${yAt(point[valueKey]).toFixed(1)}`)
      .join(' ');
  };

  const makePoints = (valueKey, color) => {
    return sortedPoints
      .map((point, index) => {
        const x = xAt(index).toFixed(1);
        const y = yAt(point[valueKey]).toFixed(1);
        const title = `${point.label}: ${Number(point[valueKey] || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
        return `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}"><title>${escapeHtml(title)}</title></circle>`;
      })
      .join('');
  };

  const xLabels = sortedPoints
    .map((point, index) => {
      const raw = String(point.label || '');
      const compact = raw.replace(/^History\s+/i, '').replace(/^Active\s+/i, 'Active ');
      const x = xAt(index).toFixed(1);
      const y = (viewHeight - 22).toFixed(1);
      return `<text x="${x}" y="${y}" transform="rotate(-28 ${x} ${y})" text-anchor="end" fill="#94a3b8" font-size="11">${escapeHtml(compact)}</text>`;
    })
    .join('');

  const gridLines = Array.from({ length: yTicks + 1 }, (_, idx) => {
    const value = (yMax / yTicks) * idx;
    const y = yAt(value).toFixed(1);
    return `
      <line x1="${margin.left}" y1="${y}" x2="${viewWidth - margin.right}" y2="${y}" stroke="rgba(148,163,184,0.2)" stroke-width="1" />
      <text x="${margin.left - 8}" y="${Number(y) + 4}" text-anchor="end" fill="#94a3b8" font-size="11">${Math.round(value)}</text>
    `;
  }).join('');

  chart.setAttribute('viewBox', `0 0 ${viewWidth} ${viewHeight}`);
  chart.innerHTML = `
    <g>
      ${gridLines}
      <line x1="${margin.left}" y1="${margin.top + innerHeight}" x2="${viewWidth - margin.right}" y2="${margin.top + innerHeight}" stroke="rgba(148,163,184,0.35)" stroke-width="1.2" />
      <path d="${buildPath('averagePerWar')}" fill="none" stroke="#22d3ee" stroke-width="2.5" />
      <path d="${buildPath('averagePerWin')}" fill="none" stroke="#4ade80" stroke-width="2.5" />
      <path d="${buildPath('averagePerLoss')}" fill="none" stroke="#fb7185" stroke-width="2.5" />
      ${makePoints('averagePerWar', '#22d3ee')}
      ${makePoints('averagePerWin', '#4ade80')}
      ${makePoints('averagePerLoss', '#fb7185')}
      ${xLabels}
    </g>
  `;
}

function mergeBattleLogsFromSnapshots(snapshots) {
  const mergedBattles = snapshots
    .flatMap((snapshot) => Array.isArray(snapshot?.battles) ? snapshot.battles : []);

  const dedupedBattleMap = new Map();

  mergedBattles.forEach((battle) => {
    const stableKey = String(battle?.id || '').trim()
      ? `${String(battle.id).trim()}::${String(battle?.battleRole || 'attack')}`
      : [
          String(battle?.battleRole || 'attack'),
          String(battle?.createdOn || 0),
          String(battle?.attackerUserId || battle?.attackerName || ''),
          String(battle?.defenderUserId || battle?.defenderName || ''),
          String(battle?.zoneType || ''),
          String(Number(battle?.score || 0))
        ].join('::');

    if (!dedupedBattleMap.has(stableKey)) {
      dedupedBattleMap.set(stableKey, battle);
    }
  });

  return Array.from(dedupedBattleMap.values())
    .sort((a, b) => Number(b.createdOn || 0) - Number(a.createdOn || 0));
}

async function loadAllWarsBattleLogData() {
  if (battleLogDataLoaded || battleLogDataLoading) return;
  battleLogDataLoading = true;
  await loadDatasetManifest();
  battleLogGuildNameMap = new Map();

  const statusMessage = document.getElementById('status-message');
  const lastUpdatedEl = document.getElementById('last-updated');

  if (statusMessage) {
    statusMessage.textContent = 'Loading all wars battle log...';
  }
  if (lastUpdatedEl) {
    lastUpdatedEl.textContent = 'Loading...';
  }
  try {
    await initializePortraitMapper();

    const datasets = getLoadedDatasetDescriptors();
    const results = await Promise.all(datasets.map(async (dataset) => {
      const response = await fetch(dataset.url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Unable to fetch ${dataset.key} (${response.status})`);
      }

      const data = await response.json();
      return {
        dataset,
        responseLastModified: response.headers.get('last-modified'),
        data,
        dataTimestamp: getLatestActivityTimestamp(data)
      };
    }));

    const allGuildSnapshots = [];
    const warPerformancePoints = [];
    let latestTimestamp = 0;
    let latestResponseModified = '';
    let latestResponseModifiedTime = 0;

    results.forEach(({ dataset, data, responseLastModified, dataTimestamp }) => {
      const season = seasonGroups.find((group) => group.entries.some(([key]) => key === dataset.key));
      const seasonKey = season?.entries?.[0]?.[0] || dataset.key;
      const seasonLabel = season?.label || dataset.label;
      const targetTeamIndex = getPrimaryGuildTeamIndexFromData(data);
      const targetGuildName = getPrimaryGuildNameFromData(data);
      const snapshots = buildSnapshot(data);

      const targetSnapshot = pickGuildSnapshotForAllWars(snapshots, targetTeamIndex, targetGuildName);
      if (targetSnapshot) {
        const opponentSnapshot = snapshots.find((snapshot) => Number(snapshot?.teamIndex) !== Number(targetSnapshot.teamIndex)) || null;
        const attackerGuildName = String(targetSnapshot.name || targetGuildName || 'Praetorians of Terra');
        const defenderGuildName = String(opponentSnapshot?.name || 'Unknown guild');
        const defenseBattles = Array.isArray(opponentSnapshot?.battles)
          ? opponentSnapshot.battles
              .filter((battle) => Number(battle?.defenderTeamIndex) === Number(targetSnapshot.teamIndex))
              .map((battle) => ({
                ...battle,
                datasetKey: dataset.key,
                datasetLabel: dataset.label,
                seasonKey,
                seasonLabel,
                battleRole: 'defense',
                attackerGuildName: defenderGuildName,
                defenderGuildName: attackerGuildName
              }))
          : [];
        const attackBattles = Array.isArray(targetSnapshot.battles)
          ? targetSnapshot.battles.map((battle) => ({
              ...battle,
              datasetKey: dataset.key,
              datasetLabel: dataset.label,
              seasonKey,
              seasonLabel,
              battleRole: 'attack',
              attackerGuildName,
              defenderGuildName
            }))
          : [];

        if (Number.isFinite(Number(targetSnapshot.teamIndex)) && targetSnapshot.name) {
          battleLogGuildNameMap.set(Number(targetSnapshot.teamIndex), String(targetSnapshot.name));
        }
        if (Number.isFinite(Number(opponentSnapshot?.teamIndex)) && opponentSnapshot?.name) {
          battleLogGuildNameMap.set(Number(opponentSnapshot.teamIndex), String(opponentSnapshot.name));
        }

        const combinedWarBattles = [...attackBattles, ...defenseBattles];
        allGuildSnapshots.push({
          ...targetSnapshot,
          teamIndex: Number.isFinite(Number(targetSnapshot.teamIndex)) ? Number(targetSnapshot.teamIndex) : null,
          battleLogScope: 'combined',
          battles: combinedWarBattles
        });

        warPerformancePoints.push(buildWarPerformancePoint(dataset, dataTimestamp, combinedWarBattles));
      }

      const numericTimestamp = Number(dataTimestamp || 0);
      if (Number.isFinite(numericTimestamp) && numericTimestamp > latestTimestamp) {
        latestTimestamp = numericTimestamp;
      }

      const responseModifiedTime = responseLastModified ? Date.parse(responseLastModified) : NaN;
      if (Number.isFinite(responseModifiedTime) && responseModifiedTime > latestResponseModifiedTime) {
        latestResponseModifiedTime = responseModifiedTime;
        latestResponseModified = responseLastModified;
      }
    });

    const combinedSnapshot = {
      teamIndex: null,
      battleLogScope: 'combined',
      name: String(allGuildSnapshots[0]?.name || 'Praetorians of Terra'),
      battles: mergeBattleLogsFromSnapshots(allGuildSnapshots)
    };

    const currentSeason = seasonGroups[0];
    if (!battleLogFilters.season && currentSeason?.entries?.[0]?.[0]) {
      battleLogFilters.season = currentSeason.entries[0][0];
    }
    if (!battleLogFilters.war && currentSeason?.entries?.[0]?.[0]) {
      battleLogFilters.war = currentSeason.entries[0][0];
    }
    if (!battleLogFilters.guild) {
      const guildName = combinedSnapshot.battles
        .flatMap((battle) => [battle.attackerGuildName, battle.defenderGuildName])
        .find((name) => String(name || '').toLowerCase().includes('praetorians'));
      if (guildName) battleLogFilters.guild = guildName;
    }
    syncBattleLogFiltersToUrl();

    guildSnapshots = [combinedSnapshot];
    activeGuildIndex = 0;
    renderLastUpdated({ responseLastModified: latestResponseModified || null, dataTimestamp: latestTimestamp || null });
    setupBattleLogFilters();
    renderBattleLog(combinedSnapshot);
    renderGuildPerformanceChart(warPerformancePoints);
    renderPlayerTotalsTable(combinedSnapshot.battles, 'attack');
    renderPlayerTotalsTable(combinedSnapshot.battles, 'defense');

    if (statusMessage) {
      statusMessage.textContent = `Loaded ${combinedSnapshot.battles.length.toLocaleString()} battles across ${results.length.toLocaleString()} wars for Praetorians of Terra.`;
    }
    battleLogDataLoaded = true;
    battleLogDataLoading = false;
  } catch (error) {
    console.error(error);
    guildSnapshots = [{ teamIndex: null, battleLogScope: 'combined', name: 'Praetorians of Terra', battles: [] }];
    activeGuildIndex = 0;
    renderLastUpdated({ responseLastModified: null, dataTimestamp: null });
    setupBattleLogFilters();
    renderBattleLog(guildSnapshots[0]);
    renderGuildPerformanceChart([]);
    renderPlayerTotalsTable([], 'attack');
    renderPlayerTotalsTable([], 'defense');

    if (statusMessage) {
      statusMessage.textContent = 'The all wars battle log could not be loaded. Open the app from a local web server to enable fetch().';
    }
    battleLogDataLoading = false;
  }
}

function renderBattleLogPlayerFilterControl(side) {
  const input = document.getElementById(`battle-filter-${side}-player-input`);
  const selectedContainer = document.getElementById(`battle-filter-${side}-player-selected`);
  const optionsContainer = document.getElementById(`battle-filter-${side}-player-options`);
  if (!input || !selectedContainer || !optionsContainer) return;

  const key = getBattlePlayerFilterKeyForSide(side);
  const options = battleLogPlayerFilterOptions[side] || [];
  const selectedValue = battleLogFilters[key] || '';
  const selectedOption = options.find((option) => option.value === selectedValue) || null;
  const selectedSet = new Set(selectedValue ? [selectedValue] : []);
  const filterText = String(input.value || '').trim().toLowerCase();
  const filteredOptions = options.filter((optionData) => {
    return optionData.searchText.includes(filterText);
  });

  selectedContainer.innerHTML = '';
  if (selectedOption) {
    const isDefense = side === 'defender';
    const chipToneClasses = isDefense
      ? 'border-pink-400/45 bg-pink-900/40 text-pink-100'
      : 'border-sky-400/45 bg-sky-900/40 text-sky-100';
    const removeToneClass = isDefense ? 'text-pink-300' : 'text-sky-300';
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `inline-flex items-center gap-2 rounded-full border px-2 py-1 ${chipToneClasses}`;
    chip.setAttribute('data-player-value', selectedOption.value);
    chip.innerHTML = `
      <img class="h-8 w-8 rounded-full object-cover" src="${escapeHtml(selectedOption.avatarUrl || MISSING_UNIT_AVATAR_URL)}" alt="${escapeHtml(selectedOption.label)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}';">
      <span class="text-base font-semibold">${escapeHtml(selectedOption.label)}</span>
      <span class="text-sm ${removeToneClass}" aria-hidden="true">x</span>
    `;
    chip.addEventListener('click', (event) => {
      event.stopPropagation();
      battleLogFilters[key] = '';
      syncBattleLogFiltersToUrl();
      const snapshot = guildSnapshots[activeGuildIndex];
      if (snapshot) {
        renderBattleLog(snapshot);
        toggleBattleFilterDropdown(`${side}-player`, true);
      }
    });
    selectedContainer.appendChild(chip);
  }

  optionsContainer.innerHTML = '';
  if (filteredOptions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'px-2 py-2 text-xs text-slate-400';
    empty.textContent = 'No matching players';
    optionsContainer.appendChild(empty);
    return;
  }

  filteredOptions.forEach((optionData) => {
    const isDefense = side === 'defender';
    const selectedToneClass = isDefense ? 'bg-pink-900/45' : 'bg-sky-900/45';
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-slate-200 hover:bg-slate-700/80 ${selectedSet.has(optionData.value) ? selectedToneClass : ''}`;
    option.setAttribute('data-player-value', optionData.value);
    option.innerHTML = `
      <img class="h-8 w-8 rounded-full object-cover" src="${escapeHtml(optionData.avatarUrl || MISSING_UNIT_AVATAR_URL)}" alt="${escapeHtml(optionData.label)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}';">
      <span class="text-base font-semibold">${escapeHtml(optionData.label)}</span>
      <span class="ml-auto text-base font-bold text-cyan-300" aria-hidden="true">${selectedSet.has(optionData.value) ? '✓' : ''}</span>
    `;
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      battleLogFilters[key] = selectedSet.has(optionData.value) ? '' : optionData.value;
      syncBattleLogFiltersToUrl();
      const snapshot = guildSnapshots[activeGuildIndex];
      if (snapshot) {
        renderBattleLog(snapshot);
        toggleBattleFilterDropdown(`${side}-player`, true);
      }

      const sideInput = document.getElementById(`battle-filter-${side}-player-input`);
      if (sideInput) {
        sideInput.focus();
      }
    });
    optionsContainer.appendChild(option);
  });

  input.placeholder = selectedOption
    ? selectedOption.label
    : (side === 'attacker' ? 'Search offense players...' : 'Search defense players...');
}

function updateBattleLogPlayerFilterOptions(snapshot) {
  const attackerInput = document.getElementById('battle-filter-attacker-player-input');
  const defenderInput = document.getElementById('battle-filter-defender-player-input');
  if (!attackerInput || !defenderInput) return;

  const battles = Array.isArray(snapshot?.battles) ? snapshot.battles : [];
  const optionBuckets = {
    attacker: new Map(),
    defender: new Map()
  };

  battles.forEach((battle) => {
    ['attacker', 'defender'].forEach((side) => {
      const value = getBattlePlayerFilterValue(battle, side);
      if (!value) return;
      if (optionBuckets[side].has(value)) return;
      optionBuckets[side].set(value, {
        value,
        label: getBattlePlayerFilterLabel(battle, side),
        avatarUrl: getBattlePlayerAvatarUrl(battle, side),
        searchText: `${getBattlePlayerFilterLabel(battle, side)} ${value}`.toLowerCase()
      });
    });
  });

  battleLogPlayerFilterOptions.attacker = Array.from(optionBuckets.attacker.values()).sort((a, b) => a.label.localeCompare(b.label));
  battleLogPlayerFilterOptions.defender = Array.from(optionBuckets.defender.values()).sort((a, b) => a.label.localeCompare(b.label));

  const attackerValues = new Set(battleLogPlayerFilterOptions.attacker.map((option) => option.value));
  const defenderValues = new Set(battleLogPlayerFilterOptions.defender.map((option) => option.value));

  if (battleLogFilters.attackerPlayer && !attackerValues.has(battleLogFilters.attackerPlayer)) {
    battleLogFilters.attackerPlayer = '';
  }

  if (battleLogFilters.defenderPlayer && !defenderValues.has(battleLogFilters.defenderPlayer)) {
    battleLogFilters.defenderPlayer = '';
  }

  renderBattleLogPlayerFilterControl('attacker');
  renderBattleLogPlayerFilterControl('defender');
}

function updateBattleLogUnitFilterOptions(snapshot) {
  const attackerInput = document.getElementById('battle-filter-attacker-input');
  const defenderInput = document.getElementById('battle-filter-defender-input');

  if (!attackerInput || !defenderInput) return;

  const battles = Array.isArray(snapshot?.battles) ? snapshot.battles : [];
  const attackerIds = new Set();
  const defenderIds = new Set();

  battles.forEach((battle) => {
    getBattleSideUnitIds(battle, 'attacker').forEach((id) => attackerIds.add(id));
    getBattleSideUnitIds(battle, 'defender').forEach((id) => defenderIds.add(id));
  });

  battleLogFilterOptions.attacker = Array.from(attackerIds).sort((a, b) => a.localeCompare(b));
  battleLogFilterOptions.defender = Array.from(defenderIds).sort((a, b) => a.localeCompare(b));

  battleLogFilters.attackerUnitIds = battleLogFilters.attackerUnitIds.filter((unitId) => battleLogFilterOptions.attacker.includes(unitId));
  battleLogFilters.defenderUnitIds = battleLogFilters.defenderUnitIds.filter((unitId) => battleLogFilterOptions.defender.includes(unitId));

  renderBattleLogUnitFilterControl('attacker');
  renderBattleLogUnitFilterControl('defender');
}

function updateBattleLogScopeFilterOptions(snapshot) {
  const guildSelect = document.getElementById('battle-filter-guild');
  const seasonSelect = document.getElementById('battle-filter-season');
  const warSelect = document.getElementById('battle-filter-war');
  if (!guildSelect || !seasonSelect || !warSelect) return;

  const battles = Array.isArray(snapshot?.battles) ? snapshot.battles : [];
  const guilds = new Set();
  const seasons = new Map();
  const wars = new Map();

  battles.forEach((battle) => {
    [battle.attackerGuildName, battle.defenderGuildName].forEach((name) => {
      if (name) guilds.add(String(name));
    });
    if (battle.seasonKey) seasons.set(String(battle.seasonKey), String(battle.seasonLabel || battle.seasonKey));
    if (battle.datasetKey && (!battleLogFilters.season || battle.seasonKey === battleLogFilters.season)) {
      wars.set(String(battle.datasetKey), String(battle.datasetLabel || battle.datasetKey));
    }
  });

  battleLogFilterOptions.guild = Array.from(guilds).sort((a, b) => a.localeCompare(b));
  battleLogFilterOptions.season = Array.from(seasons.entries()).sort((a, b) => b[1].localeCompare(a[1]));
  battleLogFilterOptions.war = Array.from(wars.entries()).sort((a, b) => b[1].localeCompare(a[1]));
  if (battleLogFilters.war && !wars.has(battleLogFilters.war)) {
    battleLogFilters.war = '';
  }

  guildSelect.innerHTML = '<option value="">All guilds</option>';
  battleLogFilterOptions.guild.forEach((guild) => {
    guildSelect.innerHTML += `<option value="${escapeHtml(guild)}">${escapeHtml(guild)}</option>`;
  });
  seasonSelect.innerHTML = '<option value="">All seasons</option>';
  battleLogFilterOptions.season.forEach(([key, label]) => {
    seasonSelect.innerHTML += `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`;
  });
  warSelect.innerHTML = '<option value="">All wars</option>';
  battleLogFilterOptions.war.forEach(([key, label]) => {
    warSelect.innerHTML += `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`;
  });
  guildSelect.value = battleLogFilters.guild;
  seasonSelect.value = battleLogFilters.season;
  warSelect.value = battleLogFilters.war;
}

function renderBattleLogUnitFilterControl(side) {
  const key = getBattleFilterKeyForSide(side);
  const input = document.getElementById(`battle-filter-${side}-input`);
  const selectedContainer = document.getElementById(`battle-filter-${side}-selected`);
  const optionsContainer = document.getElementById(`battle-filter-${side}-options`);

  if (!input || !selectedContainer || !optionsContainer) return;

  const selectedIds = battleLogFilters[key] || [];
  const selectedSet = new Set(selectedIds);
  const filterText = String(input.value || '').trim().toLowerCase();
  const availableIds = battleLogFilterOptions[side] || [];
  const filteredIds = availableIds.filter((unitId) => unitId.toLowerCase().includes(filterText));

  selectedContainer.innerHTML = '';
  selectedIds.forEach((unitId) => {
    const isDefense = side === 'defender';
    const chipToneClasses = isDefense
      ? 'border-pink-400/45 bg-pink-900/40 text-pink-100'
      : 'border-sky-400/45 bg-sky-900/40 text-sky-100';
    const removeToneClass = isDefense ? 'text-pink-300' : 'text-sky-300';
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `inline-flex items-center gap-2 rounded-full border px-2 py-1 ${chipToneClasses}`;
    chip.setAttribute('data-unit-id', unitId);
    chip.innerHTML = `
      <img class="h-8 w-8 rounded-full object-cover" src="${escapeHtml(getBattleUnitAvatarUrlFromUnitId(unitId) || MISSING_UNIT_AVATAR_URL)}" alt="${escapeHtml(unitId)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}';">
      <span class="text-base font-semibold">${escapeHtml(unitId)}</span>
      <span class="text-sm ${removeToneClass}" aria-hidden="true">x</span>
    `;
    chip.addEventListener('click', (event) => {
      event.stopPropagation();
      battleLogFilters[key] = battleLogFilters[key].filter((id) => id !== unitId);
      syncBattleLogFiltersToUrl();
      const snapshot = guildSnapshots[activeGuildIndex];
      if (snapshot) {
        renderBattleLog(snapshot);
        toggleBattleFilterDropdown(side, true);
      }
    });
    selectedContainer.appendChild(chip);
  });

  optionsContainer.innerHTML = '';
  if (filteredIds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'px-2 py-2 text-xs text-slate-400';
    empty.textContent = 'No matching characters';
    optionsContainer.appendChild(empty);
    return;
  }

  filteredIds.forEach((unitId) => {
    const isDefense = side === 'defender';
    const selectedToneClass = isDefense ? 'bg-pink-900/45' : 'bg-sky-900/45';
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-slate-200 hover:bg-slate-700/80 ${selectedSet.has(unitId) ? selectedToneClass : ''}`;
    option.setAttribute('data-unit-id', unitId);
    option.innerHTML = `
      <img class="h-8 w-8 rounded-full object-cover" src="${escapeHtml(getBattleUnitAvatarUrlFromUnitId(unitId) || MISSING_UNIT_AVATAR_URL)}" alt="${escapeHtml(unitId)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}';">
      <span class="text-base font-semibold">${escapeHtml(unitId)}</span>
      <span class="ml-auto text-base font-bold text-cyan-300" aria-hidden="true">${selectedSet.has(unitId) ? '✓' : ''}</span>
    `;
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      if (selectedSet.has(unitId)) {
        battleLogFilters[key] = battleLogFilters[key].filter((id) => id !== unitId);
      } else {
        battleLogFilters[key] = [...battleLogFilters[key], unitId];
      }
      syncBattleLogFiltersToUrl();

      const snapshot = guildSnapshots[activeGuildIndex];
      if (snapshot) {
        renderBattleLog(snapshot);
        toggleBattleFilterDropdown(side, true);
      }

      const sideInput = document.getElementById(`battle-filter-${side}-input`);
      if (sideInput) {
        sideInput.focus();
      }
    });
    optionsContainer.appendChild(option);
  });
}

function setupBattleLogFilters() {
  if (battleLogFiltersInitialized) return;

  const sortSelect = document.getElementById('battle-filter-sort');
  const guildSelect = document.getElementById('battle-filter-guild');
  const seasonSelect = document.getElementById('battle-filter-season');
  const warSelect = document.getElementById('battle-filter-war');
  const zoneSelect = document.getElementById('battle-filter-zone');
  const resultGroup = document.getElementById('battle-filter-result-group');
  const resultButtons = resultGroup ? Array.from(resultGroup.querySelectorAll('button[data-result]')) : [];
  const modeGroup = document.getElementById('battle-filter-mode-group');
  const modeButtons = modeGroup ? Array.from(modeGroup.querySelectorAll('button[data-mode]')) : [];
  const cleanupGroup = document.getElementById('battle-filter-cleanup-group');
  const cleanupButtons = cleanupGroup ? Array.from(cleanupGroup.querySelectorAll('button[data-cleanup]')) : [];
  const attackerPlayerInput = document.getElementById('battle-filter-attacker-player-input');
  const defenderPlayerInput = document.getElementById('battle-filter-defender-player-input');
  const attackerPlayerControl = document.getElementById('battle-filter-attacker-player-control');
  const defenderPlayerControl = document.getElementById('battle-filter-defender-player-control');
  const attackerInput = document.getElementById('battle-filter-attacker-input');
  const defenderInput = document.getElementById('battle-filter-defender-input');
  const attackerControl = document.getElementById('battle-filter-attacker-control');
  const defenderControl = document.getElementById('battle-filter-defender-control');
  const clearButton = document.getElementById('battle-filter-clear');

  if (!sortSelect || !guildSelect || !seasonSelect || !warSelect || !zoneSelect || !resultGroup || resultButtons.length === 0 || !cleanupGroup || cleanupButtons.length === 0 || !attackerPlayerInput || !defenderPlayerInput || !attackerPlayerControl || !defenderPlayerControl || !attackerInput || !defenderInput || !attackerControl || !defenderControl || !clearButton) return;

  sortSelect.value = battleLogFilters.sort;
  guildSelect.value = battleLogFilters.guild;
  seasonSelect.value = battleLogFilters.season;
  warSelect.value = battleLogFilters.war;
  zoneSelect.value = battleLogFilters.zoneType || '';

  const syncResultButtons = () => {
    resultButtons.forEach((button) => {
      const value = button.getAttribute('data-result') || 'all';
      const isActive = value === battleLogFilters.result;
      button.classList.toggle('bg-emerald-900/70', isActive);
      button.classList.toggle('text-emerald-100', isActive);
      button.classList.toggle('bg-transparent', !isActive);
      button.classList.toggle('text-slate-300', !isActive);
      button.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  };

  const syncCleanupButtons = () => {
    cleanupButtons.forEach((button) => {
      const value = button.getAttribute('data-cleanup') || 'all';
      const isActive = value === battleLogFilters.cleanup;
      button.classList.toggle('bg-emerald-900/70', isActive);
      button.classList.toggle('text-emerald-100', isActive);
      button.classList.toggle('bg-transparent', !isActive);
      button.classList.toggle('text-slate-300', !isActive);
      button.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  };

  const syncModeButtons = () => {
    modeButtons.forEach((button) => {
      const value = button.getAttribute('data-mode') || 'attacks';
      const isActive = value === battleLogFilters.mode;
      button.classList.toggle('bg-cyan-900/70', isActive);
      button.classList.toggle('text-cyan-100', isActive);
      button.classList.toggle('bg-transparent', !isActive);
      button.classList.toggle('text-slate-300', !isActive);
      button.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  };

  syncResultButtons();
  if (modeButtons.length > 0) {
    syncModeButtons();
  }
  syncCleanupButtons();

  const rerenderBattleLog = () => {
    const snapshot = guildSnapshots[activeGuildIndex];
    if (!snapshot) return;
    renderBattleLog(snapshot);
  };

  sortSelect.addEventListener('change', () => {
    battleLogFilters.sort = sortSelect.value || 'newest';
    syncBattleLogFiltersToUrl();
    rerenderBattleLog();
  });

  guildSelect.addEventListener('change', () => {
    battleLogFilters.guild = guildSelect.value || '';
    syncBattleLogFiltersToUrl();
    rerenderBattleLog();
  });

  seasonSelect.addEventListener('change', () => {
    battleLogFilters.season = seasonSelect.value || '';
    syncBattleLogFiltersToUrl();
    rerenderBattleLog();
  });

  warSelect.addEventListener('change', () => {
    battleLogFilters.war = warSelect.value || '';
    syncBattleLogFiltersToUrl();
    rerenderBattleLog();
  });

  zoneSelect.addEventListener('change', () => {
    battleLogFilters.zoneType = zoneSelect.value || '';
    syncBattleLogFiltersToUrl();
    rerenderBattleLog();
  });

  resultButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const nextValue = button.getAttribute('data-result') || 'all';
      battleLogFilters.result = nextValue;
      syncBattleLogFiltersToUrl();
      syncResultButtons();
      rerenderBattleLog();
    });
  });

  if (modeButtons.length > 0) {
    modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextValue = button.getAttribute('data-mode') || 'attacks';
        battleLogFilters.mode = nextValue;
        syncBattleLogFiltersToUrl();
        syncModeButtons();
        rerenderBattleLog();
      });
    });
  }

  cleanupButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const nextValue = button.getAttribute('data-cleanup') || 'all';
      battleLogFilters.cleanup = nextValue;
      syncBattleLogFiltersToUrl();
      syncCleanupButtons();
      rerenderBattleLog();
    });
  });

  attackerPlayerInput.addEventListener('focus', () => {
    toggleBattleFilterDropdown('attacker-player', true);
    renderBattleLogPlayerFilterControl('attacker');
  });

  attackerPlayerInput.addEventListener('input', () => {
    toggleBattleFilterDropdown('attacker-player', true);
    renderBattleLogPlayerFilterControl('attacker');
  });

  defenderPlayerInput.addEventListener('focus', () => {
    toggleBattleFilterDropdown('defender-player', true);
    renderBattleLogPlayerFilterControl('defender');
  });

  defenderPlayerInput.addEventListener('input', () => {
    toggleBattleFilterDropdown('defender-player', true);
    renderBattleLogPlayerFilterControl('defender');
  });

  attackerInput.addEventListener('focus', () => {
    toggleBattleFilterDropdown('attacker', true);
    renderBattleLogUnitFilterControl('attacker');
  });

  attackerInput.addEventListener('input', () => {
    toggleBattleFilterDropdown('attacker', true);
    renderBattleLogUnitFilterControl('attacker');
  });

  defenderInput.addEventListener('focus', () => {
    toggleBattleFilterDropdown('defender', true);
    renderBattleLogUnitFilterControl('defender');
  });

  defenderInput.addEventListener('input', () => {
    toggleBattleFilterDropdown('defender', true);
    renderBattleLogUnitFilterControl('defender');
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;

    if (!attackerControl.contains(target)) {
      toggleBattleFilterDropdown('attacker', false);
    }

    if (!defenderControl.contains(target)) {
      toggleBattleFilterDropdown('defender', false);
    }

    if (!attackerPlayerControl.contains(target)) {
      toggleBattleFilterDropdown('attacker-player', false);
    }

    if (!defenderPlayerControl.contains(target)) {
      toggleBattleFilterDropdown('defender-player', false);
    }
  });

  clearButton.addEventListener('click', () => {
    battleLogFilters.sort = 'newest';
    battleLogFilters.guild = '';
    battleLogFilters.season = '';
    battleLogFilters.war = '';
    battleLogFilters.result = 'all';
    battleLogFilters.cleanup = 'all';
    battleLogFilters.mode = 'attacks';
    battleLogFilters.zoneType = '';
    battleLogFilters.attackerPlayer = '';
    battleLogFilters.defenderPlayer = '';
    battleLogFilters.attackerUnitIds = [];
    battleLogFilters.defenderUnitIds = [];
    syncBattleLogFiltersToUrl();

    sortSelect.value = 'newest';
    guildSelect.value = '';
    seasonSelect.value = '';
    warSelect.value = '';
    zoneSelect.value = '';
    battleLogFilters.result = 'all';
    battleLogFilters.cleanup = 'all';
    attackerPlayerInput.value = '';
    defenderPlayerInput.value = '';
    syncResultButtons();
    if (modeButtons.length > 0) {
      syncModeButtons();
    }
    syncCleanupButtons();
    attackerInput.value = '';
    defenderInput.value = '';
    toggleBattleFilterDropdown('attacker-player', false);
    toggleBattleFilterDropdown('defender-player', false);
    toggleBattleFilterDropdown('attacker', false);
    toggleBattleFilterDropdown('defender', false);

    rerenderBattleLog();
  });

  battleLogFiltersInitialized = true;
}

function renderBattleLog(snapshot) {
  const battleList = document.getElementById('battle-log-list');
  const battleCount = document.getElementById('battle-log-count');
  const battleFilterSummary = document.getElementById('battle-filter-summary');
  const battleWinAvg = document.getElementById('battle-log-stat-win-avg');
  const battleLossAvg = document.getElementById('battle-log-stat-loss-avg');
  const battleWinCleanup = document.getElementById('battle-log-stat-win-cleanup');
  const battleLossCleanup = document.getElementById('battle-log-stat-loss-cleanup');

  if (!battleList) return;

  const battles = Array.isArray(snapshot?.battles) ? snapshot.battles : [];
  updateBattleLogScopeFilterOptions(snapshot);
  updateBattleLogTileTypeFilterOptions(snapshot);
  updateBattleLogPlayerFilterOptions(snapshot);
  updateBattleLogUnitFilterOptions(snapshot);
  syncBattleLogFiltersToUrl();

  const activeGuildTeamIndex = Number(snapshot?.teamIndex);
  const shouldApplyGuildFilter = snapshot?.battleLogScope !== 'combined' && Number.isFinite(activeGuildTeamIndex);

  const filteredBattles = battles
    .filter((battle) => {
      const outcome = getBattleOutcome(battle);

      if (battleLogFilters.guild) {
        const matchesGuild = battle.attackerGuildName === battleLogFilters.guild
          || battle.defenderGuildName === battleLogFilters.guild;
        if (!matchesGuild) return false;
      }

      if (battleLogFilters.season && battle.seasonKey !== battleLogFilters.season) {
        return false;
      }

      if (battleLogFilters.war && battle.datasetKey !== battleLogFilters.war) {
        return false;
      }

      if (battleLogFilters.result === 'win' && outcome !== 'win') {
        return false;
      }

      if (battleLogFilters.result === 'loss' && outcome !== 'loss') {
        return false;
      }

      if (battleLogFilters.cleanup === 'yes' && !battle.cleanup) {
        return false;
      }

      if (battleLogFilters.cleanup === 'no' && !!battle.cleanup) {
        return false;
      }

      if (snapshot?.battleLogScope === 'combined') {
        const battleRole = String(battle?.battleRole || 'attack');
        if (battleLogFilters.mode === 'attacks' && battleRole !== 'attack') {
          return false;
        }

        if (battleLogFilters.mode === 'defenses' && battleRole !== 'defense') {
          return false;
        }
      }

      if (battleLogFilters.zoneType) {
        const zoneType = String(battle.zoneType || '');
        if (zoneType !== battleLogFilters.zoneType) {
          return false;
        }
      }

      if (shouldApplyGuildFilter) {
        const attackerTeamIndex = Number(battle?.attackerTeamIndex);
        const matchesGuild = attackerTeamIndex === activeGuildTeamIndex;
        if (!matchesGuild) {
          return false;
        }
      }

      if (battleLogFilters.attackerPlayer) {
        const attackerPlayerValue = getBattlePlayerFilterValue(battle, 'attacker');
        if (attackerPlayerValue !== battleLogFilters.attackerPlayer) {
          return false;
        }
      }

      if (battleLogFilters.defenderPlayer) {
        const defenderPlayerValue = getBattlePlayerFilterValue(battle, 'defender');
        if (defenderPlayerValue !== battleLogFilters.defenderPlayer) {
          return false;
        }
      }

      if (battleLogFilters.attackerUnitIds.length > 0) {
        const attackerUnitIds = getBattleSideUnitIds(battle, 'attacker');
        const matchesAllAttackerFilters = battleLogFilters.attackerUnitIds.every((unitId) => attackerUnitIds.includes(unitId));
        if (!matchesAllAttackerFilters) {
          return false;
        }
      }

      if (battleLogFilters.defenderUnitIds.length > 0) {
        const defenderUnitIds = getBattleSideUnitIds(battle, 'defender');
        const matchesAllDefenderFilters = battleLogFilters.defenderUnitIds.every((unitId) => defenderUnitIds.includes(unitId));
        if (!matchesAllDefenderFilters) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) => {
      if (battleLogFilters.sort === 'score-desc') {
        return getBattleRawScore(b) - getBattleRawScore(a);
      }

      if (battleLogFilters.sort === 'score-asc') {
        return getBattleRawScore(a) - getBattleRawScore(b);
      }

      return Number(b.createdOn || 0) - Number(a.createdOn || 0);
    });

  if (battleCount) {
    battleCount.textContent = filteredBattles.length.toLocaleString();
  }

  if (battleFilterSummary) {
    const visibleCount = filteredBattles.length;
    const totalCount = battles.length;
    if (visibleCount === totalCount) {
      battleFilterSummary.textContent = `Showing ${visibleCount.toLocaleString()} logs`;
    } else {
      battleFilterSummary.textContent = `Showing ${visibleCount.toLocaleString()} of ${totalCount.toLocaleString()} logs`;
    }
  }

  const winBattles = filteredBattles.filter((battle) => getBattleOutcome(battle) === 'win');
  const lossBattles = filteredBattles.filter((battle) => getBattleOutcome(battle) === 'loss');
  const winAverageScore = winBattles.length > 0
    ? winBattles.reduce((sum, battle) => sum + getCoreScore(getBattleRawScore(battle)).core, 0) / winBattles.length
    : 0;
  const lossAverageScore = lossBattles.length > 0
    ? lossBattles.reduce((sum, battle) => sum + getCoreScore(getBattleRawScore(battle)).core, 0) / lossBattles.length
    : 0;
  const winCleanupCount = winBattles.filter((battle) => Boolean(battle.cleanup)).length;
  const lossCleanupCount = lossBattles.filter((battle) => Boolean(battle.cleanup)).length;

  if (battleWinAvg) {
    battleWinAvg.textContent = `Win avg: ${winAverageScore.toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
  }

  if (battleLossAvg) {
    battleLossAvg.textContent = `Lose avg: ${lossAverageScore.toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
  }

  if (battleWinCleanup) {
    battleWinCleanup.textContent = `Win cleanup: ${winCleanupCount.toLocaleString()}`;
  }

  if (battleLossCleanup) {
    battleLossCleanup.textContent = `Lose cleanup: ${lossCleanupCount.toLocaleString()}`;
  }

  battleList.innerHTML = '';

  if (battles.length === 0) {
    battleList.innerHTML = '<div class="rounded-lg border border-dashed border-slate-500/40 p-3 text-slate-400">No battles found for this guild yet.</div>';
    return;
  }

  if (filteredBattles.length === 0) {
    battleList.innerHTML = '<div class="rounded-lg border border-dashed border-slate-500/40 p-3 text-slate-400">No battles match the selected filters.</div>';
    return;
  }

  filteredBattles.forEach((battle) => {
    let stateClass = 'rounded-md bg-slate-400/20 px-2 py-1 text-slate-300';
    let stateLabel = 'Neutral';
    let scoreDisplay = '<span class="inline-flex flex-row items-center gap-1"><span class="font-semibold text-slate-200">0</span></span>';
    let bonusDisplay = '';
    const cleanupHtml = battle.cleanup ? '<span class="text-emerald-400" title="Cleanup">🧹</span>' : '';

    if (battle.abandoned) {
      stateClass = 'rounded-md bg-slate-400/20 px-2 py-1 text-slate-300';
      stateLabel = 'Abandoned';
      scoreDisplay = '🛑';
    } else if (!battle.hasScore) {
      stateClass = 'rounded-md bg-rose-400/20 px-2 py-1 text-rose-200';
      stateLabel = 'Defeat';
      scoreDisplay = `<span class="inline-flex flex-row items-center gap-1"><span class="font-semibold text-slate-200">0</span>${cleanupHtml}</span>`;
    } else if (Number(battle.score || 0) > 0) {
      const { core, bonus } = getCoreScore(Number(battle.score || 0));
      stateClass = battle.defended
        ? 'rounded-md bg-rose-400/20 px-2 py-1 text-rose-200'
        : 'rounded-md bg-emerald-400/20 px-2 py-1 text-lime-100';
      stateLabel = battle.defended ? 'Defeat' : 'Win';
      scoreDisplay = `<span class="inline-flex flex-row items-center gap-1"><span class="font-semibold text-slate-200">${core.toLocaleString()}</span>${cleanupHtml}</span>`;
      bonusDisplay = bonus > 0 ? `<span class="text-xs font-semibold text-emerald-300">(${bonus.toLocaleString()})</span>` : '';
    }

    const zoneLabel = battle.zoneType ? `<span class="rounded-full border border-slate-500/50 bg-slate-900/70 px-2 py-0.5 text-xs text-slate-300">${escapeHtml(battle.zoneType)}</span>` : '';
    const easyGameBadge = isEasyGameBattle(battle)
      ? '<span class="inline-flex h-3.5 w-3.5 rounded-full border border-red-500 bg-black" title="Easy game: unregistered slot" aria-label="Easy game"></span>'
      : '';
    const attackerGuildName = String(battle?.attackerGuildName || getGuildNameByTeamIndex(battle?.attackerTeamIndex));
    const defenderGuildName = String(battle?.defenderGuildName || getGuildNameByTeamIndex(battle?.defenderTeamIndex));
    const roleLabel = snapshot?.battleLogScope === 'combined'
      ? `<span class="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-cyan-200">${escapeHtml(getBattleRoleLabel(battle.battleRole))}</span>`
      : '';
    const item = document.createElement('article');
    item.className = 'grid grid-cols-1 justify-items-center gap-3 rounded-xl border border-slate-500/30 bg-slate-900/50 p-3 text-center md:grid-cols-3 md:justify-items-stretch md:text-left';
    const attackerSideUnits = buildBattleSideUnits(battle.attackerUnits, battle.attackerMachineOfWar);
    const defenderSideUnits = buildBattleSideUnits(battle.defenderUnits, battle.defenderMachineOfWar);
    item.innerHTML = `
      <div class="flex min-w-0 flex-col items-center gap-2 text-center md:items-start md:text-left">
        <div class="truncate font-bold text-slate-200">${escapeHtml(battle.attackerName)}</div>
        <div class="truncate text-xs font-semibold uppercase tracking-wide text-cyan-300/80">${escapeHtml(attackerGuildName)}</div>
        <div class="flex flex-wrap justify-center gap-1.5 md:justify-start">${renderBattleUnits(attackerSideUnits, 'attacker')}</div>
      </div>
      <div class="flex min-w-28 flex-col items-center justify-center gap-1 text-center md:items-center">
        <span class="inline-flex items-center ${stateClass}">${scoreDisplay}</span>
        ${bonusDisplay}
        <div class="flex items-center gap-2">
          <span class="text-xs uppercase tracking-wide text-slate-300">${escapeHtml(stateLabel)}</span>
          ${easyGameBadge}
        </div>
        ${roleLabel}
        ${zoneLabel}
      </div>
      <div class="flex min-w-0 flex-col items-center gap-2 text-center md:items-end md:text-right">
        <div class="truncate font-bold text-slate-200">${escapeHtml(battle.defenderName)}</div>
        <div class="truncate text-xs font-semibold uppercase tracking-wide text-pink-300/80">${escapeHtml(defenderGuildName)}</div>
        <div class="flex flex-wrap justify-center gap-1.5 md:justify-end">${renderBattleUnits(defenderSideUnits, 'defender')}</div>
      </div>
    `;

    battleList.appendChild(item);
  });
}

function getLeaderboardSortValue(player, key) {
  if (key === 'score') return Number(player.totalScore ?? 0);
  if (key === 'average') return Number(player.averageScore ?? 0);
  if (key === 'rating') return Number(player.totalSkillRating ?? 0);
  return 0;
}

function filterLeaderboardRowsByName(rows, query) {
  if (!Array.isArray(rows)) return [];

  const searchTerm = String(query ?? '').trim().toLowerCase();
  if (!searchTerm) return rows;

  return rows.filter((player) => String(player?.name || '').toLowerCase().includes(searchTerm));
}

function sortLeaderboardRows(rows) {
  const { key, direction } = leaderboardSort;
  const dir = direction === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    const left = getLeaderboardSortValue(a, key);
    const right = getLeaderboardSortValue(b, key);

    if (left === right) {
      return String(a.name || '').localeCompare(String(b.name || '')) * dir;
    }

    return (left - right) * dir;
  });
}

function updateLeaderboardSortButtons() {
  const activeButtons = document.querySelectorAll('[data-leaderboard-sort]');
  activeButtons.forEach((button) => {
    const key = button.getAttribute('data-leaderboard-sort');
    const labelMap = {
      score: 'Score',
      average: 'Avg / token',
      rating: 'Rating'
    };
    const isActive = leaderboardSort.key === key;
    const arrow = isActive ? (leaderboardSort.direction === 'asc' ? ' ↑' : ' ↓') : '';
    button.setAttribute('aria-sort', isActive ? (leaderboardSort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
    button.innerHTML = `${labelMap[key] || key}${arrow}`;
  });
}

function setupLeaderboardSortButtons() {
  const sortButtons = document.querySelectorAll('[data-leaderboard-sort]');
  if (!sortButtons.length) return;

  sortButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.getAttribute('data-leaderboard-sort');
      if (!key) return;
      setLeaderboardSort(key);
    });
  });

  updateLeaderboardSortButtons();
}

function setLeaderboardSort(key) {
  if (leaderboardSort.key === key) {
    leaderboardSort.direction = leaderboardSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    leaderboardSort.key = key;
    leaderboardSort.direction = 'desc';
  }

  updateLeaderboardSortButtons();
  const currentSnapshot = guildSnapshots[activeGuildIndex];
  if (currentSnapshot) {
    renderTable(currentSnapshot);
  }
}

function getTokenVisual(token) {
  const tokenScore = Number(token.score || 0);
  const isUnused = !('hasScore' in token);
  const abandoned = !!token.abandoned;
  const cleanup = !!token.cleanup;
  const easyGame = !!token.easyGame;
  const tileScoreWon = Number(token.tileScore || 0) > 0;
  const showCleanupIcon = cleanup && isLegendEnabled('token', 'cleanup');
  const showEasyGameBadge = easyGame && isLegendEnabled('token', 'easy-game');
  const cleanupHtml = showCleanupIcon ? '<span class="text-emerald-400" title="Cleanup">🧹</span>' : '';
  const easyGameBadge = showEasyGameBadge
    ? getEasyGameBadgeHtml({ easyGame, tileScore: Number(token.tileScore || 0), includeBuildingIcon: tileScoreWon })
    : '';
  const cleanupAndEasyGameHtml = `${cleanupHtml}${easyGameBadge}`;
  const outcomeKey = getTokenLegendOutcomeKey(token);
  const showOutcomeStyle = isLegendEnabled('token', outcomeKey);

  let display = '';
  let stateClass = showOutcomeStyle
    ? 'rounded-md bg-slate-400/20 px-2 py-1 text-slate-300'
    : 'rounded-md px-2 py-1 text-slate-200';

  if (isUnused) {
    display = '—';
    stateClass = showOutcomeStyle
      ? 'rounded-md bg-slate-400/20 px-2 py-1 text-slate-300'
      : 'rounded-md px-2 py-1 text-slate-200';
  } else if (abandoned) {
    display = '🛑';
    stateClass = showOutcomeStyle
      ? 'rounded-md bg-slate-400/20 px-2 py-1 text-slate-300'
      : 'rounded-md px-2 py-1 text-slate-200';
  } else if (!token.hasScore) {
    display = `<span class="inline-flex flex-row items-center gap-1"><span class="font-semibold text-slate-200">0</span>${cleanupAndEasyGameHtml}</span>`;
    stateClass = showOutcomeStyle
      ? 'rounded-md bg-rose-400/20 px-2 py-1 text-rose-200'
      : 'rounded-md px-2 py-1 text-slate-200';
  } else if (tokenScore > 0) {
    display = showCleanupIcon
      ? `<span class="inline-flex flex-row items-center gap-1"><span class="font-semibold text-slate-200">${tokenScore.toLocaleString()}</span>${cleanupAndEasyGameHtml}</span>`
      : `<span class="inline-flex flex-row items-center gap-1">${formatValue(tokenScore)}${easyGameBadge}</span>`;
    if (showOutcomeStyle) {
      stateClass = token.defended
        ? 'rounded-md bg-rose-400/20 px-2 py-1 text-rose-200'
        : 'rounded-md bg-emerald-400/20 px-2 py-1 text-lime-100';
    } else {
      stateClass = 'rounded-md px-2 py-1 text-slate-200';
    }
  } else {
    display = `<span class="inline-flex flex-row items-center gap-1"><span class="font-semibold text-slate-200">0</span>${cleanupAndEasyGameHtml}</span>`;
    stateClass = showOutcomeStyle
      ? 'rounded-md bg-slate-400/20 px-2 py-1 text-slate-300'
      : 'rounded-md px-2 py-1 text-slate-200';
  }

  const tierKey = getTokenScoreTierKey(token);
  if (tierKey === 'gold' && isLegendEnabled('scoreTier', 'gold')) {
      stateClass += ' outline outline-2 outline-offset-2 outline-amber-400';
    } else if (tierKey === 'silver' && isLegendEnabled('scoreTier', 'silver')) {
      stateClass += ' outline outline-2 outline-offset-2 outline-zinc-300';
    } else if (tierKey === 'bronze' && isLegendEnabled('scoreTier', 'bronze')) {
      stateClass += ' outline outline-2 outline-offset-2 outline-amber-700';
    }

  return {
    display,
    stateClass,
    buffsHtml: renderBuffs(token.buffs)
  };
}

function renderTable(snapshot) {
  updateLeaderboardSortButtons();
  const leaderboardBody = document.getElementById('leaderboard-body');
  const leaderboardCards = document.getElementById('leaderboard-cards');
  const leaderboardSearchInput = document.getElementById('leaderboard-player-search');

  if (leaderboardSearchInput && leaderboardSearchInput.value !== leaderboardSearch) {
    leaderboardSearchInput.value = leaderboardSearch;
  }

  if (!leaderboardBody) return;

  leaderboardBody.innerHTML = '';
  if (leaderboardCards) leaderboardCards.innerHTML = '';

  if (!snapshot || !Array.isArray(snapshot.players) || snapshot.players.length === 0) {
    const loadingSlots = 30;
    const skeletonRow = Array.from({ length: loadingSlots }, () => {
      const avatarCell = `
        <td class="sticky left-0 z-10 min-w-[15rem] whitespace-nowrap bg-slate-900/95 px-4 py-3 font-semibold text-slate-50" style="width: max-content;">
          <div class="flex items-center gap-2">
            <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-700/70 animate-pulse"></span>
            <div class="h-4 w-24 animate-pulse rounded bg-slate-700/70"></div>
          </div>
        </td>
      `;
      const tokenCells = Array.from({ length: 10 }, () => `
        <td class="px-4 py-3">
          <div class="flex min-h-8 w-full items-center justify-center">
            <div class="h-7 w-10 animate-pulse rounded-md bg-slate-700/60"></div>
          </div>
        </td>
      `).join('');
      const statCells = `
        <td class="px-4 py-3"><div class="h-4 w-12 animate-pulse rounded bg-slate-700/60"></div></td>
        <td class="px-4 py-3"><div class="h-4 w-12 animate-pulse rounded bg-slate-700/60"></div></td>
        <td class="px-4 py-3"><div class="h-4 w-12 animate-pulse rounded bg-slate-700/60"></div></td>
      `;
      return `<tr class="transition-colors duration-150">${avatarCell}${tokenCells}${statCells}</tr>`;
    }).join('');

    leaderboardBody.innerHTML = skeletonRow;

    if (leaderboardCards) {
      const skeletonCard = Array.from({ length: loadingSlots }, () => `
        <article class="rounded-xl border border-slate-500/30 bg-slate-900/60 p-4">
          <div class="mb-3 flex items-center gap-2">
            <span class="inline-flex h-6 w-6 shrink-0 animate-pulse rounded-full bg-slate-700/70"></span>
            <span class="inline-flex h-6 w-6 animate-pulse rounded-full bg-slate-700/70"></span>
            <div class="min-w-0 flex-1">
              <div class="h-4 w-20 animate-pulse rounded bg-slate-700/70"></div>
              <div class="mt-2 h-3 w-16 animate-pulse rounded bg-slate-700/60"></div>
            </div>
          </div>
          <div class="mb-3 grid grid-cols-3 gap-2 text-xs">
            <div class="rounded-md border border-slate-700/60 bg-slate-900/60 p-2"><div class="h-3 w-8 animate-pulse rounded bg-slate-700/60"></div><div class="mt-2 h-4 w-10 animate-pulse rounded bg-slate-700/60"></div></div>
            <div class="rounded-md border border-slate-700/60 bg-slate-900/60 p-2"><div class="h-3 w-8 animate-pulse rounded bg-slate-700/60"></div><div class="mt-2 h-4 w-10 animate-pulse rounded bg-slate-700/60"></div></div>
            <div class="rounded-md border border-slate-700/60 bg-slate-900/60 p-2"><div class="h-3 w-8 animate-pulse rounded bg-slate-700/60"></div><div class="mt-2 h-4 w-10 animate-pulse rounded bg-slate-700/60"></div></div>
          </div>
          <div class="flex flex-wrap gap-2">
            ${Array.from({ length: 10 }, () => '<div class="min-w-[4.5rem] flex-1 basis-[4.5rem] rounded-md bg-slate-900/40 p-1.5"><div class="h-7 w-full animate-pulse rounded-md bg-slate-700/60"></div></div>').join('')}
          </div>
        </article>
      `).join('');
      leaderboardCards.innerHTML = skeletonCard;
    }

    return;
  }

  const summary = summarizeGuild(snapshot);
  const rows = sortLeaderboardRows(filterLeaderboardRowsByName(summary.rows, leaderboardSearch));

  if (!rows.length) {
    const emptyMessage = leaderboardSearch ? `No players match “${escapeHtml(leaderboardSearch)}”.` : 'No players available.';
    leaderboardBody.innerHTML = `
      <tr>
        <td colspan="14" class="px-4 py-10 text-center text-sm text-slate-400">
          ${emptyMessage}
        </td>
      </tr>
    `;

    if (leaderboardCards) {
      leaderboardCards.innerHTML = `
        <div class="rounded-xl border border-slate-700/60 bg-slate-900/50 p-6 text-center text-sm text-slate-400">
          ${emptyMessage}
        </div>
      `;
    }

    return;
  }

  rows.forEach((player, index) => {
    const row = document.createElement('tr');
    row.className = 'transition-colors duration-150 hover:bg-cyan-400/10';
    const avatarHtml = renderPlayerAvatar(player);

    const cells = [
      `<td class="sticky left-0 z-10 min-w-[15rem] whitespace-nowrap bg-slate-900/95 px-4 py-3 font-semibold text-slate-50" style="width: max-content;"><div class="flex items-center gap-2"><span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-400/20 text-xs font-bold text-cyan-100">${index + 1}</span>${avatarHtml}<div class="min-w-0 flex-1"><div class="flex min-w-0 items-center justify-between gap-3"><span class="truncate whitespace-nowrap">${escapeHtml(player.name)}</span><span class="shrink-0 font-normal text-slate-400">(<span class="${getTokenCountColorClass(player.usedTokens)}">${player.usedTokens}</span>/10)</span></div></div></div></td>`,
      ...player.tokens.map((token) => {
        const tokenVisual = getTokenVisual(token);
        const tokenContent = `<span class="inline-flex items-center justify-center ${tokenVisual.stateClass}">${tokenVisual.display}</span>${tokenVisual.buffsHtml}`;
        return `<td class="px-4 py-3"><div class="flex min-h-8 w-full flex-col items-center justify-center gap-1">${tokenContent}</div></td>`;
      }),
      `<td class="px-4 py-3"><span class="font-semibold text-amber-300">${player.totalScore.toLocaleString()}</span></td>`,
      `<td class="px-4 py-3"><span class="text-cyan-300">${player.averageScore.toLocaleString()}</span></td>`,
      `<td class="px-4 py-3"><span class="text-violet-300 font-semibold">${player.totalSkillRating.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></td>`
    ];

    row.innerHTML = cells.join('');
    leaderboardBody.appendChild(row);

    if (leaderboardCards) {
      const orderedTokens = [...player.tokens].sort((a, b) => {
        const aScore = Number(a?.score || 0);
        const bScore = Number(b?.score || 0);
        const aUsed = !!a && Boolean(a.hasScore) && !a.abandoned;
        const bUsed = !!b && Boolean(b.hasScore) && !b.abandoned;

        if (aUsed !== bUsed) {
          return aUsed ? -1 : 1;
        }

        return bScore - aScore;
      });

      const tokenCards = orderedTokens.map((token) => {
        const tokenVisual = getTokenVisual(token);
        const tokenContent = `<div class="inline-flex items-center justify-center ${tokenVisual.stateClass}">${tokenVisual.display}</div><div class="mt-1.5">${tokenVisual.buffsHtml}</div>`;
        return `
          <div class="min-w-[4.5rem] flex-1 basis-[4.5rem] rounded-md bg-slate-900/40 p-1.5 text-center">
            ${tokenContent}
          </div>
        `;
      }).join('');

      const card = document.createElement('article');
      card.className = 'rounded-xl border border-slate-500/30 bg-slate-900/60 p-4';
      card.innerHTML = `
        <div class="mb-3 flex items-center gap-2">
          <span class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-400/20 text-xs font-bold text-cyan-100">${index + 1}</span>
          ${avatarHtml}
          <div class="min-w-0">
            <div class="truncate font-semibold text-slate-100">${escapeHtml(player.name)}</div>
            <div class="text-xs text-slate-400"><span class="font-semibold ${getTokenCountColorClass(player.usedTokens)}">${player.usedTokens}</span>/10 used</div>
          </div>
        </div>
        <div class="mb-3 grid grid-cols-3 gap-2 text-xs">
          <div class="rounded-md border border-amber-400/25 bg-amber-500/10 p-2">
            <div class="text-slate-400">Score</div>
            <div class="font-semibold text-amber-300">${player.totalScore.toLocaleString()}</div>
          </div>
          <div class="rounded-md border border-cyan-400/25 bg-cyan-500/10 p-2">
            <div class="text-slate-400">Avg</div>
            <div class="font-semibold text-cyan-300">${player.averageScore.toLocaleString()}</div>
          </div>
          <div class="rounded-md border border-violet-400/25 bg-violet-500/10 p-2">
            <div class="text-slate-400">Rating</div>
            <div class="font-semibold text-violet-300">${player.totalSkillRating.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">${tokenCards}</div>
      `;
      leaderboardCards.appendChild(card);
    }
  });

  const playerCount = document.getElementById('player-count');
  const tokensUsed = document.getElementById('tokens-used');
  const tokenScoreDisplay = document.getElementById('token-score-display');
  const tilesCleared = document.getElementById('tiles-cleared');
  const tilesScore = document.getElementById('tiles-score');
  const totalWinsEl = document.getElementById('total-wins');
  const totalDefeatsEl = document.getElementById('total-defeats');
  const totalAbandonedEl = document.getElementById('total-abandoned');
  const totalUnusedEl = document.getElementById('total-unused');
  const totalPlayers = summary.totalPlayers;
  const totalTokenSlots = summary.totalTokenSlots;
  const usedTokensTotal = summary.usedTokens;
  const guildTotalScore = summary.tokenScore;
  const possibleScore = totalTokenSlots * MAX_TOKEN_SCORE;
  const scorePercentage = possibleScore > 0 ? Math.round((guildTotalScore / possibleScore) * 100) : 0;
  const totalTilesCleared = rows.reduce((sum, player) => sum + player.tilesCleared, 0);
  const totalTileScore = summary.tileScore;
  const possibleTileScore = POSSIBLE_TILE_SCORE;
  const tileScorePercentage = possibleTileScore > 0 ? Math.round((totalTileScore / possibleTileScore) * 100) : 0;
  const totalWins = rows.reduce((sum, player) => sum + player.tokens.reduce((tokenSum, token) => {
    if (!('hasScore' in token) || token.abandoned || !token.hasScore) return tokenSum;
    return tokenSum + (Number(token.score || 0) > 0 ? 1 : 0);
  }, 0), 0);
  const totalDefeats = rows.reduce((sum, player) => sum + player.tokens.reduce((tokenSum, token) => {
    if (!('hasScore' in token) || token.abandoned) return tokenSum;
    return tokenSum + ((token.defended || !token.hasScore) ? 1 : 0);
  }, 0), 0);
  const totalAbandoned = rows.reduce((sum, player) => sum + player.tokens.reduce((tokenSum, token) => tokenSum + (token.abandoned ? 1 : 0), 0), 0);
  const totalUnused = rows.reduce((sum, player) => sum + player.tokens.reduce((tokenSum, token) => tokenSum + (!('hasScore' in token) ? 1 : 0), 0), 0);

  if (playerCount) playerCount.textContent = totalPlayers.toString();
  const usedPercentage = totalTokenSlots > 0 ? Math.round((usedTokensTotal / totalTokenSlots) * 100) : 0;
  if (tokensUsed) tokensUsed.textContent = `${usedTokensTotal}/${totalTokenSlots} (${usedPercentage}%)`;
  if (tokenScoreDisplay) tokenScoreDisplay.textContent = `${guildTotalScore.toLocaleString()}/${possibleScore.toLocaleString()} (${scorePercentage}%)`;
  if (tilesCleared) tilesCleared.textContent = `${totalTilesCleared}/30 (${Math.round((totalTilesCleared / 30) * 100)}%)`;
  if (tilesScore) tilesScore.textContent = `${totalTileScore.toLocaleString()}/${possibleTileScore.toLocaleString()} (${tileScorePercentage}%)`;
  if (totalWinsEl) totalWinsEl.textContent = totalWins.toString();
  if (totalDefeatsEl) totalDefeatsEl.textContent = totalDefeats.toString();
  if (totalAbandonedEl) totalAbandonedEl.textContent = totalAbandoned.toString();
  if (totalUnusedEl) totalUnusedEl.textContent = totalUnused.toString();

  applyLeaderboardLayout();
}

function renderBuffLegend(snapshot) {
  const legendContainer = document.getElementById('buff-legend');
  if (!legendContainer) return;

  if (legendFilterLoading && !snapshot) {
    legendContainer.innerHTML = `
      <div class="flex flex-wrap items-start justify-start gap-3">
        <div class="flex min-h-[2.25rem] items-center justify-center rounded-md border border-slate-400/20 bg-slate-900/35 px-3 py-2">
          <span class="block h-4 w-16 animate-pulse rounded-full bg-slate-700/70"></span>
        </div>
      </div>
    `;
    setupLegendVisibilityToggle();
    return;
  }

  legendBlockKeys = {
    token: ['abandoned', 'cleanup', 'easy-game'],
    scoreTier: [],
    buff: []
  };

  const seen = new Map();
  const guild = snapshot || guildSnapshots[activeGuildIndex];

  (guild?.players || []).forEach((p) => {
    (p.tokens || []).forEach((t) => {
      (t.buffs || []).forEach((b) => {
        const name = (b && (b.abilityId || b.name || b.id)) || String(b || '');
        if (name && !seen.has(name)) seen.set(name, colorFor(name));
      });
    });
  });

  const buffLegendEntries = Array.from(seen.entries()).map(([name, color]) => ({
    name,
    color,
    key: makeLegendBuffKey(name)
  }));

  legendBlockKeys.buff = buffLegendEntries.map((entry) => entry.key).filter(Boolean);
  legendBlockKeys.buff.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(legendVisibility.buff, key)) {
      legendVisibility.buff[key] = false;
    }
  });

  const pillClasses = (enabled) => `inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-slate-400/20 bg-slate-900/60 px-2 py-1 text-sm transition ${enabled ? 'text-blue-100 hover:border-cyan-300/50 hover:bg-slate-900/80' : 'text-slate-400 opacity-45 grayscale saturate-50 hover:opacity-70'}`;

  const makeItem = ({ block, key, iconHtml, label }) => {
    const enabled = isLegendEnabled(block, key);
    return `<span data-legend-item="false" data-legend-block="${block}" data-legend-key="${key}" class="${pillClasses(enabled)} cursor-default select-none pointer-events-none" aria-disabled="true"><span class="inline-flex h-5 w-5 items-center justify-center">${iconHtml}</span><span class="font-semibold">${escapeHtml(label)}</span></span>`;
  };

  const tokenItems = [
    makeItem({ block: 'token', key: 'abandoned', iconHtml: '⬜', label: 'Abandoned' }),
    makeItem({ block: 'token', key: 'cleanup', iconHtml: '🧹', label: 'Cleanup' }),
    makeItem({ block: 'token', key: 'easy-game', iconHtml: '<span class="inline-flex h-2.5 w-2.5 rounded-full border border-red-500 bg-black"></span>', label: 'NPC' })
  ];

  const legendMarkup = [
    ...tokenItems
  ].join('');

  legendContainer.innerHTML = `
    <div class="flex flex-wrap items-center justify-start gap-2" aria-readonly="true">
      ${legendMarkup}
    </div>
  `;

  setupLegendVisibilityToggle();
}

async function loadGuildData() {
  await loadDatasetManifest();

  activeDatasetKey = Object.prototype.hasOwnProperty.call(DATASETS, activeDatasetKey)
    ? activeDatasetKey
    : getDatasetKeyFromUrl();
  updateDatasetInUrl(activeDatasetKey);

  legendFilterLoading = true;

  const statusMessage = document.getElementById('status-message');
  const lastUpdatedEl = document.getElementById('last-updated');
  const dataset = DATASETS[activeDatasetKey];

  if (!dataset) {
    console.error(`Unknown dataset key: ${activeDatasetKey}`);
    return;
  }

  renderDatasetTabs();
  setupLeaderboardLayoutToggle();
  setupLeaderboardSortButtons();
  setupLeaderboardSearch();
  setupLegendVisibilityToggle();
  loadBattleLogFiltersFromUrl();
  setupBattleLogFilters();

  guildProjectionLoading = true;
  guildTabsLoading = true;
  activeSeasonWarRecords = [];
  setWarSummaryVisibility(Boolean(selectedWarDatasetKey));
  renderWarSeasonCards([]);
  renderGuildTokenProjectionTable();
  renderGuildTabs();
  renderTable(null);

  if (statusMessage) {
    statusMessage.textContent = `Loading ${dataset.label.toLowerCase()} data...`;
  }
  if (lastUpdatedEl) {
    lastUpdatedEl.textContent = 'Loading...';
  }
  try {
    await initializePortraitMapper();
    setupDefencesPlayerSearch();
    setupAttacksPlayerSearch();
    renderDefences();
    renderAttacks();
    loadDefenseHistory();
    loadAttackHistory();
    const season = seasonGroups.find((group) => group.entries.some(([key]) => key === activeDatasetKey));
    const seasonEntries = season?.entries || [[activeDatasetKey, dataset]];
    const records = await Promise.all(seasonEntries.map(async ([key, seasonDataset]) => {
      const response = await fetch(seasonDataset.url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Unable to fetch JSON (${response.status})`);
      const data = await response.json();
      const snapshots = buildSnapshot(data);
      const targetTeamIndex = getPrimaryGuildTeamIndexFromData(data);
      const targetGuildName = getPrimaryGuildNameFromData(data);
      const targetSnapshot = pickGuildSnapshotForAllWars(snapshots, targetTeamIndex, targetGuildName);
      const opponentSnapshot = snapshots.find((snapshot) => Number(snapshot?.teamIndex) !== Number(targetSnapshot?.teamIndex)) || null;
      return { dataset: { key, ...seasonDataset }, data, responseLastModified: response.headers.get('last-modified'), snapshots, targetSnapshot, opponentSnapshot };
    }));
    activeSeasonWarRecords = records;
    if (!selectedWarDatasetKey && records[0]) {
      selectedWarDatasetKey = records[0].dataset.key;
      activeDatasetKey = selectedWarDatasetKey;
    }
    renderWarSeasonCards(records);
    const activeRecord = records.find((record) => record.dataset.key === activeDatasetKey) || records[0];
    if (!activeRecord) throw new Error('No wars found for selected season.');
    const data = activeRecord.data;
    const responseLastModified = activeRecord.responseLastModified;
    const dataTimestamp = getLatestActivityTimestamp(data);

    renderLastUpdated({ responseLastModified, dataTimestamp });

    guildSnapshots = buildSnapshot(data);
    activeGuildIndex = getDefaultActiveGuildIndex(guildSnapshots);
    guildProjectionLoading = false;
    guildTabsLoading = false;
    legendFilterLoading = false;
    renderGuildTokenProjectionTable();
    if (AppNav.get('warView') !== 'log') renderActiveGuild();
    renderDatasetTabs();
    setWarSummaryVisibility(Boolean(selectedWarDatasetKey));

    if (statusMessage) {
      statusMessage.textContent = `Loaded ${guildSnapshots[activeGuildIndex]?.players.length || 0} players for ${guildSnapshots[activeGuildIndex]?.name || 'the selected guild'} from ${dataset.label.toLowerCase()}.`;
    }
  } catch (error) {
    console.error(error);
    await initializePortraitMapper();
    guildSnapshots = [buildFallbackSnapshot()];
    activeGuildIndex = getDefaultActiveGuildIndex(guildSnapshots);
    guildProjectionLoading = false;
    guildTabsLoading = false;
    legendFilterLoading = false;
    renderLastUpdated({ responseLastModified: null, dataTimestamp: null });
    renderGuildTokenProjectionTable();
    if (AppNav.get('warView') !== 'log') renderActiveGuild();
    renderDatasetTabs();

    if (statusMessage) {
      statusMessage.textContent = `The ${dataset.label.toLowerCase()} JSON could not be loaded. Open the app from a local web server to enable fetch().`;
    }
  }
}

if (typeof document !== 'undefined') {
  const currentPage = String(document.body?.dataset?.page || '').trim();
  if (currentPage === 'battle-log') {
    setupBattleLogPageTabs();
    loadAllWarsBattleLogData();
  } else {
    loadGuildData();
  }
}

function setupLeaderboardSearch() {
  const searchInput = document.getElementById('leaderboard-player-search');
  if (!searchInput) return;

  searchInput.value = leaderboardSearch;
  searchInput.addEventListener('input', (event) => {
    leaderboardSearch = String(event.target.value || '').trim();
    const currentSnapshot = guildSnapshots[activeGuildIndex];
    if (currentSnapshot) {
      renderTable(currentSnapshot);
    }
  });
}

if (typeof module !== 'undefined') {
  module.exports = { shouldDisplayCurrentDataset, isEasyGameBattle, buildSnapshot, getCoreScore, isLegendEnabled, getEasyGameBadgeHtml, filterLeaderboardRowsByName };
}
