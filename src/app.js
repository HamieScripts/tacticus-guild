const DEFAULT_DATASETS = {
  current: {
    label: 'Active war',
    sourceLabel: 'Current snapshot',
    url: './data/current/live-war.json'
  },
  history: {
    label: 'History snapshot',
    sourceLabel: 'History snapshot',
    url: './data/history/65648500-b63c-4a80-8862-c36e9e7d800f.json'
  }
};

let DATASETS = { ...DEFAULT_DATASETS };
let datasetsLoaded = false;

let activeDatasetKey = 'current';

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

    if (!key || !label || !sourceLabel || !url) return;

    normalized[key] = { label, sourceLabel, url };
  });

  return Object.keys(normalized).length > 0 ? normalized : null;
}

async function loadDatasetManifest() {
  if (datasetsLoaded) return;

  try {
    const response = await fetch('./data/dataset-manifest.json', { cache: 'no-store' });
    if (response.ok) {
      const manifest = await response.json();
      const normalized = normalizeDatasets(manifest?.datasets);
      if (normalized) {
        DATASETS = normalized;
      }
    }
  } catch (error) {
    DATASETS = { ...DEFAULT_DATASETS };
  }

  datasetsLoaded = true;
}

function updateDatasetInUrl(datasetKey) {
  const params = new URLSearchParams(window.location.search);
  params.set('dataset', datasetKey);
  const newQuery = params.toString();
  const newUrl = `${window.location.pathname}${newQuery ? `?${newQuery}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', newUrl);
}

let guildSnapshots = [];
let activeGuildIndex = 0;
let unitPortraitMap = {};
const MISSING_UNIT_AVATAR_URL = './img/missing-unit.svg';
const battleLogFilters = {
  sort: 'newest',
  result: 'all',
  zoneType: '',
  attackerPlayer: '',
  defenderPlayer: '',
  attackerUnitIds: [],
  defenderUnitIds: []
};
const battleLogFilterOptions = {
  attacker: [],
  defender: []
};
const battleLogPlayerFilterOptions = {
  attacker: [],
  defender: []
};
let battleLogTileTypeOptions = [];
let battleLogFiltersInitialized = false;
let leaderboardLayout = 'table';
let leaderboardLayoutInitialized = false;
let legendVisibilityInitialized = false;
const legendVisibility = {
  token: {
    win: true,
    defeat: true,
    abandoned: true,
    cleanup: true
  },
  scoreTier: {
    bronze: true,
    silver: true,
    gold: true
  },
  buff: {}
};
let legendBlockKeys = {
  token: ['win', 'defeat', 'abandoned', 'cleanup'],
  scoreTier: ['bronze', 'silver', 'gold'],
  buff: []
};

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
  return Boolean(legendVisibility?.[block]?.[key] ?? true);
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
  if (legendVisibilityInitialized) return;

  const legendContainer = document.getElementById('buff-legend');
  if (!legendContainer) return;

  legendContainer.addEventListener('click', (event) => {
    const itemBtn = event.target.closest('[data-legend-item="true"]');
    if (itemBtn) {
      const block = itemBtn.getAttribute('data-legend-block');
      const key = itemBtn.getAttribute('data-legend-key');
      if (!block || !key) return;

      setLegendEnabled(block, key, !isLegendEnabled(block, key));
      rerenderLeaderboardFromLegendToggle();
      return;
    }

    const titleBtn = event.target.closest('[data-legend-title="true"]');
    if (!titleBtn) return;

    const block = titleBtn.getAttribute('data-legend-block');
    if (!block) return;

    const keys = Array.isArray(legendBlockKeys[block]) ? legendBlockKeys[block].filter(Boolean) : [];
    if (keys.length === 0) return;

    const enabledCount = keys.reduce((count, key) => count + (isLegendEnabled(block, key) ? 1 : 0), 0);
    const allEnabled = enabledCount === keys.length;
    const hasMixedState = enabledCount > 0 && enabledCount < keys.length;
    const nextEnabled = hasMixedState ? true : !allEnabled;

    keys.forEach((key) => setLegendEnabled(block, key, nextEnabled));
    rerenderLeaderboardFromLegendToggle();
  });

  legendVisibilityInitialized = true;
}

