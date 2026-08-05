const MISSING_UNIT_AVATAR_URL = './img/missing-unit.svg';
const TEAM_COLUMNS = ['core', 'flex', 'mow'];
const TEAMS_DATA_URL = './data/static/guild-teams.json';

const teamsState = {
  teams: [],
  experimentTeam: null,
  portraitMap: {},
  portraitManifestSet: new Set(),
  battleLogs: [],
  battleLogsLoaded: false,
  compSortMode: 'uses',
  compMinUses: '',
  activeFilter: 'all',
  activeTab: 'library',
  libraryPoolSearch: '',
  experimentPoolSearch: '',
  dragPayload: null,
  nextTeamNumber: 1,
  battleLogsVersion: 0,
  coreMatchCache: new Map()
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ensureTeamShape(team) {
  const base = team && typeof team === 'object' ? team : {};
  TEAM_COLUMNS.forEach((column) => {
    if (!Array.isArray(base[column])) base[column] = [];
  });
  if (!['att', 'def', 'hybrid'].includes(base.type)) base.type = 'att';
  if (!base.name) base.name = 'Unnamed build';
  if (Object.prototype.hasOwnProperty.call(base, 'id')) delete base.id;
  return base;
}

async function loadPortraitMap() {
  try {
    const response = await fetch('./data/static/portrait-map.json', { cache: 'no-store' });
    if (!response.ok) {
      teamsState.portraitMap = {};
      return;
    }
    const json = await response.json();
    teamsState.portraitMap = json && typeof json === 'object' ? json : {};
  } catch (error) {
    teamsState.portraitMap = {};
  }
}

async function loadPortraitManifest() {
  try {
    const response = await fetch('./data/static/image-manifest.json', { cache: 'no-store' });
    if (!response.ok) {
      teamsState.portraitManifestSet = new Set();
      return;
    }
    const json = await response.json();
    if (!Array.isArray(json)) {
      teamsState.portraitManifestSet = new Set();
      return;
    }
    teamsState.portraitManifestSet = new Set(
      json.map((entry) => String(entry || '').trim()).filter((entry) => entry)
    );
  } catch (error) {
    teamsState.portraitManifestSet = new Set();
  }
}

async function loadTeamsData() {
  try {
    const response = await fetch(TEAMS_DATA_URL, { cache: 'no-store' });
    if (!response.ok) {
      teamsState.teams = [];
      return;
    }

    const json = await response.json();
    if (!Array.isArray(json)) {
      teamsState.teams = [];
      return;
    }

    teamsState.teams = json;
  } catch (error) {
    teamsState.teams = [];
  }
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

function getBattleUnitId(unit) {
  if (typeof unit === 'string') {
    return String(unit || '').trim();
  }

  if (!unit || typeof unit !== 'object') return '';
  const rawId = unit.avatarUnitId
    || unit.unitTypeId
    || unit.baseCharacterId
    || unit.unitId
    || unit.characterId
    || unit.id;
  return String(rawId || '').trim();
}

function normalizeUnitId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeUnitIdList(units) {
  return (Array.isArray(units) ? units : [])
    .map((unit) => normalizeUnitId(getBattleUnitId(unit)))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function buildLineupUnitIdsWithMachineOfWar(battleSide) {
  const units = Array.isArray(battleSide?.units) ? battleSide.units : [];
  const machineOfWarUnitId = getBattleUnitId(battleSide?.machineOfWar || null);
  const baseUnitIds = units.map((unit) => getBattleUnitId(unit)).filter(Boolean);

  if (machineOfWarUnitId) {
    baseUnitIds.push(machineOfWarUnitId);
  }

  return baseUnitIds;
}

function isExactCoreMatch(normalizedCore, normalizedUnits) {
  if (!Array.isArray(normalizedCore) || !Array.isArray(normalizedUnits)) return false;
  if (normalizedCore.length === 0) return false;
  return normalizedCore.every((unitId) => normalizedUnits.includes(unitId));
}

function formatBattleDate(createdOn) {
  const date = new Date(Number(createdOn || 0));
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function getCoreScoreValue(score) {
  if (typeof globalThis.getCoreScore === 'function') {
    return Number(globalThis.getCoreScore(score)?.core || 0);
  }

  const numericScore = Number(score || 0);
  if (numericScore <= 1600) return numericScore;
  return Math.min(numericScore, 1600);
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

async function loadBattleLogsData() {
  const fallbackDatasets = [{
    key: 'current',
    label: 'Active war',
    url: './data/current/live-war.json'
  }];

  let datasets = fallbackDatasets;

  try {
    const manifestResponse = await fetch('./data/dataset-manifest.json', { cache: 'no-store' });
    if (manifestResponse.ok) {
      const manifest = await manifestResponse.json();
      const rawDatasets = Array.isArray(manifest)
        ? manifest
        : (Array.isArray(manifest?.datasets) ? manifest.datasets : []);
      const normalizedDatasets = rawDatasets
        .map((entry) => ({
          key: String(entry?.key || '').trim(),
          label: String(entry?.label || 'Unknown war').trim(),
          url: String(entry?.url || '').trim()
        }))
        .filter((entry) => entry.key && entry.url);

      if (normalizedDatasets.length > 0) {
        datasets = normalizedDatasets;
      }
    }
  } catch (error) {
    datasets = fallbackDatasets;
  }

  const logs = [];

  const datasetResults = await Promise.all(datasets.map(async (dataset) => {
    try {
      const response = await fetch(dataset.url, { cache: 'no-store' });
      if (!response.ok) return null;

      const data = await response.json();
      const eventResponseData = pickPrimaryEventResponseData(data);
      if (!eventResponseData) return null;

      return { dataset, eventResponseData };
    } catch (error) {
      return null;
    }
  }));

  datasetResults.filter(Boolean).forEach(({ dataset, eventResponseData }) => {
    const guildData = Array.isArray(eventResponseData?.guildData) ? eventResponseData.guildData : [];
    const playerData = Array.isArray(eventResponseData?.playerData) ? eventResponseData.playerData : [];
    const activityLogs = Array.isArray(eventResponseData?.activityLogs) ? eventResponseData.activityLogs : [];

    const teamIndexToGuildName = new Map();
    guildData.forEach((guild) => {
      const teamIndex = Number(guild?.teamIndex);
      if (!Number.isFinite(teamIndex)) return;
      teamIndexToGuildName.set(teamIndex, String(guild?.name || `Team ${teamIndex}`));
    });

    const playerNames = new Map();
    playerData.forEach((player) => {
      const userId = String(player?.userId || '').trim();
      if (!userId) return;
      playerNames.set(userId, String(player?.displayName || userId));
    });

    const allTeamIndexes = Array.from(teamIndexToGuildName.keys());

    activityLogs.forEach((log) => {
      if (String(log?.type || '') !== 'battleFinished') return;

      const attackerTeamIndex = Number(log?.teamIndex);
      if (!Number.isFinite(attackerTeamIndex)) return;

      const defenderTeamIndex = allTeamIndexes.find((index) => index !== attackerTeamIndex) ?? null;

      const attackerUserId = String(log?.attacker?.userId || log?.userId || '').trim();
      const defenderUserId = String(log?.defender?.userId || '').trim();
      const hasScore = Object.prototype.hasOwnProperty.call(log || {}, 'score');
      const abandoned = !!log?.abandoned;
      let defended = false;
      let cleanup = false;

      if (!abandoned) {
        const flags = getBattleFlags(log);
        defended = flags.defended;
        cleanup = flags.cleanup;
      }

      logs.push({
        id: String(log?.id || `${dataset.key}-${Number(log?.createdOn || 0)}-${attackerUserId || 'unknown'}`),
        datasetLabel: dataset.label,
        createdOn: Number(log?.createdOn || 0),
        zoneType: String(log?.zone?.type || ''),
        hasScore,
        abandoned,
        defended,
        cleanup,
        score: getCoreScoreValue(log?.score),
        attackerGuildName: String(teamIndexToGuildName.get(attackerTeamIndex) || `Team ${attackerTeamIndex}`),
        defenderGuildName: Number.isFinite(defenderTeamIndex)
          ? String(teamIndexToGuildName.get(defenderTeamIndex) || `Team ${defenderTeamIndex}`)
          : 'Unknown guild',
        attackerName: String(playerNames.get(attackerUserId) || attackerUserId || 'Unknown attacker'),
        defenderName: String(playerNames.get(defenderUserId) || defenderUserId || 'Unknown defender'),
        attackerUnitIds: buildLineupUnitIdsWithMachineOfWar(log?.attacker),
        defenderUnitIds: buildLineupUnitIdsWithMachineOfWar(log?.defender),
        attackerUnitsNormalized: normalizeUnitIdList(log?.attacker?.units),
        defenderUnitsNormalized: normalizeUnitIdList(log?.defender?.units)
      });
    });
  });

  teamsState.battleLogs = logs.sort((a, b) => Number(b.createdOn || 0) - Number(a.createdOn || 0));
  teamsState.battleLogsLoaded = true;
  teamsState.battleLogsVersion += 1;
  teamsState.coreMatchCache.clear();
}

function getPortraitUrlForUnitId(unitId) {
  const imageName = String((teamsState.portraitMap || {})[unitId] || '').trim();
  if (!imageName) return MISSING_UNIT_AVATAR_URL;
  if (teamsState.portraitManifestSet.has(imageName)) return `./img-temp/${imageName}`;
  return `./img/${imageName}`;
}

function getAllUnitIds() {
  return Object.keys(teamsState.portraitMap || {}).sort((a, b) => a.localeCompare(b));
}

function renderReadonlyUnit(unitId) {
  const avatarUrl = getPortraitUrlForUnitId(unitId);
  return `<li class="inline-flex items-center justify-center rounded-xl border border-slate-700/80 bg-slate-950/80 p-2">
    <span class="inline-flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border border-slate-500/50 bg-slate-800/90" title="${escapeHtml(unitId)}">
      <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(unitId)}" class="h-full w-full object-cover" loading="lazy" onerror="this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}'" />
    </span>
  </li>`;
}

function renderReadonlyGroup(title, ids, layoutClass = '') {
  const values = Array.isArray(ids) ? ids : [];
  return `<section class="px-5 py-4 ${layoutClass}">
    <div class="mb-2 flex items-center justify-between gap-2">
      <h4 class="text-base font-black uppercase tracking-[0.16em] text-slate-200">${escapeHtml(title)}</h4>
      <span class="text-base text-slate-500">${values.length}</span>
    </div>
    ${values.length > 0
      ? `<ul class="flex flex-wrap gap-3">${values.map((unitId) => renderReadonlyUnit(unitId)).join('')}</ul>`
      : '<p class="text-base text-slate-500">No units listed.</p>'}
  </section>`;
}

function renderTypePill(type) {
  const safeType = ['att', 'def', 'hybrid'].includes(type) ? type : 'att';
  const tone = safeType === 'att'
    ? 'border-rose-400/50 bg-rose-500/15 text-rose-200'
    : safeType === 'def'
      ? 'border-sky-400/50 bg-sky-500/15 text-sky-200'
      : 'border-violet-400/50 bg-violet-500/15 text-violet-200';
  return `<span class="rounded-full border px-4 py-2 text-base font-semibold uppercase tracking-wide ${tone}">${escapeHtml(safeType)}</span>`;
}

function renderMatchResultBadge(log, perspective) {
  const score = Number(log?.score || 0);
  const cleanupHtml = log?.cleanup ? '<span class="text-emerald-400" title="Cleanup">🧹</span>' : '';

  if (log?.abandoned) {
    return '<span class="inline-flex items-center rounded-md bg-slate-400/20 px-2 py-1 text-xs font-semibold text-slate-300">🛑 Abandoned</span>';
  }

  const attackWon = Boolean(log?.hasScore) && !log?.defended && score > 0;
  const isAttackPerspective = perspective === 'attack';
  const isWin = isAttackPerspective ? attackWon : !attackWon;

  const stateClass = isWin
    ? 'rounded-md bg-emerald-400/20 px-2 py-1 text-xs font-semibold text-lime-100'
    : 'rounded-md bg-rose-400/20 px-2 py-1 text-xs font-semibold text-rose-200';
  const label = isWin ? 'Win' : 'Defeat';
  const scoreLabel = Number.isFinite(score) ? score.toLocaleString() : '0';

  return `<span class="inline-flex items-center gap-1 ${stateClass}"><span>${escapeHtml(label)}</span><span class="text-slate-200">${scoreLabel}</span>${cleanupHtml}</span>`;
}

function renderMatchUnitAvatarList(unitIds, team) {
  const ids = Array.isArray(unitIds) ? unitIds : [];
  if (ids.length === 0) {
    return '<p class="text-xs text-slate-500">No lineup data</p>';
  }

  const hasTeamCategories = !!team && (
    Array.isArray(team?.core) || Array.isArray(team?.flex) || Array.isArray(team?.mow)
  );
  const normalizedCore = hasTeamCategories ? new Set(normalizeUnitIdList(team?.core)) : new Set();
  const normalizedFlex = hasTeamCategories ? new Set(normalizeUnitIdList(team?.flex)) : new Set();
  const normalizedMow = hasTeamCategories ? new Set(normalizeUnitIdList(team?.mow)) : new Set();

  return `<div class="flex flex-wrap gap-1.5">${ids.map((unitId) => {
    const avatarUrl = getPortraitUrlForUnitId(unitId);
    const normalizedUnitId = normalizeUnitId(unitId);
    const inCore = normalizedCore.has(normalizedUnitId);
    const inFlex = normalizedFlex.has(normalizedUnitId);
    const inMow = normalizedMow.has(normalizedUnitId);
    const isKnownTeamUnit = inCore || inFlex || inMow;
    const frameClass = hasTeamCategories
      ? (inCore
        ? 'border-cyan-300/80'
        : (inFlex || inMow)
          ? 'border-emerald-300/70'
          : 'border-slate-700/80 opacity-35 grayscale')
      : 'border-slate-600/70';
    const slotLabel = hasTeamCategories
      ? (inCore ? 'Core' : (inMow ? 'Machine of War' : (inFlex ? 'Flex' : 'No team slot match')))
      : 'Observed lineup';

    return `<span class="inline-flex h-8 w-8 overflow-hidden rounded-md border bg-slate-900/80 ${frameClass}" title="${escapeHtml(unitId)} | ${escapeHtml(slotLabel)}"><img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(unitId)}" class="h-full w-full object-cover ${isKnownTeamUnit ? '' : 'opacity-80'}" loading="lazy" onerror="this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}'" /></span>`;
  }).join('')}</div>`;
}

function getPerspectiveOutcome(log, perspective) {
  void perspective;

  if (log?.abandoned) {
    return null;
  }

  const score = Number(log?.score || 0);
  const attackWon = Boolean(log?.hasScore) && !log?.defended && score > 0;

  return {
    isWin: attackWon,
    isCleanup: !!log?.cleanup,
    score
  };
}

function buildTeamCompAggregate(matches, perspective) {
  const map = new Map();

  matches.forEach((log) => {
    const lineupIds = perspective === 'attack' ? log.attackerUnitIds : log.defenderUnitIds;
    const normalizedKey = (Array.isArray(lineupIds) ? lineupIds : [])
      .map((unitId) => normalizeUnitId(unitId))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .join('|');

    if (!normalizedKey) return;

    if (!map.has(normalizedKey)) {
      map.set(normalizedKey, {
        key: normalizedKey,
        lineupIds: Array.isArray(lineupIds) ? lineupIds.slice() : [],
        uses: 0,
        totalScore: 0,
        wins: 0,
        winCleanup: 0,
        losses: 0,
        lossCleanup: 0,
        lastSeen: 0
      });
    }

    const aggregate = map.get(normalizedKey);
    const outcome = getPerspectiveOutcome(log, perspective);
    if (!outcome) return;

    aggregate.uses += 1;
    aggregate.totalScore += outcome.score;
    aggregate.lastSeen = Math.max(Number(aggregate.lastSeen || 0), Number(log?.createdOn || 0));

    if (outcome.isWin) {
      if (outcome.isCleanup) {
        aggregate.winCleanup += 1;
      } else {
        aggregate.wins += 1;
      }
    } else if (outcome.isCleanup) {
      aggregate.lossCleanup += 1;
    } else {
      aggregate.losses += 1;
    }
  });

  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      avgScore: entry.uses > 0 ? entry.totalScore / entry.uses : 0
    }));
}

function sortTeamCompSummary(summary, mode) {
  const normalizedMode = ['uses', 'avg-desc', 'avg-asc'].includes(mode) ? mode : 'uses';
  const entries = Array.isArray(summary) ? summary.slice() : [];

  return entries.sort((a, b) => {
    if (normalizedMode === 'avg-asc') {
      if (a.avgScore !== b.avgScore) return a.avgScore - b.avgScore;
      if (b.uses !== a.uses) return b.uses - a.uses;
      return b.lastSeen - a.lastSeen;
    }

    if (normalizedMode === 'avg-desc') {
      if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
      if (b.uses !== a.uses) return b.uses - a.uses;
      return b.lastSeen - a.lastSeen;
    }

    if (b.uses !== a.uses) return b.uses - a.uses;
    if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
    return b.lastSeen - a.lastSeen;
  });
}

function renderTeamCompSummaryList(summary, perspective, team) {
  const sortedSummary = sortTeamCompSummary(Array.isArray(summary) ? summary : [], teamsState.compSortMode);
  const minUsesValue = Number.parseInt(String(teamsState.compMinUses || ''), 10);
  const minUses = Number.isFinite(minUsesValue) && minUsesValue > 0 ? minUsesValue : 0;
  const filteredSummary = minUses > 0
    ? sortedSummary.filter((entry) => Number(entry?.uses || 0) >= minUses)
    : sortedSummary;

  if (filteredSummary.length === 0 && minUses > 0) {
    return `<p class="mt-2 text-xs text-slate-400">No exact comp matches found with at least ${minUses.toLocaleString()} uses.</p>`;
  }

  if (filteredSummary.length === 0) {
    return '<p class="mt-2 text-xs text-slate-400">No exact comp matches found.</p>';
  }

  const isDefensePerspective = perspective === 'defense';
  const winMarker = isDefensePerspective ? '❌' : '✅';
  const winCleanupMarker = isDefensePerspective ? '❌' : '✅';
  const lossMarker = isDefensePerspective ? '✅' : '❌';
  const lossCleanupMarker = isDefensePerspective ? '✅' : '❌';
  const winClass = isDefensePerspective
    ? 'border-rose-400/35 bg-rose-500/10'
    : 'border-emerald-400/35 bg-emerald-500/10';
  const winCleanupClass = isDefensePerspective
    ? 'border-orange-400/35 bg-orange-500/10'
    : 'border-lime-400/35 bg-lime-500/10';
  const lossClass = isDefensePerspective
    ? 'border-emerald-400/35 bg-emerald-500/10'
    : 'border-rose-400/35 bg-rose-500/10';
  const lossCleanupClass = isDefensePerspective
    ? 'border-lime-400/35 bg-lime-500/10'
    : 'border-orange-400/35 bg-orange-500/10';
  const formatPct = (value, total) => {
    if (!Number.isFinite(total) || total <= 0) return '0%';
    return `${Math.round((Number(value || 0) / total) * 100)}%`;
  };
  const formatTokenEfficiency = (entry) => {
    const uses = Number(entry?.uses || 0);
    if (!Number.isFinite(uses) || uses <= 0) return '0.00';

    const wins = Number(entry?.wins || 0);
    const winCleanup = Number(entry?.winCleanup || 0);
    const losses = Number(entry?.losses || 0);
    const lossCleanup = Number(entry?.lossCleanup || 0);

    const successfulOutcomes = perspective === 'defense'
      ? (losses + lossCleanup)
      : (wins + winCleanup);

    return (successfulOutcomes / uses).toFixed(2);
  };

  return `<ul class="mt-2 max-h-72 space-y-2 overflow-auto">${filteredSummary.map((entry) => `<li class="rounded-lg border border-slate-700/80 bg-slate-950/70 p-2.5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-xs font-semibold text-cyan-200">Used ${entry.uses.toLocaleString()}x</span>
      <span class="text-xs text-slate-300">Avg score ${Math.round(entry.avgScore).toLocaleString()}</span>
    </div>
    <div class="mt-1 text-[11px] font-semibold text-cyan-100">Token efficiency: ${formatTokenEfficiency(entry)}</div>
    <div class="mt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-300 sm:grid-cols-4">
      <span class="inline-flex items-center justify-between gap-2 rounded-md border px-2 py-1 ${winClass}"><span>${winMarker} W: ${entry.wins.toLocaleString()}</span><span class="text-slate-200">${formatPct(entry.wins, entry.uses)}</span></span>
      <span class="inline-flex items-center justify-between gap-2 rounded-md border px-2 py-1 ${winCleanupClass}"><span>${winCleanupMarker} W 🖌: ${entry.winCleanup.toLocaleString()}</span><span class="text-slate-200">${formatPct(entry.winCleanup, entry.uses)}</span></span>
      <span class="inline-flex items-center justify-between gap-2 rounded-md border px-2 py-1 ${lossClass}"><span>${lossMarker} L: ${entry.losses.toLocaleString()}</span><span class="text-slate-200">${formatPct(entry.losses, entry.uses)}</span></span>
      <span class="inline-flex items-center justify-between gap-2 rounded-md border px-2 py-1 ${lossCleanupClass}"><span>${lossCleanupMarker} L 🖌: ${entry.lossCleanup.toLocaleString()}</span><span class="text-slate-200">${formatPct(entry.lossCleanup, entry.uses)}</span></span>
    </div>
    <div class="mt-2">${renderMatchUnitAvatarList(entry.lineupIds, team)}</div>
  </li>`).join('')}</ul>`;
}

function getCoreMatchData(normalizedCore) {
  const hasCoreSelection = Array.isArray(normalizedCore) && normalizedCore.length > 0;
  const coreKey = hasCoreSelection ? normalizedCore.join('|') : '__all__';
  const cacheKey = `${teamsState.battleLogsVersion}|${coreKey}`;

  const cached = teamsState.coreMatchCache.get(cacheKey);
  if (cached) return cached;

  const attackMatches = hasCoreSelection
    ? teamsState.battleLogs.filter((log) => isExactCoreMatch(normalizedCore, log.attackerUnitsNormalized))
    : teamsState.battleLogs.slice();
  const defenseMatches = hasCoreSelection
    ? teamsState.battleLogs.filter((log) => isExactCoreMatch(normalizedCore, log.defenderUnitsNormalized))
    : teamsState.battleLogs.slice();

  const computed = {
    attackMatches,
    defenseMatches,
    attackSummary: buildTeamCompAggregate(attackMatches, 'attack'),
    defenseSummary: buildTeamCompAggregate(defenseMatches, 'defense')
  };

  teamsState.coreMatchCache.set(cacheKey, computed);
  return computed;
}

function renderTeamCoreMatchAccordion(team, options = {}) {
  if (!teamsState.battleLogsLoaded) {
    return `<div class="mt-4 rounded-xl border border-slate-700/70 bg-slate-950/60 p-3 text-sm text-slate-400">Loading matching battle logs...</div>`;
  }

  const showAllWhenNoCore = Boolean(options?.showAllWhenNoCore);
  const normalizedCore = normalizeUnitIdList(team?.core);
  const hasCoreSelection = normalizedCore.length > 0;
  if (!hasCoreSelection && !showAllWhenNoCore) {
    return `<div class="mt-4 rounded-xl border border-slate-700/70 bg-slate-950/60 p-3 text-sm text-slate-400">No core units defined for this team.</div>`;
  }

  const coreMatchData = getCoreMatchData(normalizedCore);
  const attackMatches = coreMatchData.attackMatches;
  const defenseMatches = coreMatchData.defenseMatches;
  const helperText = hasCoreSelection
    ? 'One entry per exact comp. Core units must be present; flex and Machine of War are ignored for match detection.'
    : 'No core selected. Showing comp list from all loaded battle data.';
  const renderSortButton = (mode, label) => {
    const isActive = teamsState.compSortMode === mode;
    const styleClass = isActive
      ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200'
      : 'border-slate-500/50 bg-slate-900/80 text-slate-300';
    return `<button type="button" data-comp-sort="${escapeHtml(mode)}" class="rounded-md border px-2.5 py-1 text-xs font-semibold transition hover:border-cyan-400/60 hover:text-slate-100 ${styleClass}">${escapeHtml(label)}</button>`;
  };
  const minUsesInputValue = String(teamsState.compMinUses || '').trim();

  return `<details open class="mt-4 rounded-2xl border border-cyan-500/25 bg-cyan-500/10 p-3">
    <summary class="cursor-pointer list-none select-none">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-sm font-semibold text-cyan-100">Core match comp data</span>
        <span class="text-xs text-cyan-200">Attack ${attackMatches.length.toLocaleString()} | Defense ${defenseMatches.length.toLocaleString()}</span>
      </div>
      <p class="mt-1 text-xs text-slate-300">${escapeHtml(helperText)}</p>
      <div class="mt-2 inline-flex flex-wrap items-center gap-1.5" role="group" aria-label="Comp sort order">
        ${renderSortButton('uses', 'Times used')}
        ${renderSortButton('avg-desc', 'Avg score ↓')}
        ${renderSortButton('avg-asc', 'Avg score ↑')}
        <label class="ml-2 inline-flex items-center gap-2 text-xs text-slate-300">
          <span>Min uses</span>
          <input type="number" min="0" step="1" inputmode="numeric" data-comp-min-uses="true" value="${escapeHtml(minUsesInputValue)}" class="w-20 rounded-md border border-slate-500/50 bg-slate-900/80 px-2 py-1 text-xs text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20" />
        </label>
      </div>
    </summary>
    <div class="mt-3 grid gap-3 lg:grid-cols-2">
      <section class="rounded-xl border border-sky-400/30 bg-slate-950/55 p-3">
        <h5 class="text-xs font-semibold uppercase tracking-wide text-sky-300">Attack</h5>
        ${renderTeamCompSummaryList(coreMatchData.attackSummary, 'attack', team)}
      </section>
      <section class="rounded-xl border border-amber-400/30 bg-slate-950/55 p-3">
        <h5 class="text-xs font-semibold uppercase tracking-wide text-amber-300">Defense</h5>
        ${renderTeamCompSummaryList(coreMatchData.defenseSummary, 'defense', team)}
      </section>
    </div>
  </details>`;
}

function renderTeamCard(team) {
  return `<article class="rounded-3xl border border-slate-700/80 bg-gradient-to-b from-slate-900/92 to-slate-950/88 p-6 shadow-2xl shadow-black/25">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="text-3xl font-black text-slate-100">${escapeHtml(team.name || 'Unnamed build')}</h3>
      </div>
      ${renderTypePill(team.type)}
    </div>

    <div class="mt-4 divide-y divide-slate-700/70 md:flex md:divide-x md:divide-y-0">
      ${renderReadonlyGroup('Core', team.core, 'md:flex-1 md:min-w-0')}
      ${renderReadonlyGroup('Flex', team.flex, 'md:flex-1 md:min-w-0')}
      ${renderReadonlyGroup('Machine of War', team.mow, 'md:flex-none md:w-64')}
    </div>

    ${renderTeamCoreMatchAccordion(team)}
  </article>`;
}

function getFilteredAndSortedTeams() {
  const allowedFilters = new Set(['all', 'att', 'def', 'hybrid']);
  const activeFilter = allowedFilters.has(teamsState.activeFilter) ? teamsState.activeFilter : 'all';
  const filteredTeams = activeFilter === 'all'
    ? teamsState.teams
    : teamsState.teams.filter((team) => String(team?.type || '').toLowerCase() === activeFilter);

  return filteredTeams
    .map((team, index) => ({ team, index }))
    .sort((a, b) => {
      const typeA = String(a.team?.type || '').toLowerCase();
      const typeB = String(b.team?.type || '').toLowerCase();
      const priorityA = typeA === 'hybrid' ? 0 : 1;
      const priorityB = typeB === 'hybrid' ? 0 : 1;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.index - b.index;
    })
    .map((entry) => entry.team);
}

function renderTeams() {
  const container = document.getElementById('teams-list');
  if (!container) return;

  const sortedTeams = getFilteredAndSortedTeams();
  if (!Array.isArray(sortedTeams) || sortedTeams.length === 0) {
    container.innerHTML = '<div class="rounded-2xl border border-dashed border-slate-500/70 bg-slate-950/60 p-6 text-sm text-slate-400">No builds published yet.</div>';
    return;
  }

  container.innerHTML = sortedTeams.map((team) => renderTeamCard(team)).join('');
}

function syncFilterButtonStates() {
  const filterRoot = document.getElementById('team-type-filter');
  if (!filterRoot) return;

  const buttons = Array.from(filterRoot.querySelectorAll('button[data-filter]'));
  buttons.forEach((button) => {
    const filterValue = String(button.getAttribute('data-filter') || '');
    const isActive = filterValue === teamsState.activeFilter;
    button.setAttribute('aria-checked', isActive ? 'true' : 'false');

    button.classList.toggle('border-cyan-400', isActive);
    button.classList.toggle('bg-cyan-500/15', isActive);
    button.classList.toggle('text-cyan-200', isActive);

    button.classList.toggle('border-slate-500/50', !isActive);
    button.classList.toggle('bg-slate-900/80', !isActive);
    button.classList.toggle('text-slate-300', !isActive);
  });
}

function renderBuilderPoolUnit(unitId, owner = 'library') {
  const avatarUrl = getPortraitUrlForUnitId(unitId);
  return `<button type="button" draggable="true" data-source="pool" data-owner="${escapeHtml(owner)}" data-unit-id="${escapeHtml(unitId)}" class="group inline-flex flex-col items-center rounded-lg border border-slate-700/80 bg-slate-950/80 p-1.5 transition hover:border-cyan-400/60" title="${escapeHtml(unitId)}">
    <span class="inline-flex h-14 w-14 overflow-hidden rounded-md border border-slate-500/50 bg-slate-800/90">
      <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(unitId)}" class="h-full w-full object-cover" loading="lazy" onerror="this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}'" />
    </span>
    <span class="mt-1 max-w-[4.6rem] truncate text-[10px] text-slate-400 group-hover:text-slate-200">${escapeHtml(unitId)}</span>
  </button>`;
}

function renderBuilderTeamUnit(teamIndex, column, unitId, owner = 'library') {
  const avatarUrl = getPortraitUrlForUnitId(unitId);
  return `<div draggable="true" data-source="team" data-owner="${escapeHtml(owner)}" data-team-index="${teamIndex}" data-column="${escapeHtml(column)}" data-unit-id="${escapeHtml(unitId)}" class="relative inline-flex items-center justify-center rounded-lg border border-slate-700/80 bg-slate-950/85 p-1" title="${escapeHtml(unitId)}">
    <span class="inline-flex h-16 w-16 overflow-hidden rounded-md border border-slate-500/50 bg-slate-800/90">
      <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(unitId)}" class="h-full w-full object-cover" loading="lazy" onerror="this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}'" />
    </span>
    <button type="button" data-remove-unit="true" data-owner="${escapeHtml(owner)}" data-team-index="${teamIndex}" data-column="${escapeHtml(column)}" data-unit-id="${escapeHtml(unitId)}" class="absolute -right-1 -top-1 rounded-full border border-rose-400/70 bg-rose-500/90 px-1.5 py-0 text-xs font-black text-white">x</button>
  </div>`;
}

function renderBuilderDropColumn(team, teamIndex, column, title, owner = 'library') {
  const values = Array.isArray(team[column]) ? team[column] : [];
  return `<section class="rounded-xl border border-slate-700/80 bg-slate-900/65 p-3">
    <div class="mb-2 flex items-center justify-between gap-2">
      <h5 class="text-xs font-black uppercase tracking-[0.14em] text-slate-300">${escapeHtml(title)}</h5>
      <span class="text-xs text-slate-500">${values.length}</span>
    </div>
    <div data-dropzone="true" data-owner="${escapeHtml(owner)}" data-team-index="${teamIndex}" data-column="${escapeHtml(column)}" class="min-h-24 rounded-lg border border-dashed border-slate-600/70 bg-slate-950/55 p-2">
      ${values.length > 0
        ? `<div class="flex flex-wrap gap-2">${values.map((unitId) => renderBuilderTeamUnit(teamIndex, column, unitId, owner)).join('')}</div>`
        : '<p class="text-xs text-slate-500">Drop avatars here</p>'}
    </div>
  </section>`;
}

function renderBuilderTeamCard(team, teamIndex) {
  return `<article class="rounded-2xl border border-slate-700/80 bg-slate-950/60 p-3">
    <div class="mb-3 flex items-center justify-between gap-3">
      <div>
        <input type="text" data-team-name-input="true" data-team-index="${teamIndex}" value="${escapeHtml(team.name)}" class="w-full max-w-md rounded-md border border-slate-500/60 bg-slate-900/85 px-2.5 py-1.5 text-base font-black text-slate-100" />
      </div>
      <button type="button" data-remove-team="true" data-team-index="${teamIndex}" class="rounded-md border border-rose-400/45 bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-200 hover:border-rose-300">Remove Team</button>
    </div>
    <div class="grid gap-3 xl:grid-cols-3">
      ${renderBuilderDropColumn(team, teamIndex, 'core', 'Core', 'library')}
      ${renderBuilderDropColumn(team, teamIndex, 'flex', 'Flex', 'library')}
      ${renderBuilderDropColumn(team, teamIndex, 'mow', 'Machine of War', 'library')}
    </div>
  </article>`;
}

function renderExperimentTeamCard(team) {
  const safeTeam = ensureTeamShape(team);
  return `<article class="rounded-2xl border border-slate-700/80 bg-slate-950/60 p-3">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <input type="text" id="experiment-team-name-input" value="${escapeHtml(safeTeam.name)}" class="w-full max-w-md rounded-md border border-slate-500/60 bg-slate-900/85 px-2.5 py-1.5 text-base font-black text-slate-100" />
        <select id="experiment-team-type-select" class="rounded-md border border-slate-500/60 bg-slate-900/85 px-2.5 py-1.5 text-sm font-semibold text-slate-100">
          <option value="att" ${safeTeam.type === 'att' ? 'selected' : ''}>Attack</option>
          <option value="def" ${safeTeam.type === 'def' ? 'selected' : ''}>Defense</option>
          <option value="hybrid" ${safeTeam.type === 'hybrid' ? 'selected' : ''}>Hybrid</option>
        </select>
      </div>
      ${renderTypePill(safeTeam.type)}
    </div>
    <div class="grid gap-3 xl:grid-cols-3">
      ${renderBuilderDropColumn(safeTeam, 0, 'core', 'Core', 'experiment')}
      ${renderBuilderDropColumn(safeTeam, 0, 'flex', 'Flex', 'experiment')}
      ${renderBuilderDropColumn(safeTeam, 0, 'mow', 'Machine of War', 'experiment')}
    </div>
    ${renderTeamCoreMatchAccordion(safeTeam, { showAllWhenNoCore: true })}
  </article>`;
}

function renderBuilderPool() {
  const poolList = document.getElementById('builder-pool-list');
  const poolCount = document.getElementById('builder-pool-count');
  if (!poolList) return;

  const query = String(teamsState.libraryPoolSearch || '').trim().toLowerCase();
  const allIds = getAllUnitIds();
  const filteredIds = query
    ? allIds.filter((unitId) => unitId.toLowerCase().includes(query))
    : allIds;

  if (poolCount) poolCount.textContent = String(filteredIds.length);
  poolList.innerHTML = filteredIds.map((unitId) => renderBuilderPoolUnit(unitId, 'library')).join('');
}

function renderExperimentPool() {
  const poolList = document.getElementById('experiment-pool-list');
  const poolCount = document.getElementById('experiment-pool-count');
  if (!poolList) return;

  const query = String(teamsState.experimentPoolSearch || '').trim().toLowerCase();
  const allIds = getAllUnitIds();
  const filteredIds = query
    ? allIds.filter((unitId) => unitId.toLowerCase().includes(query))
    : allIds;

  if (poolCount) poolCount.textContent = String(filteredIds.length);
  poolList.innerHTML = filteredIds.map((unitId) => renderBuilderPoolUnit(unitId, 'experiment')).join('');
}

function renderBuilderTeams() {
  const container = document.getElementById('builder-teams-list');
  if (!container) return;

  container.innerHTML = teamsState.teams
    .map((team, index) => renderBuilderTeamCard(ensureTeamShape(team), index))
    .join('');
}

function renderExperimentTeam() {
  const container = document.getElementById('experiment-team-stage');
  if (!container) return;

  container.innerHTML = renderExperimentTeamCard(ensureTeamShape(teamsState.experimentTeam));
}

function updateBuilderJsonOutput() {
  const output = document.getElementById('builder-json-output');
  if (!output) return;
  output.value = JSON.stringify(teamsState.teams, null, 2);
}

function rerenderAllTeamViews() {
  renderTeams();
  renderBuilderTeams();
  renderExperimentTeam();
  updateBuilderJsonOutput();
}

function rerenderBuilderViewsOnly() {
  renderBuilderTeams();
  renderExperimentTeam();
  updateBuilderJsonOutput();
}

function updateLibraryAndJsonOnly() {
  renderTeams();
  updateBuilderJsonOutput();
}

function createEmptyTeam() {
  const teamNumber = teamsState.nextTeamNumber;
  teamsState.nextTeamNumber += 1;
  return {
    name: `New Team ${teamNumber}`,
    type: 'hybrid',
    core: [],
    flex: [],
    mow: []
  };
}

function createExperimentTeam() {
  return {
    name: 'Sandbox Team',
    type: 'hybrid',
    core: [],
    flex: [],
    mow: []
  };
}

function removeUnitFromAllColumns(team, unitId) {
  TEAM_COLUMNS.forEach((column) => {
    team[column] = (team[column] || []).filter((id) => id !== unitId);
  });
}

function addUnitToColumn(team, column, unitId) {
  if (!TEAM_COLUMNS.includes(column)) return;
  if (!Array.isArray(team[column])) team[column] = [];
  removeUnitFromAllColumns(team, unitId);
  team[column].push(unitId);
}

function parseDragPayload(rawText) {
  if (!rawText) return teamsState.dragPayload;
  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (error) {
    return teamsState.dragPayload;
  }
  return teamsState.dragPayload;
}

function setupFilterEvents() {
  const filterRoot = document.getElementById('team-type-filter');
  if (!filterRoot) return;

  filterRoot.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;

    const nextFilter = String(button.getAttribute('data-filter') || 'all').toLowerCase();
    if (!['all', 'att', 'def', 'hybrid'].includes(nextFilter)) return;

    teamsState.activeFilter = nextFilter;
    syncFilterButtonStates();
    renderTeams();
  });
}

function setupCompSortEvents() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-comp-sort]');
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const nextMode = String(button.getAttribute('data-comp-sort') || '').trim().toLowerCase();
    if (!['uses', 'avg-desc', 'avg-asc'].includes(nextMode)) return;
    if (teamsState.compSortMode === nextMode) return;

    teamsState.compSortMode = nextMode;
    rerenderAllTeamViews();
  });

  document.addEventListener('input', (event) => {
    const input = event.target.closest('input[data-comp-min-uses="true"]');
    if (!input) return;

    const rawValue = String(input.value || '').trim();
    if (!rawValue) {
      teamsState.compMinUses = '';
      rerenderAllTeamViews();
      return;
    }

    const numericValue = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(numericValue) || numericValue < 0) return;

    teamsState.compMinUses = String(numericValue);
    rerenderAllTeamViews();
  });
}

function syncTabButtonStates() {
  const libraryBtn = document.getElementById('tab-btn-library');
  const teamBuilderBtn = document.getElementById('tab-btn-team-builder');
  const libraryBuilderBtn = document.getElementById('tab-btn-library-builder');
  const libraryPanel = document.getElementById('tab-panel-library');
  const teamBuilderPanel = document.getElementById('tab-panel-team-builder');
  const libraryBuilderPanel = document.getElementById('tab-panel-library-builder');
  if (!libraryBtn || !teamBuilderBtn || !libraryBuilderBtn || !libraryPanel || !teamBuilderPanel || !libraryBuilderPanel) return;

  const isLibrary = teamsState.activeTab === 'library';
  const isTeamBuilder = teamsState.activeTab === 'team-builder';
  const isLibraryBuilder = teamsState.activeTab === 'library-builder';

  libraryPanel.classList.toggle('hidden', !isLibrary);
  teamBuilderPanel.classList.toggle('hidden', !isTeamBuilder);
  libraryBuilderPanel.classList.toggle('hidden', !isLibraryBuilder);

  const applyTabStyles = (button, isActive) => {
    button.classList.toggle('text-cyan-300', isActive);
    button.classList.toggle('border-cyan-400', isActive);
    button.classList.toggle('text-slate-400', !isActive);
    button.classList.toggle('border-transparent', !isActive);
  };

  applyTabStyles(libraryBtn, isLibrary);
  applyTabStyles(teamBuilderBtn, isTeamBuilder);
  applyTabStyles(libraryBuilderBtn, isLibraryBuilder);
}

function setupTabEvents() {
  const libraryBtn = document.getElementById('tab-btn-library');
  const teamBuilderBtn = document.getElementById('tab-btn-team-builder');
  const libraryBuilderBtn = document.getElementById('tab-btn-library-builder');
  if (!libraryBtn || !teamBuilderBtn || !libraryBuilderBtn) return;

  libraryBtn.addEventListener('click', () => {
    teamsState.activeTab = 'library';
    syncTabButtonStates();
  });

  teamBuilderBtn.addEventListener('click', () => {
    teamsState.activeTab = 'team-builder';
    syncTabButtonStates();
  });

  libraryBuilderBtn.addEventListener('click', () => {
    teamsState.activeTab = 'library-builder';
    syncTabButtonStates();
  });
}

function setupBuilderEvents() {
  const libraryPoolSearch = document.getElementById('builder-pool-search');
  const experimentPoolSearch = document.getElementById('experiment-pool-search');
  const libraryPoolList = document.getElementById('builder-pool-list');
  const experimentPoolList = document.getElementById('experiment-pool-list');
  const libraryTeamsList = document.getElementById('builder-teams-list');
  const experimentTeamStage = document.getElementById('experiment-team-stage');
  const copyBtn = document.getElementById('builder-copy-json');
  const addTeamBtn = document.getElementById('builder-add-team');

  if (libraryPoolSearch) {
    libraryPoolSearch.addEventListener('input', (event) => {
      teamsState.libraryPoolSearch = String(event.target.value || '');
      renderBuilderPool();
    });
  }

  if (experimentPoolSearch) {
    experimentPoolSearch.addEventListener('input', (event) => {
      teamsState.experimentPoolSearch = String(event.target.value || '');
      renderExperimentPool();
    });
  }

  const getTeamForOwner = (owner, teamIndex) => {
    if (owner === 'experiment') {
      return teamsState.experimentTeam;
    }

    if (!Number.isInteger(teamIndex) || teamIndex < 0 || teamIndex >= teamsState.teams.length) {
      return null;
    }

    return teamsState.teams[teamIndex];
  };

  let activeDropzone = null;

  const clearActiveDropzone = () => {
    if (!activeDropzone) return;
    activeDropzone.classList.remove('border-cyan-400/70', 'bg-cyan-500/10');
    activeDropzone = null;
  };

  const setActiveDropzone = (zone) => {
    if (activeDropzone === zone) return;
    clearActiveDropzone();
    if (!zone) return;
    zone.classList.add('border-cyan-400/70', 'bg-cyan-500/10');
    activeDropzone = zone;
  };

  const refreshAfterBuilderMutation = () => {
    rerenderBuilderViewsOnly();
    if (teamsState.activeTab === 'library') {
      renderTeams();
    }
  };

  const setDragPayloadFromElement = (element) => {
    if (!element) return null;
    const source = String(element.getAttribute('data-source') || '');
    const owner = String(element.getAttribute('data-owner') || 'library');
    const unitId = String(element.getAttribute('data-unit-id') || '');
    if (!source || !unitId) return null;

    const payload = {
      source,
      owner,
      unitId,
      teamIndex: Number(element.getAttribute('data-team-index')),
      column: String(element.getAttribute('data-column') || '')
    };
    teamsState.dragPayload = payload;
    return payload;
  };

  const handleDragStart = (event) => {
    const element = event.target.closest('[draggable="true"]');
    const payload = setDragPayloadFromElement(element);
    if (!payload) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/json', JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', JSON.stringify(payload));
  };

  const handleDragEnd = () => {
    clearActiveDropzone();
    teamsState.dragPayload = null;
  };

  [libraryPoolList, experimentPoolList, libraryTeamsList, experimentTeamStage]
    .filter(Boolean)
    .forEach((element) => {
      element.addEventListener('dragstart', handleDragStart);
      element.addEventListener('dragend', handleDragEnd);
    });

  if (libraryTeamsList) {
    libraryTeamsList.addEventListener('click', (event) => {
      const removeTeamBtn = event.target.closest('[data-remove-team="true"]');
      if (removeTeamBtn) {
        const teamIndex = Number(removeTeamBtn.getAttribute('data-team-index'));
        if (Number.isInteger(teamIndex) && teamIndex >= 0 && teamIndex < teamsState.teams.length) {
          teamsState.teams.splice(teamIndex, 1);
          refreshAfterBuilderMutation();
        }
        return;
      }

      const removeBtn = event.target.closest('[data-remove-unit="true"]');
      if (!removeBtn) return;

      const teamIndex = Number(removeBtn.getAttribute('data-team-index'));
      const column = String(removeBtn.getAttribute('data-column') || '');
      const unitId = String(removeBtn.getAttribute('data-unit-id') || '');
      const owner = String(removeBtn.getAttribute('data-owner') || 'library');
      const team = getTeamForOwner(owner, teamIndex);
      if (!team || !TEAM_COLUMNS.includes(column)) return;

      team[column] = (team[column] || []).filter((id) => id !== unitId);
      refreshAfterBuilderMutation();
    });

    libraryTeamsList.addEventListener('input', (event) => {
      const input = event.target.closest('[data-team-name-input="true"]');
      if (!input) return;

      const teamIndex = Number(input.getAttribute('data-team-index'));
      if (!Number.isInteger(teamIndex) || teamIndex < 0 || teamIndex >= teamsState.teams.length) return;

      teamsState.teams[teamIndex].name = String(input.value || '').trim() || `Team ${teamIndex + 1}`;
      updateLibraryAndJsonOnly();
    });
  }

  if (experimentTeamStage) {
    experimentTeamStage.addEventListener('click', (event) => {
      const removeBtn = event.target.closest('[data-remove-unit="true"]');
      if (!removeBtn) return;

      const column = String(removeBtn.getAttribute('data-column') || '');
      const unitId = String(removeBtn.getAttribute('data-unit-id') || '');
      const owner = String(removeBtn.getAttribute('data-owner') || 'experiment');
      const team = getTeamForOwner(owner, 0);
      if (!team || !TEAM_COLUMNS.includes(column)) return;

      team[column] = (team[column] || []).filter((id) => id !== unitId);
      refreshAfterBuilderMutation();
    });

    experimentTeamStage.addEventListener('input', (event) => {
      const nameInput = event.target.closest('#experiment-team-name-input');
      if (nameInput && teamsState.experimentTeam) {
        teamsState.experimentTeam.name = String(nameInput.value || '').trim() || 'Sandbox Team';
        renderExperimentTeam();
      }
    });

    experimentTeamStage.addEventListener('change', (event) => {
      const typeSelect = event.target.closest('#experiment-team-type-select');
      if (!typeSelect || !teamsState.experimentTeam) return;

      const nextType = String(typeSelect.value || '').trim().toLowerCase();
      if (!['att', 'def', 'hybrid'].includes(nextType)) return;

      teamsState.experimentTeam.type = nextType;
      renderExperimentTeam();
    });
  }

  [libraryTeamsList, experimentTeamStage]
    .filter(Boolean)
    .forEach((container) => {
      container.addEventListener('dragover', (event) => {
      event.preventDefault();
      const zone = event.target.closest('[data-dropzone="true"]');
      if (!zone) {
        setActiveDropzone(null);
        return;
      }
      event.dataTransfer.dropEffect = 'move';
      setActiveDropzone(zone);
      });

      container.addEventListener('dragleave', (event) => {
      const toElement = event.relatedTarget;
      if (toElement && container.contains(toElement)) return;
      setActiveDropzone(null);
      });

      container.addEventListener('drop', (event) => {
      const zone = event.target.closest('[data-dropzone="true"]');
      if (!zone) return;

      event.preventDefault();
      event.stopPropagation();
      setActiveDropzone(null);

      const rawPayload = event.dataTransfer.getData('application/json') || event.dataTransfer.getData('text/plain');
      const payload = parseDragPayload(rawPayload);
      if (!payload || !payload.unitId) return;

      const targetTeamIndex = Number(zone.getAttribute('data-team-index'));
      const targetColumn = String(zone.getAttribute('data-column') || '');
      const targetOwner = String(zone.getAttribute('data-owner') || 'library');
      const targetTeam = getTeamForOwner(targetOwner, targetTeamIndex);
      if (!targetTeam || !TEAM_COLUMNS.includes(targetColumn)) return;

      if (payload.source === 'team' && Number.isInteger(payload.teamIndex) && TEAM_COLUMNS.includes(payload.column)) {
        const sourceOwner = String(payload.owner || 'library');
        const sourceTeam = getTeamForOwner(sourceOwner, payload.teamIndex);
        if (sourceTeam) {
          sourceTeam[payload.column] = (sourceTeam[payload.column] || []).filter((id) => id !== payload.unitId);
        }
      }

      addUnitToColumn(targetTeam, targetColumn, payload.unitId);
      refreshAfterBuilderMutation();
      });
    });

  if (addTeamBtn) {
    addTeamBtn.addEventListener('click', () => {
      teamsState.teams.unshift(createEmptyTeam());
      refreshAfterBuilderMutation();
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const output = document.getElementById('builder-json-output');
      if (!output) return;
      try {
        await navigator.clipboard.writeText(output.value || '');
        copyBtn.textContent = 'Copied';
        window.setTimeout(() => {
          copyBtn.textContent = 'Copy JSON';
        }, 1200);
      } catch (error) {
        copyBtn.textContent = 'Copy failed';
        window.setTimeout(() => {
          copyBtn.textContent = 'Copy JSON';
        }, 1200);
      }
    });
  }
}

async function initGuildTeamsPage() {
  await Promise.all([loadPortraitMap(), loadPortraitManifest(), loadTeamsData(), loadBattleLogsData()]);
  teamsState.teams = teamsState.teams.map((team) => ensureTeamShape(team));
  teamsState.experimentTeam = ensureTeamShape(createExperimentTeam());
  teamsState.nextTeamNumber = teamsState.teams.length + 1;

  setupTabEvents();
  setupFilterEvents();
  setupCompSortEvents();
  setupBuilderEvents();

  syncTabButtonStates();
  syncFilterButtonStates();
  renderBuilderPool();
  renderExperimentPool();
  rerenderAllTeamViews();
}

initGuildTeamsPage();
