const DATASETS = {
  current: {
    label: 'Active war',
    sourceLabel: 'Current snapshot',
    url: './data/current/live-war.json'
  },
  history: {
    label: 'Complete wars',
    sourceLabel: 'History snapshot',
    url: './data/history/65648500-b63c-4a80-8862-c36e9e7d800f.json'
  }
};

let activeDatasetKey = 'current';

function getDatasetKeyFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const dataset = params.get('dataset');
  if (dataset && Object.prototype.hasOwnProperty.call(DATASETS, dataset)) {
    return dataset;
  }
  return 'current';
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
const MISSING_UNIT_AVATAR_URL = './missing-unit.svg';
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

const MAX_TOKEN_SCORE = 1600;
const TOKEN_SLOTS_PER_PLAYER = 10;
const POSSIBLE_TILE_SCORE = 520000; // 6*10k + 20*16k + 2*30k + 2*40k
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
    return `<span class="score-display"><span class="score-core">${core.toLocaleString()}</span><span class="score-bonus">(${bonus.toLocaleString()})</span></span>`;
  }

  return `<span class="score-display"><span class="score-core">${core.toLocaleString()}</span></span>`;
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

function getLatestActivityTimestamp(data) {
  const logs = data?.eventResults?.[0]?.eventResponseData?.activityLogs;
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
    ? `<img class="player-avatar" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(avatarAlt)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
    : '';
  const frameImg = frameSrc
    ? `<img class="player-avatar-frame" src="${escapeHtml(frameSrc)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
    : '';

  return `<span class="player-avatar-stack">${avatarImg}${frameImg}</span>`;
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
    const safe = escapeHtml(name);
    const color = colorFor(name);
    return `<span class="buff-circle" title="${safe}" style="background:${color}"></span>`;
  });

  return `<div class="buffs-row">${items.join('')}</div>`;
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
  const eventResult = data?.eventResults?.[0];
  const playerData = eventResult?.eventResponseData?.playerData || [];
  const activityLogs = eventResult?.eventResponseData?.activityLogs || [];
  const guildData = eventResult?.eventResponseData?.guildData || [];
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

  if (!datasetSelect.dataset.initialized) {
    datasetSelect.innerHTML = '';

    Object.entries(DATASETS).forEach(([datasetKey, dataset]) => {
      const option = document.createElement('option');
      option.value = datasetKey;
      option.textContent = dataset.label;
      datasetSelect.appendChild(option);
    });

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
    const response = await fetch('./img/unit-portrait-map.json', { cache: 'no-store' });
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
    return '<span class="battle-unit-chip battle-unit-chip--empty">No units captured</span>';
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
        ? (side === 'defender' ? ' battle-unit-chip--match-defense' : ' battle-unit-chip--match-offense')
        : '';
      const sideMutedClass = hasActiveSideFilter && !isMatched ? ' battle-unit-chip--muted' : '';
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
        ? `<span class="battle-unit-mini-health" title="${escapeHtml(unitLabel)} start HP: ${Math.round(currentHp).toLocaleString()} / ${Math.round(startHp).toLocaleString()}"><span class="battle-unit-mini-health-fill" style="width:${percent}%; background:${healthColor}"></span></span>`
        : '';

      return `<span class="battle-unit-stack"><span class="battle-unit-chip${sideMatchClass}${sideMutedClass}" title="${escapeHtml(unitLabel)}"><img class="battle-unit-avatar" src="${escapeHtml(safeAvatarUrl)}" alt="${escapeHtml(unitLabel)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}';"></span>${healthBarHtml}</span>`;
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
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'battle-filter-chip';
    chip.setAttribute('data-player-value', selectedOption.value);
    chip.innerHTML = `
      <img class="battle-filter-chip-avatar" src="${escapeHtml(selectedOption.avatarUrl || MISSING_UNIT_AVATAR_URL)}" alt="${escapeHtml(selectedOption.label)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}';">
      <span class="battle-filter-chip-label">${escapeHtml(selectedOption.label)}</span>
      <span class="battle-filter-chip-remove" aria-hidden="true">x</span>
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
    empty.className = 'battle-filter-option-empty';
    empty.textContent = 'No matching players';
    optionsContainer.appendChild(empty);
    return;
  }

  filteredOptions.forEach((optionData) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `battle-filter-option ${selectedSet.has(optionData.value) ? 'battle-filter-option--selected' : ''}`;
    option.setAttribute('data-player-value', optionData.value);
    option.innerHTML = `
      <img class="battle-filter-option-avatar" src="${escapeHtml(optionData.avatarUrl || MISSING_UNIT_AVATAR_URL)}" alt="${escapeHtml(optionData.label)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}';">
      <span class="battle-filter-option-label">${escapeHtml(optionData.label)}</span>
      <span class="battle-filter-option-check" aria-hidden="true">${selectedSet.has(optionData.value) ? '✓' : ''}</span>
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
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'battle-filter-chip';
    chip.setAttribute('data-unit-id', unitId);
    chip.innerHTML = `
      <img class="battle-filter-chip-avatar" src="${escapeHtml(getBattleUnitAvatarUrlFromUnitId(unitId) || MISSING_UNIT_AVATAR_URL)}" alt="${escapeHtml(unitId)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}';">
      <span class="battle-filter-chip-label">${escapeHtml(unitId)}</span>
      <span class="battle-filter-chip-remove" aria-hidden="true">x</span>
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
    empty.className = 'battle-filter-option-empty';
    empty.textContent = 'No matching characters';
    optionsContainer.appendChild(empty);
    return;
  }

  filteredIds.forEach((unitId) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `battle-filter-option ${selectedSet.has(unitId) ? 'battle-filter-option--selected' : ''}`;
    option.setAttribute('data-unit-id', unitId);
    option.innerHTML = `
      <img class="battle-filter-option-avatar" src="${escapeHtml(getBattleUnitAvatarUrlFromUnitId(unitId) || MISSING_UNIT_AVATAR_URL)}" alt="${escapeHtml(unitId)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null; this.src='${MISSING_UNIT_AVATAR_URL}';">
      <span class="battle-filter-option-label">${escapeHtml(unitId)}</span>
      <span class="battle-filter-option-check" aria-hidden="true">${selectedSet.has(unitId) ? '✓' : ''}</span>
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
  const resultButtons = resultGroup ? Array.from(resultGroup.querySelectorAll('.battle-filter-result-btn')) : [];
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
      button.classList.toggle('battle-filter-result-btn--active', isActive);
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
    battleList.innerHTML = '<div class="battle-log-empty">No battles found for this guild yet.</div>';
    return;
  }

  if (filteredBattles.length === 0) {
    battleList.innerHTML = '<div class="battle-log-empty">No battles match the selected filters.</div>';
    return;
  }

  filteredBattles.forEach((battle) => {
    let stateClass = 'value-cell--neutral';
    let stateLabel = 'Neutral';
    let scoreDisplay = '<span class="score-display"><span class="score-core">0</span></span>';
    let bonusDisplay = '';

    if (battle.abandoned) {
      stateClass = 'value-cell--neutral';
      stateLabel = 'Abandoned';
      scoreDisplay = '🛑';
    } else if (!battle.hasScore) {
      stateClass = 'value-cell--lose';
      stateLabel = 'Defeat';
      scoreDisplay = '<span class="score-display"><span class="score-core">0</span></span>';
    } else if (Number(battle.score || 0) > 0) {
      const { core, bonus } = getCoreScore(Number(battle.score || 0));
      stateClass = battle.defended ? 'value-cell--lose' : 'value-cell--win';
      stateLabel = battle.defended ? 'Defeat' : 'Win';
      scoreDisplay = `<span class="score-display"><span class="score-core">${core.toLocaleString()}</span></span>`;
      bonusDisplay = bonus > 0 ? `<span class="battle-score-bonus">(${bonus.toLocaleString()})</span>` : '';
    }

    const cleanupHtml = battle.cleanup ? '<span class="cleanup-icon" title="Cleanup">🧹</span>' : '';
    const zoneLabel = battle.zoneType ? `<span class="battle-zone">${escapeHtml(battle.zoneType)}</span>` : '';
    const item = document.createElement('article');
    item.className = 'battle-log-item';
    const attackerSideUnits = buildBattleSideUnits(battle.attackerUnits, battle.attackerMachineOfWar);
    const defenderSideUnits = buildBattleSideUnits(battle.defenderUnits, battle.defenderMachineOfWar);
    item.innerHTML = `
      <div class="battle-side battle-side--attacker">
        <div class="battle-player-name">${escapeHtml(battle.attackerName)}</div>
        <div class="battle-units">${renderBattleUnits(attackerSideUnits, 'attacker')}</div>
      </div>
      <div class="battle-score-wrap">
        <span class="value-cell ${stateClass}">${scoreDisplay}</span>
        ${bonusDisplay}
        <span class="battle-state-label">${escapeHtml(stateLabel)}</span>
        ${cleanupHtml}
        ${zoneLabel}
      </div>
      <div class="battle-side battle-side--defender">
        <div class="battle-player-name">${escapeHtml(battle.defenderName)}</div>
        <div class="battle-units">${renderBattleUnits(defenderSideUnits, 'defender')}</div>
      </div>
    `;

    battleList.appendChild(item);
  });
}