function getCoreScore(value) {
  const numericValue = Number(value) || 0;

  if (numericValue > 1600) {
    const bonus = Math.floor(numericValue / 1000) * 1000;
    const core = numericValue - bonus;
    return { core, bonus };
  }

  return { core: numericValue, bonus: 0 };
}

function formatValue(value) {
  if (value === null || value === undefined || value === 0) return '—';

  const { core, bonus } = getCoreScore(value);

  if (bonus > 0) {
    return `<span class="inline-flex flex-col items-start gap-0.5"><span class="font-semibold text-slate-200">${core.toLocaleString()}</span><span class="text-xs font-medium text-slate-500">(${bonus.toLocaleString()})</span></span>`;
  }

  return `<span class="inline-flex flex-col items-start gap-0.5"><span class="font-semibold text-slate-200">${core.toLocaleString()}</span></span>`;
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
  const eventResponseData = getPrimaryEventResponseData(data);
  const playerData = eventResponseData?.playerData || [];
  const activityLogs = eventResponseData?.activityLogs || [];
  const guildData = eventResponseData?.guildData || [];
  const playerNames = new Map(playerData.map((player) => [player.userId, player.displayName]));
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
    assignTeamIfValid(userId, teamIndex);

    if (log?.type === 'battleFinished') {
      const defenderUserId = log?.defender?.userId;
      const opposingTeamIndex = getOpposingTeamIndex(teamIndex);
      if (defenderUserId && Number.isFinite(opposingTeamIndex)) {
        assignTeamIfValid(defenderUserId, opposingTeamIndex);
      }
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
      buffs
    });

    bucket.get(userId).push({ score: entryScore, tileScore, skillRating, abandoned, defended, cleanup, hasScore, buffs });

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
      usedTokens: player.usedTokens ?? player.tokens.filter((entry) => Object.prototype.hasOwnProperty.call(entry, 'hasScore')).length,
      totalScore: player.totalScore ?? player.tokens.reduce((sum, entry) => sum + (entry.abandoned ? 0 : entry.score), 0),
      averageScore: player.averageScore ?? (player.usedTokens > 0 ? Math.round(player.totalScore / player.usedTokens) : 0),
      totalSkillRating: player.totalSkillRating ?? player.tokens.reduce((sum, entry) => sum + (entry.skillRating || 0), 0)
    }))
    .sort((a, b) => b.totalScore - a.totalScore);
}

function summarizeGuild(snapshot) {
  const rows = buildRows(snapshot);
  const isUsedToken = (token) => token && typeof token === 'object' && Object.prototype.hasOwnProperty.call(token, 'hasScore');
  const totalPlayers = rows.length;
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

  if (!Array.isArray(guildSnapshots) || guildSnapshots.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="10" class="py-2 text-slate-300/80">No guild data loaded.</td></tr>';
    return;
  }

  const summaries = guildSnapshots.map((snapshot) => summarizeGuild(snapshot));
  const activeTeamIndex = guildSnapshots[activeGuildIndex]?.teamIndex;

  summaries
    .sort((a, b) => {
      const aIsActive = Number(a.teamIndex) === Number(activeTeamIndex);
      const bIsActive = Number(b.teamIndex) === Number(activeTeamIndex);

      if (aIsActive !== bIsActive) {
        return aIsActive ? -1 : 1;
      }

      return b.projectedTokenScore - a.projectedTokenScore;
    })
    .forEach((guild) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="py-1 pr-3 font-semibold text-emerald-100">${escapeHtml(guild.name)}</td>
        <td class="py-1 pr-3 text-slate-200">${guild.totalTokenSlots.toLocaleString()}</td>
        <td class="py-1 pr-3 text-slate-200">${guild.usedTokens.toLocaleString()}</td>
        <td class="py-1 pr-3 text-slate-200">${guild.remainingTokens.toLocaleString()}</td>
        <td class="py-1 pr-3 text-slate-200">${guild.totalWins.toLocaleString()} (${guild.totalCleanupWins.toLocaleString()}🧹)</td>
        <td class="py-1 pr-3 text-slate-200">${guild.totalDefeats.toLocaleString()}</td>
        <td class="py-1 pr-3 text-slate-200">${guild.totalAbandoned.toLocaleString()}</td>
        <td class="py-1 pr-3 text-cyan-200">${guild.avgPerUsedToken.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
        <td class="py-1 font-semibold text-emerald-200">${guild.projectedTokenScore.toLocaleString()}</td>
      `;
      tableBody.appendChild(row);
    });
}

function renderGuildTabs() {
  const tabsContainer = document.getElementById('guild-tabs');

  if (!tabsContainer) return;

  tabsContainer.innerHTML = '';

  guildSnapshots.forEach((guild, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `rounded-full border px-4 py-2 text-sm font-semibold transition ${index === activeGuildIndex ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200 shadow-lg shadow-cyan-500/10' : 'border-slate-700 bg-slate-800/70 text-slate-300 hover:border-slate-500 hover:text-white'}`;
    button.textContent = guild.name;
    button.addEventListener('click', () => {
      activeGuildIndex = index;
      renderActiveGuild();
    });

    tabsContainer.appendChild(button);
  });
}

function renderDatasetTabs() {
  const datasetSelect = document.getElementById('dataset-select');
  const sourceLabel = document.getElementById('source-label');

  if (!datasetSelect) return;

  datasetSelect.innerHTML = '';

  Object.entries(DATASETS).forEach(([datasetKey, dataset]) => {
    const option = document.createElement('option');
    option.value = datasetKey;
    option.textContent = dataset.label;
    datasetSelect.appendChild(option);
  });

  if (!datasetSelect.dataset.initialized) {
    datasetSelect.addEventListener('change', (event) => {
      const selectedKey = event.target.value;
      if (!Object.prototype.hasOwnProperty.call(DATASETS, selectedKey)) return;
      if (selectedKey === activeDatasetKey) return;

      activeDatasetKey = selectedKey;
      updateDatasetInUrl(activeDatasetKey);
      loadGuildData();
    });

    datasetSelect.dataset.initialized = 'true';
  }

  datasetSelect.value = activeDatasetKey;

  if (sourceLabel) {
    sourceLabel.textContent = DATASETS[activeDatasetKey]?.sourceLabel || 'Unknown source';
  }
}

function renderActiveGuild() {
  const snapshot = guildSnapshots[activeGuildIndex];

  if (!snapshot) return;

  renderTable(snapshot);
  renderBuffLegend(snapshot);
  renderBattleLog(snapshot);
  renderGuildTabs();
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
  if (!tableWrap || !cardsWrap) return;

  const useCards = leaderboardLayout === 'cards';
  tableWrap.classList.toggle('hidden', useCards);
  cardsWrap.classList.toggle('hidden', !useCards);
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

function getBattleUnitAvatarUrl(unit) {
  if (!unit || typeof unit !== 'object') return null;

  const exactUnitId = getBattleUnitId(unit);
  return getBattleUnitAvatarUrlFromUnitId(exactUnitId);
}

function getBattleUnitAvatarUrlFromUnitId(unitId) {
  const exactUnitId = String(unitId || '').trim();
  if (!exactUnitId) return null;
  const lowerUnitId = exactUnitId.toLowerCase();
  const mappedFile = unitPortraitMap[exactUnitId] || unitPortraitMap[lowerUnitId];

  if (mappedFile) {
    return `./img/${mappedFile}`;
  }

  return MISSING_UNIT_AVATAR_URL;
}

async function loadUnitPortraitMap() {
  try {
    const response = await fetch('./data/static/unit-portrait-map.json', { cache: 'no-store' });
    if (!response.ok) {
      unitPortraitMap = {};
      return;
    }

    const json = await response.json();
    unitPortraitMap = json && typeof json === 'object' ? json : {};
  } catch (error) {
    unitPortraitMap = {};
  }
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
  const zoneSelect = document.getElementById('battle-filter-zone');
  const resultGroup = document.getElementById('battle-filter-result-group');
  const resultButtons = resultGroup ? Array.from(resultGroup.querySelectorAll('button[data-result]')) : [];
  const attackerPlayerInput = document.getElementById('battle-filter-attacker-player-input');
  const defenderPlayerInput = document.getElementById('battle-filter-defender-player-input');
  const attackerPlayerControl = document.getElementById('battle-filter-attacker-player-control');
  const defenderPlayerControl = document.getElementById('battle-filter-defender-player-control');
  const attackerInput = document.getElementById('battle-filter-attacker-input');
  const defenderInput = document.getElementById('battle-filter-defender-input');
  const attackerControl = document.getElementById('battle-filter-attacker-control');
  const defenderControl = document.getElementById('battle-filter-defender-control');
  const clearButton = document.getElementById('battle-filter-clear');

  if (!sortSelect || !zoneSelect || !resultGroup || resultButtons.length === 0 || !attackerPlayerInput || !defenderPlayerInput || !attackerPlayerControl || !defenderPlayerControl || !attackerInput || !defenderInput || !attackerControl || !defenderControl || !clearButton) return;

  sortSelect.value = battleLogFilters.sort;
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

  syncResultButtons();

  const rerenderBattleLog = () => {
    const snapshot = guildSnapshots[activeGuildIndex];
    if (!snapshot) return;
    renderBattleLog(snapshot);
  };

  sortSelect.addEventListener('change', () => {
    battleLogFilters.sort = sortSelect.value || 'newest';
    rerenderBattleLog();
  });

  zoneSelect.addEventListener('change', () => {
    battleLogFilters.zoneType = zoneSelect.value || '';
    rerenderBattleLog();
  });

  resultButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const nextValue = button.getAttribute('data-result') || 'all';
      battleLogFilters.result = nextValue;
      syncResultButtons();
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
    battleLogFilters.result = 'all';
    battleLogFilters.zoneType = '';
    battleLogFilters.attackerPlayer = '';
    battleLogFilters.defenderPlayer = '';
    battleLogFilters.attackerUnitIds = [];
    battleLogFilters.defenderUnitIds = [];

    sortSelect.value = 'newest';
    zoneSelect.value = '';
    battleLogFilters.result = 'all';
    attackerPlayerInput.value = '';
    defenderPlayerInput.value = '';
    syncResultButtons();
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

  if (!battleList) return;

  const battles = Array.isArray(snapshot?.battles) ? snapshot.battles : [];
  updateBattleLogTileTypeFilterOptions(snapshot);
  updateBattleLogPlayerFilterOptions(snapshot);
  updateBattleLogUnitFilterOptions(snapshot);

  const filteredBattles = battles
    .filter((battle) => {
      const outcome = getBattleOutcome(battle);

      if (battleLogFilters.result === 'win' && outcome !== 'win') {
        return false;
      }

      if (battleLogFilters.result === 'loss' && outcome !== 'loss') {
        return false;
      }

      if (battleLogFilters.zoneType) {
        const zoneType = String(battle.zoneType || '');
        if (zoneType !== battleLogFilters.zoneType) {
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
    const item = document.createElement('article');
    item.className = 'grid grid-cols-1 gap-3 rounded-xl border border-slate-500/30 bg-slate-900/50 p-3 md:grid-cols-3';
    const attackerSideUnits = buildBattleSideUnits(battle.attackerUnits, battle.attackerMachineOfWar);
    const defenderSideUnits = buildBattleSideUnits(battle.defenderUnits, battle.defenderMachineOfWar);
    item.innerHTML = `
      <div class="flex min-w-0 flex-col gap-2">
        <div class="truncate font-bold text-slate-200">${escapeHtml(battle.attackerName)}</div>
        <div class="flex flex-wrap gap-1.5">${renderBattleUnits(attackerSideUnits, 'attacker')}</div>
      </div>
      <div class="flex min-w-28 flex-col items-start justify-center gap-1 md:items-center">
        <span class="inline-flex items-center ${stateClass}">${scoreDisplay}</span>
        ${bonusDisplay}
        <span class="text-xs uppercase tracking-wide text-slate-300">${escapeHtml(stateLabel)}</span>
        ${zoneLabel}
      </div>
      <div class="flex min-w-0 flex-col gap-2 text-left md:items-end md:text-right">
        <div class="truncate font-bold text-slate-200">${escapeHtml(battle.defenderName)}</div>
        <div class="flex flex-wrap gap-1.5 md:justify-end">${renderBattleUnits(defenderSideUnits, 'defender')}</div>
      </div>
    `;

    battleList.appendChild(item);
  });
}

function renderTable(snapshot) {
  const summary = summarizeGuild(snapshot);
  const rows = summary.rows;
  const leaderboardBody = document.getElementById('leaderboard-body');
  const leaderboardCards = document.getElementById('leaderboard-cards');

  if (!leaderboardBody) return;

  leaderboardBody.innerHTML = '';
  if (leaderboardCards) leaderboardCards.innerHTML = '';

  const getTokenVisual = (token) => {
    const tokenScore = Number(token.score || 0);
    const isUnused = !('hasScore' in token);
    const abandoned = !!token.abandoned;
    const cleanup = !!token.cleanup;
    const showCleanupIcon = cleanup && isLegendEnabled('token', 'cleanup');
    const cleanupHtml = showCleanupIcon ? '<span class="text-emerald-400" title="Cleanup">🧹</span>' : '';
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
      display = `<span class="inline-flex flex-row items-center gap-1"><span class="font-semibold text-slate-200">0</span>${cleanupHtml}</span>`;
      stateClass = showOutcomeStyle
        ? 'rounded-md bg-rose-400/20 px-2 py-1 text-rose-200'
        : 'rounded-md px-2 py-1 text-slate-200';
    } else if (tokenScore > 0) {
      display = showCleanupIcon
        ? `<span class="inline-flex flex-row items-center gap-1"><span class="font-semibold text-slate-200">${tokenScore.toLocaleString()}</span><span class="text-emerald-400" title="Cleanup">🧹</span></span>`
        : formatValue(tokenScore);
      if (showOutcomeStyle) {
        stateClass = token.defended
          ? 'rounded-md bg-rose-400/20 px-2 py-1 text-rose-200'
          : 'rounded-md bg-emerald-400/20 px-2 py-1 text-lime-100';
      } else {
        stateClass = 'rounded-md px-2 py-1 text-slate-200';
      }
    } else {
      display = `<span class="inline-flex flex-row items-center gap-1"><span class="font-semibold text-slate-200">0</span>${cleanupHtml}</span>`;
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
  };

  rows.forEach((player, index) => {
    const row = document.createElement('tr');
    row.className = 'transition-colors duration-150 hover:bg-cyan-400/10';
    const avatarHtml = renderPlayerAvatar(player);

    const cells = [
      `<td class="sticky left-0 z-10 whitespace-nowrap bg-slate-900/95 px-4 py-3 font-semibold text-slate-50"><div class="flex items-center gap-2"><span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-400/20 text-xs font-bold text-cyan-100">${index + 1}</span>${avatarHtml}<div class="min-w-0"><div class="flex min-w-0 items-center gap-2"><span class="truncate whitespace-nowrap">${escapeHtml(player.name)} (${player.usedTokens}/10)</span></div></div></div></td>`,
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
      const tokenCards = player.tokens.map((token, tokenIndex) => {
        const tokenVisual = getTokenVisual(token);
        const tokenContent = `<div class="inline-flex items-center justify-center ${tokenVisual.stateClass}">${tokenVisual.display}</div><div class="mt-1.5">${tokenVisual.buffsHtml}</div>`;
        return `
          <div class="rounded-lg border border-slate-500/30 bg-slate-900/50 p-2 text-center">
            <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Token ${tokenIndex + 1}</div>
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
            <div class="text-xs text-slate-400">${player.usedTokens}/10 used</div>
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
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">${tokenCards}</div>
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

  legendBlockKeys = {
    token: ['win', 'defeat', 'abandoned', 'cleanup'],
    scoreTier: ['bronze', 'silver', 'gold'],
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
      legendVisibility.buff[key] = true;
    }
  });

  const pillClasses = (enabled) => `inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-slate-400/20 bg-slate-900/60 px-2 py-1 text-sm transition ${enabled ? 'text-blue-100 hover:border-cyan-300/50 hover:bg-slate-900/80' : 'text-slate-400 opacity-45 grayscale saturate-50 hover:opacity-70'}`;
  const titleClasses = (block) => {
    const keys = legendBlockKeys[block] || [];
    const enabledCount = keys.reduce((count, key) => count + (isLegendEnabled(block, key) ? 1 : 0), 0);
    const hasMixed = enabledCount > 0 && enabledCount < keys.length;
    const isOn = keys.length > 0 && enabledCount === keys.length;
    if (hasMixed) return 'inline-flex min-w-20 items-center text-xs font-bold uppercase tracking-widest text-amber-300';
    if (isOn) return 'inline-flex min-w-20 items-center text-xs font-bold uppercase tracking-widest text-cyan-300';
    return 'inline-flex min-w-20 items-center text-xs font-bold uppercase tracking-widest text-slate-400';
  };

  const makeItem = ({ block, key, iconHtml, label }) => {
    const enabled = isLegendEnabled(block, key);
    return `<button type="button" data-legend-item="true" data-legend-block="${block}" data-legend-key="${key}" class="${pillClasses(enabled)}"><span class="inline-flex h-5 w-5 items-center justify-center">${iconHtml}</span><span class="font-semibold">${escapeHtml(label)}</span></button>`;
  };

  const tokenItems = [
    makeItem({ block: 'token', key: 'win', iconHtml: '🟩', label: 'Win' }),
    makeItem({ block: 'token', key: 'defeat', iconHtml: '🟥', label: 'Defeat' }),
    makeItem({ block: 'token', key: 'abandoned', iconHtml: '⬜', label: 'Abandoned / unused' }),
    makeItem({ block: 'token', key: 'cleanup', iconHtml: '🧹', label: 'Cleanup' })
  ];

  const scoreTierItems = [
    makeItem({ block: 'scoreTier', key: 'bronze', iconHtml: '<span class="inline-flex h-3 w-3 rounded-sm border border-slate-700 bg-slate-900 outline outline-2 outline-offset-1 outline-amber-700"></span>', label: `${SCORE_TIER_BRONZE}+ Bronze` }),
    makeItem({ block: 'scoreTier', key: 'silver', iconHtml: '<span class="inline-flex h-3 w-3 rounded-sm border border-slate-700 bg-slate-900 outline outline-2 outline-offset-1 outline-zinc-300"></span>', label: `${SCORE_TIER_SILVER}+ Silver` }),
    makeItem({ block: 'scoreTier', key: 'gold', iconHtml: '<span class="inline-flex h-3 w-3 rounded-sm border border-slate-700 bg-slate-900 outline outline-2 outline-offset-1 outline-amber-400"></span>', label: `${SCORE_TIER_GOLD} Gold` })
  ];

  const buffItems = buffLegendEntries.map(({ name, color, key }) => makeItem({
    block: 'buff',
    key,
    iconHtml: `<span class="inline-block h-3 w-3 rounded-full border border-white/10" style="background:${color}"></span>`,
    label: name
  }));

  legendContainer.innerHTML = `
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex grow-0 shrink-0 flex-wrap items-center gap-3 rounded-xl border border-slate-400/20 bg-slate-900/35 px-3 py-2">
        <button type="button" data-legend-title="true" data-legend-block="token" class="${titleClasses('token')}">Token</button>
        <div class="flex flex-wrap items-center gap-2">${tokenItems.join('')}</div>
      </div>
      <div class="flex grow-0 shrink-0 flex-wrap items-center gap-3 rounded-xl border border-slate-400/20 bg-slate-900/35 px-3 py-2">
        <button type="button" data-legend-title="true" data-legend-block="buff" class="${titleClasses('buff')}">Buff groups</button>
        <div class="flex flex-wrap items-center gap-2">${buffItems.join('') || '<div class="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-slate-400/20 bg-slate-900/60 px-2 py-1 text-sm"><span class="w-4 text-center">—</span><span class="font-semibold text-blue-100">No buff groups</span></div>'}</div>
      </div>
      <div class="flex grow-0 shrink-0 flex-wrap items-center gap-3 rounded-xl border border-slate-400/20 bg-slate-900/35 px-3 py-2">
        <button type="button" data-legend-title="true" data-legend-block="scoreTier" class="${titleClasses('scoreTier')}">Score tiers</button>
        <div class="flex flex-wrap items-center gap-2">${scoreTierItems.join('')}</div>
      </div>
    </div>
  `;
}

async function loadGuildData() {
  await loadDatasetManifest();

  activeDatasetKey = Object.prototype.hasOwnProperty.call(DATASETS, activeDatasetKey)
    ? activeDatasetKey
    : getDatasetKeyFromUrl();
  updateDatasetInUrl(activeDatasetKey);

  const statusMessage = document.getElementById('status-message');
  const lastUpdatedEl = document.getElementById('last-updated');
  const dataset = DATASETS[activeDatasetKey];

  if (!dataset) {
    console.error(`Unknown dataset key: ${activeDatasetKey}`);
    return;
  }

  renderDatasetTabs();
  setupLeaderboardLayoutToggle();
  setupLegendVisibilityToggle();
  setupBattleLogFilters();

  if (statusMessage) {
    statusMessage.textContent = `Loading ${dataset.label.toLowerCase()} data...`;
  }
  if (lastUpdatedEl) {
    lastUpdatedEl.textContent = 'Loading...';
  }

  try {
    await loadUnitPortraitMap();
    const response = await fetch(dataset.url, { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`Unable to fetch JSON (${response.status})`);
    }

    const data = await response.json();
    const responseLastModified = response.headers.get('last-modified');
    const dataTimestamp = getLatestActivityTimestamp(data);

    renderLastUpdated({ responseLastModified, dataTimestamp });

    guildSnapshots = buildSnapshot(data);
    activeGuildIndex = 0;
    renderGuildTokenProjectionTable();
    renderActiveGuild();
    renderDatasetTabs();

    if (statusMessage) {
      statusMessage.textContent = `Loaded ${guildSnapshots[activeGuildIndex]?.players.length || 0} players for ${guildSnapshots[activeGuildIndex]?.name || 'the selected guild'} from ${dataset.label.toLowerCase()}.`;
    }
  } catch (error) {
    console.error(error);
    guildSnapshots = [buildFallbackSnapshot()];
    activeGuildIndex = 0;
    renderLastUpdated({ responseLastModified: null, dataTimestamp: null });
    renderGuildTokenProjectionTable();
    renderActiveGuild();
    renderDatasetTabs();

    if (statusMessage) {
      statusMessage.textContent = `The ${dataset.label.toLowerCase()} JSON could not be loaded. Open the app from a local web server to enable fetch().`;
    }
  }
}

loadGuildData();