function renderTable(snapshot) {
  const summary = summarizeGuild(snapshot);
  const rows = summary.rows;
  const leaderboardBody = document.getElementById('leaderboard-body');

  if (!leaderboardBody) return;

  leaderboardBody.innerHTML = '';

  rows.forEach((player, index) => {
    const row = document.createElement('tr');
    row.className = 'animate__animated animate__fadeInUp';
    row.style.animationDelay = `${index * 40}ms`;
    const avatarHtml = renderPlayerAvatar(player);

    const cells = [
      `<td class="sticky left-0 z-10 px-4 py-3 bg-slate-900/95 player-name-column"><div class="flex items-center gap-2"><span class="row-number">${index + 1}</span>${avatarHtml}<div class="min-w-0"><div class="player-name-row"><span class="player-name-text">${escapeHtml(player.name)} (${player.usedTokens}/10)</span><button class="copy-user-id-btn" type="button" data-user-id="${player.userId}" title="Copy user ID">⧉</button></div><div class="player-id-subtext" aria-hidden="true">${escapeHtml(player.userId)}</div></div></div></td>`,
      ...player.tokens.map((token) => {
        const tokenScore = Number(token.score || 0);
        const isUnused = !('hasScore' in token);
        const abandoned = !!token.abandoned;
        const cleanup = !!token.cleanup;
        const cleanupHtml = cleanup ? `<span class="cleanup-icon" title="Cleanup">🧹</span>` : '';

        let display = '';
        let stateClass = 'value-cell--neutral';

        if (isUnused) {
          // No battle at all - grey with dash
          display = '—';
          stateClass = 'value-cell--neutral';
        } else if (abandoned) {
          // Abandoned battle - show stop sign
          display = '🛑';
          stateClass = 'value-cell--neutral';
        } else if (!token.hasScore) {
          // Battle exists, not abandoned, no score - show 0 in red
          display = `<span class="score-display"><span class="score-core">0</span></span>`;
          stateClass = 'value-cell--lose';
        } else if (tokenScore > 0) {
          // Battle with score - win if not defended, loss if defended
          display = formatValue(tokenScore);
          stateClass = token.defended ? 'value-cell--lose' : 'value-cell--win';
        } else {
          // Battle with 0 score - neutral
          display = `<span class="score-display"><span class="score-core">0</span></span>`;
          stateClass = 'value-cell--neutral';
        }

        const classes = `value-cell ${stateClass}`;
        const buffsHtml = renderBuffs(token.buffs);
        return `<td class="px-4 py-3"><div class="flex items-center gap-2"><span class="${classes}">${display}</span>${cleanupHtml}</div>${buffsHtml}</td>`;
      }),
      `<td class="px-4 py-3"><span class="font-semibold text-amber-300">${player.totalScore.toLocaleString()}</span></td>`,
      `<td class="px-4 py-3"><span class="text-cyan-300">${player.averageScore.toLocaleString()}</span></td>`,
      `<td class="px-4 py-3"><span class="text-violet-300 font-semibold">${player.totalSkillRating.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></td>`
    ];

    row.innerHTML = cells.join('');
    leaderboardBody.appendChild(row);
  });

  leaderboardBody.querySelectorAll('.copy-user-id-btn').forEach((button) => {
    button.addEventListener('click', async (event) => {
      const userId = event.currentTarget.getAttribute('data-user-id');

      if (!userId) return;

      try {
        await navigator.clipboard.writeText(userId);
        event.currentTarget.textContent = '✓';
        window.setTimeout(() => {
          event.currentTarget.textContent = '⧉';
        }, 1200);
      } catch (error) {
        console.error('Unable to copy user ID', error);
      }
    });
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
}

function renderBuffLegend(snapshot) {
  const legendContainer = document.getElementById('buff-legend');
  if (!legendContainer) return;

  const tokenItems = [
    '<div class="buff-legend-item"><span class="legend-icon">🟩</span><span class="label">Win</span></div>',
    '<div class="buff-legend-item"><span class="legend-icon">🟥</span><span class="label">Defeat</span></div>',
    '<div class="buff-legend-item"><span class="legend-icon">⬜</span><span class="label">Abandoned / unused</span></div>',
    '<div class="buff-legend-item"><span class="legend-icon">🧹</span><span class="label">Cleanup</span></div>'
  ];

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

  const buffItems = Array.from(seen.entries()).map(([name, color]) => {
    return `<div class="buff-legend-item"><span class="buff-circle" style="background:${color}"></span><span class="label">${escapeHtml(name)}</span></div>`;
  });

  legendContainer.innerHTML = `
    <div class="buff-legend-sections">
      <div class="buff-legend-group">
        <div class="legend-title">Token</div>
        <div class="buff-legend">${tokenItems.join('')}</div>
      </div>
      <div class="buff-legend-group">
        <div class="legend-title">Buff groups</div>
        <div class="buff-legend">${buffItems.join('') || '<div class="buff-legend-item"><span class="legend-icon">—</span><span class="label">No buff groups</span></div>'}</div>
      </div>
    </div>
  `;
}

async function loadGuildData() {
  const statusMessage = document.getElementById('status-message');
  const lastUpdatedEl = document.getElementById('last-updated');
  const dataset = DATASETS[activeDatasetKey];

  if (!dataset) {
    console.error(`Unknown dataset key: ${activeDatasetKey}`);
    return;
  }

  renderDatasetTabs();
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

activeDatasetKey = getDatasetKeyFromUrl();
updateDatasetInUrl(activeDatasetKey);
loadGuildData();
