// Raid Log: one table row per raid entry across every tracked season.
// Data comes from Supabase (raid_entries) with the per-season JSON files as fallback,
// mirroring the loading strategy in guild-raid.js.
const RAID_CURRENT_URL = './data/raid/current.json';
const RAID_MANIFEST_URL = './data/raid/manifest.json';
const PLAYER_DIRECTORY_URL = './data/static/players.json';
const MISSING_UNIT_AVATAR_URL = './img/missing-unit.svg';
const AVATAR_BASE_URL = 'https://webstore-assets.loki.snowprintstudios.com/live/images';
const AVATAR_FRAME_URLS = {
  frameMythic01: 'https://tacticus.xyz/assets/frames/ui_avatar_frame_framemythic01-90960f24.png'
};

const RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];
const RARITY_BADGES = {
  Common: 'border-slate-400/40 bg-slate-500/15 text-slate-200',
  Uncommon: 'border-amber-700/50 bg-amber-800/25 text-amber-500',
  Rare: 'border-zinc-300/40 bg-zinc-300/10 text-zinc-200',
  Epic: 'border-yellow-400/40 bg-yellow-500/15 text-yellow-200',
  Legendary: 'border-violet-400/40 bg-violet-500/15 text-violet-200',
  Mythic: 'border-orange-400/45 bg-orange-500/15 text-orange-200'
};

// Virtual scrolling: keep the rendered window around the viewport and use
// spacer rows so the scrollbar still represents the full filtered list.
const ROW_HEIGHT_PX = 52;
const OVERSCAN_ROWS = 12;

const raidLogState = {
  loading: true,
  seasonsMeta: [],
  currentSeason: null,
  entries: [],
  players: new Map(),
  portraitMap: {},
  portraitKeyIndex: new Map(),
  portraitManifestSet: new Set(),
  filters: {
    // Sort by column key; click toggles direction. Default: newest first.
    sortKey: 'date',
    sortDirection: 'desc',
    // Defaults to the current season once known; other seasons load on demand.
    seasons: [],
    players: [],
    bosses: [],
    rarities: [],
    characters: [],
    mows: [],
    encounter: 'boss',
    damageType: 'battle',
    result: 'all'
  },
  // Which seasons have had their entries fetched already.
  loadedSeasons: new Set(),
  seasonLoadsInFlight: new Set(),
  // Virtual scroll window state.
  filteredEntries: [],
  scrollTop: 0,
  viewportHeight: 900,
  // Option pools grow as seasons load; Sets/Maps keep dedupe cheap.
  optionPools: {
    seasons: new Set(),
    players: new Set(),
    bosses: new Map(),
    rarities: new Set(),
    characters: new Map(),
    mows: new Map()
  },
  renderScheduled: false
};

const numberFormatter = new Intl.NumberFormat('en-GB');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numberFormatter.format(Math.round(numeric)) : '0';
}

function formatCompactNumber(value) {
  const numeric = Number(value) || 0;
  if (numeric >= 1000000) return `${(numeric / 1000000).toFixed(numeric >= 10000000 ? 0 : 1)}M`;
  if (numeric >= 1000) return `${(numeric / 1000).toFixed(numeric >= 10000 ? 0 : 1)}K`;
  return formatNumber(numeric);
}

function formatTimestamp(value) {
  if (!value) return '-';
  const date = new Date(Number(value) * 1000);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function prettifyUnitName(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Unknown';
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim() || raw;
}

const FACTION_PREFIXES = ['adept', 'admec', 'astar', 'astra', 'black', 'blood', 'custo', 'darka', 'death', 'eldar', 'genes', 'necro', 'orks', 'space', 'thous', 'tyran', 'ultra', 'world', 'votann', 'tau'];

// Boss ids look like GuildBoss11MiniBoss1TauMarksman; strip the encounter and faction prefixes.
function getBossUnitKey(unitId) {
  const stripped = String(unitId || '').replace(/^GuildBoss\d*(Mini)?Boss\d*/i, '');
  if (!stripped) return '';
  return stripped.charAt(0).toLowerCase() + stripped.slice(1);
}

function getBossDisplayName(entry) {
  const unitKey = getBossUnitKey(entry.unitId);
  // `type` names the whole encounter, so side bosses have to be named from their own unit id.
  if (entry.encounterType !== 'SideBoss' && entry.type) return prettifyUnitName(entry.type);
  if (!unitKey) return prettifyUnitName(entry.type || entry.unitId);

  const faction = FACTION_PREFIXES.find((prefix) => unitKey.toLowerCase().startsWith(prefix));
  const name = faction ? unitKey.slice(faction.length) : unitKey;
  return prettifyUnitName(name.charAt(0).toUpperCase() + name.slice(1));
}

// Hero/MoW ids look like orksWarboss; strip the faction prefix for a friendly label.
function getUnitDisplayName(unitId) {
  const raw = String(unitId || '').trim();
  if (!raw) return 'Unknown';
  const faction = FACTION_PREFIXES.find((prefix) => raw.toLowerCase().startsWith(prefix));
  const name = faction ? raw.slice(faction.length) : raw;
  return prettifyUnitName(name.charAt(0).toUpperCase() + name.slice(1));
}

function getPlayer(userId) {
  return raidLogState.players.get(String(userId || '')) || null;
}

function getPlayerName(userId) {
  const player = getPlayer(userId);
  if (player && player.name) return player.name;
  return `Unknown (${String(userId || '').slice(0, 8)})`;
}

function renderPlayerAvatar(userId) {
  const player = getPlayer(userId);
  const avatarUnitId = String(player?.avatarUnitId || '').trim().toLowerCase();
  const frameSrc = AVATAR_FRAME_URLS[player?.avatarFrameId] || null;

  const avatarImg = avatarUnitId
    ? `<img class="absolute inset-[3px] z-10 h-[26px] w-[26px] rounded-full bg-slate-900/95 object-cover" src="${escapeHtml(`${AVATAR_BASE_URL}/avatar_${avatarUnitId}.png`)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
    : '';
  const frameImg = frameSrc
    ? `<img class="pointer-events-none absolute inset-0 z-0 h-8 w-8 object-contain" src="${escapeHtml(frameSrc)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
    : '';

  return `<span class="relative h-8 w-8 shrink-0 rounded-full border border-slate-700/70 bg-slate-950/70">${avatarImg}${frameImg}</span>`;
}

function getPortraitUrlForUnitId(unitId) {
  const imageName = String((raidLogState.portraitMap || {})[unitId] || '').trim();
  if (!imageName) return MISSING_UNIT_AVATAR_URL;
  if (raidLogState.portraitManifestSet.has(imageName)) return `./img-temp/${imageName}`;
  return `./img/${imageName}`;
}

function getBossPortraitUrl(entry) {
  const portraitKey = raidLogState.portraitKeyIndex.get(getBossUnitKey(entry.unitId).toLowerCase()) || '';
  return portraitKey ? getPortraitUrlForUnitId(portraitKey) : MISSING_UNIT_AVATAR_URL;
}

function renderBossAvatar(entry, name) {
  const src = getBossPortraitUrl(entry);
  const shell = 'inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-700/70 bg-slate-950/70';

  if (src !== MISSING_UNIT_AVATAR_URL) {
    return `<span class="${shell}"><img src="${escapeHtml(src)}" alt="" class="h-full w-full object-cover" loading="lazy" onerror="this.src='${MISSING_UNIT_AVATAR_URL}'" /></span>`;
  }

  const initials = String(name || '').split(' ').map((word) => word.charAt(0)).join('').slice(0, 2).toUpperCase();
  return `<span class="${shell} text-sm font-black tracking-wide text-slate-400">${escapeHtml(initials || '?')}</span>`;
}

async function loadJson(url, fallback) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return fallback;
    const json = await response.json();
    return json ?? fallback;
  } catch (error) {
    return fallback;
  }
}

async function loadStaticData() {
  // Players come from Supabase (source of truth); the JSON directory is the
  // fallback. Portrait maps stay as static JSON — they are game assets.
  const [dbPlayers, players, portraitMap, imageManifest] = await Promise.all([
    window.supabaseData ? window.supabaseData.getPlayers().catch(() => null) : Promise.resolve(null),
    loadJson(PLAYER_DIRECTORY_URL, []),
    loadJson('./data/static/portrait-map.json', {}),
    loadJson('./data/static/image-manifest.json', [])
  ]);

  const directory = Array.isArray(dbPlayers) && dbPlayers.length > 0 ? dbPlayers : players;

  raidLogState.players = new Map(
    (Array.isArray(directory) ? directory : [])
      .filter((player) => player && player.id)
      .map((player) => [String(player.id), player])
  );
  raidLogState.portraitMap = portraitMap && typeof portraitMap === 'object' ? portraitMap : {};
  raidLogState.portraitKeyIndex = new Map(
    Object.keys(raidLogState.portraitMap).map((key) => [key.toLowerCase(), key])
  );
  raidLogState.portraitManifestSet = new Set(
    (Array.isArray(imageManifest) ? imageManifest : []).map((entry) => String(entry || '').trim()).filter(Boolean)
  );
}

async function loadSeasonManifest() {
  // Source of truth is the raid_seasons table; manifest.json is the fallback.
  const dbManifest = window.supabaseData
    ? await window.supabaseData.getRaidManifest().catch(() => null)
    : null;
  const manifest = dbManifest || await loadJson(RAID_MANIFEST_URL, null);
  const seasons = Array.isArray(manifest?.seasons) ? manifest.seasons : [];

  raidLogState.seasonsMeta = seasons
    .filter((season) => Number.isFinite(Number(season?.season)))
    .map((season) => ({ ...season, season: Number(season.season) }))
    .sort((left, right) => right.season - left.season);
  raidLogState.currentSeason = Number(manifest?.current);
}

async function loadSeasonEntries(seasonMeta) {
  const season = seasonMeta.season;
  const url = seasonMeta?.url || (season === raidLogState.currentSeason ? RAID_CURRENT_URL : `./data/raid/${season}.json`);

  // raid_entries is the source of truth; the season JSON file is the fallback.
  const raid = window.supabaseData
    ? (await window.supabaseData.getRaidSeason(season).catch(() => null)) || await loadJson(url, null)
    : await loadJson(url, null);

  const entries = Array.isArray(raid?.entries) ? raid.entries : [];
  entries.forEach((entry) => {
    entry.__season = season;
    entry.__time = Number(entry.completedOn || entry.startedOn) || 0;
  });
  return entries;
}

function indexEntryOptions(entry) {
  const pools = raidLogState.optionPools;
  pools.seasons.add(entry.__season);
  if (entry.userId) pools.players.add(String(entry.userId));
  if (entry.rarity) pools.rarities.add(entry.rarity);

  const bossId = getBossFilterId(entry);
  if (bossId && !pools.bosses.has(bossId)) {
    pools.bosses.set(bossId, {
      id: bossId,
      name: getBossDisplayName(entry),
      rarity: entry.rarity || '',
      portrait: getBossPortraitUrl(entry)
    });
  }

  (Array.isArray(entry.heroDetails) ? entry.heroDetails : []).forEach((hero) => {
    if (!hero?.unitId) return;
    if (!pools.characters.has(hero.unitId)) {
      pools.characters.set(hero.unitId, { id: hero.unitId, name: getUnitDisplayName(hero.unitId) });
    }
  });

  const mow = entry.machineOfWarDetails;
  if (mow?.unitId && !pools.mows.has(mow.unitId)) {
    pools.mows.set(mow.unitId, { id: mow.unitId, name: getUnitDisplayName(mow.unitId) });
  }
}

// Bosses repeat across seasons; rarity distinguishes the variants in the filter list.
function getBossFilterId(entry) {
  const name = getBossDisplayName(entry);
  if (!name) return '';
  return `${name}|${entry.rarity || ''}`;
}

function getSelectedSeasons() {
  return raidLogState.filters.seasons
    .map((season) => Number(season))
    .filter((season) => Number.isFinite(season));
}

// A season that just rolled over can sit at 0 entries for days; default to the
// current season only when it has data, else the newest season that does.
function getDefaultSeason() {
  const current = raidLogState.seasonsMeta.find((season) => season.season === raidLogState.currentSeason);
  if (current && (Number(current.entries) || 0) > 0) return current.season;
  // seasonsMeta is sorted newest-first.
  const withEntries = raidLogState.seasonsMeta.find((season) => (Number(season.entries) || 0) > 0);
  return withEntries ? withEntries.season : raidLogState.currentSeason;
}

// Fetch entries for any selected season that has not been loaded yet; the next
// scheduled render picks the rows up when they arrive.
async function ensureSeasonsLoaded() {
  const wanted = getSelectedSeasons();
  const missing = wanted.filter(
    (season) => !raidLogState.loadedSeasons.has(season) && !raidLogState.seasonLoadsInFlight.has(season)
  );
  if (missing.length === 0) return;

  missing.forEach((season) => raidLogState.seasonLoadsInFlight.add(season));
  raidLogState.loading = true;

  await Promise.all(missing.map(async (season) => {
    const meta = raidLogState.seasonsMeta.find((item) => item.season === season) || { season };
    const entries = await loadSeasonEntries(meta).catch(() => []);
    entries.forEach(indexEntryOptions);
    raidLogState.entries.push(...entries);
    raidLogState.loadedSeasons.add(season);
    raidLogState.seasonLoadsInFlight.delete(season);
    scheduleRender();
  }));

  if (raidLogState.seasonLoadsInFlight.size === 0) {
    raidLogState.loading = false;
  }
  renderRaidLog();
}

function scheduleRender() {
  if (raidLogState.renderScheduled) return;
  raidLogState.renderScheduled = true;
  requestAnimationFrame(() => {
    raidLogState.renderScheduled = false;
    renderRaidLog();
  });
}

function getSortedOptions(key) {
  const pools = raidLogState.optionPools;
  switch (key) {
    case 'season':
      return [...pools.seasons]
        .sort((a, b) => b - a)
        .map((season) => ({ id: String(season), label: `Season ${season}${season === raidLogState.currentSeason ? ' (live)' : ''}` }));
    case 'player':
      return [...pools.players]
        .map((userId) => ({ id: userId, label: getPlayerName(userId) }))
        .sort((a, b) => a.label.localeCompare(b.label));
    case 'boss':
      return [...pools.bosses.values()]
        .map((boss) => ({ ...boss, label: boss.name }))
        .sort((a, b) => a.name.localeCompare(b.name) || RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
    case 'rarity':
      return RARITY_ORDER
        .filter((rarity) => pools.rarities.has(rarity))
        .map((rarity) => ({ id: rarity, label: rarity }));
    case 'character':
      return [...pools.characters.values()]
        .map((unit) => ({ ...unit, label: unit.name }))
        .sort((a, b) => a.label.localeCompare(b.label));
    case 'mow':
      return [...pools.mows.values()]
        .map((unit) => ({ ...unit, label: unit.name }))
        .sort((a, b) => a.label.localeCompare(b.label));
    default:
      return [];
  }
}

const FILTER_KEY_BY_CONTROL = {
  season: 'seasons',
  player: 'players',
  boss: 'bosses',
  rarity: 'rarities',
  character: 'characters',
  mow: 'mows'
};

function toggleRaidFilterDropdown(key, isVisible) {
  const dropdown = document.getElementById(`raid-filter-${key}-dropdown`);
  if (!dropdown) return;
  dropdown.classList.toggle('hidden', !isVisible);
}

function renderMultiSelectControl(key) {
  const input = document.getElementById(`raid-filter-${key}-input`);
  const selectedContainer = document.getElementById(`raid-filter-${key}-selected`);
  const optionsContainer = document.getElementById(`raid-filter-${key}-options`);
  if (!input || !selectedContainer || !optionsContainer) return;

  const filterKey = FILTER_KEY_BY_CONTROL[key];
  const selectedIds = raidLogState.filters[filterKey] || [];
  const selectedSet = new Set(selectedIds);
  const filterText = String(input.value || '').trim().toLowerCase();
  const options = getSortedOptions(key).filter((option) => {
    if (!filterText) return true;
    return option.label.toLowerCase().includes(filterText) || option.id.toLowerCase().includes(filterText);
  });

  const chipTone = key === 'character' || key === 'mow'
    ? 'border-pink-400/45 bg-pink-900/40 text-pink-100'
    : 'border-sky-400/45 bg-sky-900/40 text-sky-100';
  const chipRemoveTone = key === 'character' || key === 'mow' ? 'text-pink-300' : 'text-sky-300';

  const byId = new Map(getSortedOptions(key).map((option) => [option.id, option]));

  selectedContainer.innerHTML = '';
  selectedIds.forEach((id) => {
    const option = byId.get(id) || { id, label: id };
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `inline-flex items-center gap-2 rounded-full border px-2 py-1 ${chipTone}`;
    chip.innerHTML = `
      <span class="text-sm font-semibold">${escapeHtml(option.label)}</span>
      <span class="text-sm ${chipRemoveTone}" aria-hidden="true">x</span>
    `;
    chip.addEventListener('click', (event) => {
      event.stopPropagation();
      raidLogState.filters[filterKey] = raidLogState.filters[filterKey].filter((selected) => selected !== id);
      resetScrollWindow();
      renderRaidLog();
      ensureSeasonsLoaded();
      toggleRaidFilterDropdown(key, true);
    });
    selectedContainer.appendChild(chip);
  });

  optionsContainer.innerHTML = '';
  if (options.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'px-2 py-2 text-xs text-slate-400';
    empty.textContent = 'No matching options';
    optionsContainer.appendChild(empty);
    return;
  }

  options.forEach((option) => {
    const isSelected = selectedSet.has(option.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-slate-200 hover:bg-slate-700/80 ${isSelected ? 'bg-sky-900/45' : ''}`;

    let icon = '';
    if (key === 'player') icon = renderPlayerAvatar(option.id);
    else if (key === 'boss' && option.portrait) icon = `<span class="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-700/70 bg-slate-950/70"><img src="${escapeHtml(option.portrait)}" alt="" class="h-full w-full object-cover" loading="lazy" onerror="this.src='${MISSING_UNIT_AVATAR_URL}'" /></span>`;
    else if (key === 'character' || key === 'mow') icon = `<span class="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-700/70 bg-slate-950/70"><img src="${escapeHtml(getPortraitUrlForUnitId(option.id))}" alt="" class="h-full w-full object-cover" loading="lazy" onerror="this.src='${MISSING_UNIT_AVATAR_URL}'" /></span>`;

    const rarityBadge = key === 'boss' && option.rarity
      ? `<span class="rounded border px-1 py-0.5 text-[10px] font-bold uppercase ${RARITY_BADGES[option.rarity] || RARITY_BADGES.Common}">${escapeHtml(option.rarity)}</span>`
      : '';

    button.innerHTML = `
      ${icon}
      <span class="text-sm font-semibold">${escapeHtml(option.label)}</span>
      ${rarityBadge}
      <span class="ml-auto text-base font-bold text-cyan-300" aria-hidden="true">${isSelected ? '✓' : ''}</span>
    `;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (selectedSet.has(option.id)) {
        raidLogState.filters[filterKey] = raidLogState.filters[filterKey].filter((selected) => selected !== option.id);
      } else {
        raidLogState.filters[filterKey] = [...raidLogState.filters[filterKey], option.id];
      }
      resetScrollWindow();
      renderRaidLog();
      ensureSeasonsLoaded();
      toggleRaidFilterDropdown(key, true);
      input.focus();
    });
    optionsContainer.appendChild(button);
  });
}

function entryMatchesFilters(entry) {
  const filters = raidLogState.filters;

  if (filters.seasons.length > 0 && !filters.seasons.includes(String(entry.__season))) return false;
  if (filters.players.length > 0 && !filters.players.includes(String(entry.userId || ''))) return false;
  if (filters.bosses.length > 0 && !filters.bosses.includes(getBossFilterId(entry))) return false;
  if (filters.rarities.length > 0 && !filters.rarities.includes(entry.rarity || '')) return false;

  if (filters.encounter !== 'all') {
    const wanted = filters.encounter === 'boss' ? 'Boss' : 'SideBoss';
    if ((entry.encounterType || '') !== wanted) return false;
  }

  if (filters.damageType !== 'all') {
    const wanted = filters.damageType === 'bomb' ? 'Bomb' : 'Battle';
    if ((entry.damageType || '') !== wanted) return false;
  }

  if (filters.result !== 'all') {
    const killed = Number(entry.remainingHp) === 0;
    if (filters.result === 'kill' && !killed) return false;
    if (filters.result === 'survived' && killed) return false;
  }

  if (filters.characters.length > 0) {
    const heroIds = new Set((Array.isArray(entry.heroDetails) ? entry.heroDetails : []).map((hero) => hero?.unitId).filter(Boolean));
    if (!filters.characters.every((unitId) => heroIds.has(unitId))) return false;
  }

  if (filters.mows.length > 0 && !filters.mows.includes(entry.machineOfWarDetails?.unitId || '')) return false;

  return true;
}

// Per-column comparators; direction is applied by sortEntries.
const SORT_COLUMNS = {
  date: {
    defaultDirection: 'desc',
    compare: (a, b) => a.__time - b.__time
  },
  season: {
    defaultDirection: 'desc',
    compare: (a, b) => a.__season - b.__season || a.__time - b.__time
  },
  player: {
    defaultDirection: 'asc',
    compare: (a, b) => getPlayerName(a.userId).localeCompare(getPlayerName(b.userId))
  },
  boss: {
    defaultDirection: 'asc',
    compare: (a, b) => getBossDisplayName(a).localeCompare(getBossDisplayName(b))
  },
  rarity: {
    defaultDirection: 'desc',
    compare: (a, b) => RARITY_ORDER.indexOf(a.rarity || '') - RARITY_ORDER.indexOf(b.rarity || '')
  },
  tier: {
    defaultDirection: 'desc',
    compare: (a, b) =>
      (Number(a.tier) || 0) - (Number(b.tier) || 0)
      || (Number(a.set) || 0) - (Number(b.set) || 0)
      || a.__time - b.__time
  },
  damage: {
    defaultDirection: 'desc',
    compare: (a, b) => (Number(a.damageDealt) || 0) - (Number(b.damageDealt) || 0)
  }
};

function sortEntries(entries) {
  const column = SORT_COLUMNS[raidLogState.filters.sortKey] || SORT_COLUMNS.date;
  const direction = raidLogState.filters.sortDirection === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => column.compare(a, b) * direction);
}

function renderTeamCell(entry) {
  const heroes = Array.isArray(entry.heroDetails) ? entry.heroDetails : [];
  const all = entry.machineOfWarDetails ? [...heroes, entry.machineOfWarDetails] : heroes;

  if (all.length === 0) return '<span class="text-xs text-slate-500">-</span>';

  return `<div class="flex flex-wrap items-center gap-1">${all.map((hero, index) => {
    const isMow = index === all.length - 1 && entry.machineOfWarDetails && hero.unitId === entry.machineOfWarDetails.unitId;
    const label = `${getUnitDisplayName(hero.unitId)} (${formatNumber(hero.power)})${isMow ? ' · MoW' : ''}`;
    return `
    <span class="inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded border ${isMow ? 'border-amber-500/60' : 'border-slate-700/70'} bg-slate-900/70" title="${escapeHtml(label)}">
      <img src="${escapeHtml(getPortraitUrlForUnitId(hero.unitId))}" alt="${escapeHtml(label)}" class="h-full w-full object-cover" loading="lazy" onerror="this.src='${MISSING_UNIT_AVATAR_URL}'" />
    </span>`;
  }).join('')}</div>`;
}

function renderRow(entry) {
  const bossName = getBossDisplayName(entry);
  const rarity = entry.rarity || '';
  const rarityBadge = rarity
    ? `<span class="inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${RARITY_BADGES[rarity] || RARITY_BADGES.Common}">${escapeHtml(rarity)}</span>`
    : '<span class="text-xs text-slate-500">-</span>';
  const isBomb = entry.damageType === 'Bomb';
  const typeBadge = isBomb
    ? '<span class="inline-flex rounded border border-amber-400/45 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-200">Bomb</span>'
    : '<span class="inline-flex rounded border border-sky-400/45 bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-200">Battle</span>';

  const maxHp = Number(entry.maxHp) || 0;
  const remainingHp = Number(entry.remainingHp) || 0;
  const killed = remainingHp === 0 && maxHp > 0;
  const resultCell = killed
    ? '<span class="inline-flex rounded border border-emerald-400/45 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-200">Kill</span>'
    : maxHp > 0
      ? `<span class="text-xs text-slate-400">${escapeHtml(String(Math.round((remainingHp / maxHp) * 100)))}% left</span>`
      : '<span class="text-xs text-slate-500">-</span>';

  const sideTag = entry.encounterType === 'SideBoss'
    ? '<span class="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Side boss</span>'
    : '';

  return `<tr class="hover:bg-slate-800/40">
    <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-400">${escapeHtml(formatTimestamp(entry.__time))}</td>
    <td class="px-3 py-2 text-sm font-semibold text-slate-300">${escapeHtml(String(entry.__season))}</td>
    <td class="px-3 py-2"><div class="flex items-center gap-2">${renderPlayerAvatar(entry.userId)}<span class="whitespace-nowrap font-semibold text-slate-100">${escapeHtml(getPlayerName(entry.userId))}</span></div></td>
    <td class="px-3 py-2"><div class="flex items-center gap-2">${renderBossAvatar(entry, bossName)}<span class="whitespace-nowrap font-semibold text-slate-100">${escapeHtml(bossName)}</span>${sideTag}</div></td>
    <td class="px-3 py-2">${rarityBadge}</td>
    <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-400">T${escapeHtml(String((Number(entry.tier) || 0) + 1))} · S${escapeHtml(String((Number(entry.set) || 0) + 1))}</td>
    <td class="whitespace-nowrap px-3 py-2 text-right text-sm font-bold text-slate-100">${escapeHtml(formatNumber(entry.damageDealt))}</td>
    <td class="px-3 py-2">${typeBadge}</td>
    <td class="px-3 py-2">${resultCell}</td>
    <td class="px-3 py-2">${renderTeamCell(entry)}</td>
  </tr>`;
}

function renderStats(filtered) {
  const totalDamage = filtered.reduce((total, entry) => total + (Number(entry.damageDealt) || 0), 0);
  const bombs = filtered.filter((entry) => entry.damageType === 'Bomb').length;
  const kills = filtered.filter((entry) => Number(entry.remainingHp) === 0 && Number(entry.maxHp) > 0).length;
  const players = new Set(filtered.map((entry) => entry.userId).filter(Boolean));

  const setText = (id, text) => {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  };

  setText('raid-log-stat-damage', `Total damage: ${formatCompactNumber(totalDamage)}`);
  setText('raid-log-stat-attacks', `Attacks: ${formatNumber(filtered.length - bombs)}`);
  setText('raid-log-stat-bombs', `Bombs: ${formatNumber(bombs)}`);
  setText('raid-log-stat-kills', `Kills: ${formatNumber(kills)}`);
  setText('raid-log-stat-players', `Players: ${formatNumber(players.size)}`);
}

function getScrollHost() {
  return document.querySelector('.site-scroll');
}

// The table does not start at the top of the scroll host, so convert the host
// scroll position into table-relative coordinates before windowing.
function updateScrollWindow() {
  const host = getScrollHost();
  const container = document.getElementById('raid-log-table-wrap');
  if (!host || !container) return;
  raidLogState.scrollTop = Math.max(0, host.scrollTop - container.offsetTop);
  raidLogState.viewportHeight = host.clientHeight;
}

function resetScrollWindow() {
  const host = getScrollHost();
  if (host) host.scrollTop = 0;
  raidLogState.scrollTop = 0;
}

function renderRaidLog() {
  Object.keys(FILTER_KEY_BY_CONTROL).forEach(renderMultiSelectControl);

  const body = document.getElementById('raid-log-body');
  const summary = document.getElementById('raid-filter-summary');
  if (!body) return;

  const filtered = sortEntries(raidLogState.entries.filter(entryMatchesFilters));
  raidLogState.filteredEntries = filtered;
  renderStats(filtered);

  if (filtered.length === 0) {
    body.innerHTML = `<tr><td colspan="10" class="px-3 py-6 text-center text-sm text-slate-400">${raidLogState.loading ? 'Loading raid season...' : 'No raid entries match the current filters.'}</td></tr>`;
  } else {
    const rowCount = filtered.length;
    const start = Math.max(0, Math.floor(raidLogState.scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS);
    const end = Math.min(
      rowCount,
      Math.ceil((raidLogState.scrollTop + raidLogState.viewportHeight) / ROW_HEIGHT_PX) + OVERSCAN_ROWS
    );
    const topPad = start * ROW_HEIGHT_PX;
    const bottomPad = Math.max(0, (rowCount - end) * ROW_HEIGHT_PX);

    let html = '';
    if (topPad > 0) html += `<tr aria-hidden="true" style="height:${topPad}px"><td colspan="10" class="p-0"></td></tr>`;
    for (let index = start; index < end; index += 1) html += renderRow(filtered[index]);
    if (bottomPad > 0) html += `<tr aria-hidden="true" style="height:${bottomPad}px"><td colspan="10" class="p-0"></td></tr>`;
    body.innerHTML = html;
  }

  if (summary) {
    const loadingNote = raidLogState.loading ? ' · loading season...' : '';
    summary.textContent = filtered.length === raidLogState.entries.length
      ? `Showing ${formatNumber(filtered.length)} entries${loadingNote}`
      : `Showing ${formatNumber(filtered.length)} of ${formatNumber(raidLogState.entries.length)} entries${loadingNote}`;
  }
}

function handleScroll() {
  const previousStart = Math.floor(raidLogState.scrollTop / ROW_HEIGHT_PX);
  updateScrollWindow();
  // Only re-render when the window actually moves by at least one row.
  if (Math.floor(raidLogState.scrollTop / ROW_HEIGHT_PX) !== previousStart) {
    scheduleRender();
  }
}

function setupButtonGroup(groupId, attribute, filterKey) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const buttons = Array.from(group.querySelectorAll(`button[data-${attribute}]`));

  const sync = () => {
    buttons.forEach((button) => {
      const isActive = (button.getAttribute(`data-${attribute}`) || 'all') === raidLogState.filters[filterKey];
      button.classList.toggle('bg-emerald-900/70', isActive);
      button.classList.toggle('text-emerald-100', isActive);
      button.classList.toggle('bg-transparent', !isActive);
      button.classList.toggle('text-slate-300', !isActive);
      button.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  };

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      raidLogState.filters[filterKey] = button.getAttribute(`data-${attribute}`) || 'all';
      resetScrollWindow();
      sync();
      renderRaidLog();
    });
  });

  sync();
}

function syncSortHeaders() {
  document.querySelectorAll('#raid-log-table thead [data-sort-key]').forEach((header) => {
    const isActive = header.getAttribute('data-sort-key') === raidLogState.filters.sortKey;
    header.setAttribute('aria-sort', isActive ? (raidLogState.filters.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
    header.classList.toggle('text-cyan-300', isActive);
    header.classList.toggle('text-slate-400', !isActive);
    const arrow = header.querySelector('[data-sort-arrow]');
    if (arrow) arrow.textContent = isActive ? (raidLogState.filters.sortDirection === 'asc' ? '▲' : '▼') : '';
  });
}

function setupSortHeaders() {
  document.querySelectorAll('#raid-log-table thead [data-sort-key]').forEach((header) => {
    header.addEventListener('click', () => {
      const key = header.getAttribute('data-sort-key');
      if (!SORT_COLUMNS[key]) return;

      if (raidLogState.filters.sortKey === key) {
        raidLogState.filters.sortDirection = raidLogState.filters.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        raidLogState.filters.sortKey = key;
        raidLogState.filters.sortDirection = SORT_COLUMNS[key].defaultDirection;
      }

      resetScrollWindow();
      syncSortHeaders();
      renderRaidLog();
    });
  });

  syncSortHeaders();
}

function setupFilters() {
  setupSortHeaders();

  setupButtonGroup('raid-filter-encounter-group', 'encounter', 'encounter');
  setupButtonGroup('raid-filter-damage-type-group', 'damage-type', 'damageType');
  setupButtonGroup('raid-filter-result-group', 'result', 'result');

  Object.keys(FILTER_KEY_BY_CONTROL).forEach((key) => {
    const input = document.getElementById(`raid-filter-${key}-input`);
    const control = document.getElementById(`raid-filter-${key}-control`);
    if (!input || !control) return;

    input.addEventListener('focus', () => {
      renderMultiSelectControl(key);
      toggleRaidFilterDropdown(key, true);
    });
    input.addEventListener('input', () => {
      renderMultiSelectControl(key);
      toggleRaidFilterDropdown(key, true);
    });
    control.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      input.focus();
    });
  });

  document.addEventListener('click', (event) => {
    Object.keys(FILTER_KEY_BY_CONTROL).forEach((key) => {
      const control = document.getElementById(`raid-filter-${key}-control`);
      if (control && !control.contains(event.target)) toggleRaidFilterDropdown(key, false);
    });
  });

  const clearButton = document.getElementById('raid-filter-clear');
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      raidLogState.filters = {
        sortKey: 'date',
        sortDirection: 'desc',
        // Keep the current-season default; the user has to opt into older seasons.
        seasons: (() => {
          const fallback = getDefaultSeason();
          return fallback ? [String(fallback)] : [];
        })(),
        players: [],
        bosses: [],
        rarities: [],
        characters: [],
        mows: [],
        encounter: 'boss',
        damageType: 'battle',
        result: 'all'
      };
      resetScrollWindow();
      setupButtonGroup('raid-filter-encounter-group', 'encounter', 'encounter');
      setupButtonGroup('raid-filter-damage-type-group', 'damage-type', 'damageType');
      setupButtonGroup('raid-filter-result-group', 'result', 'result');
      syncSortHeaders();
      document.querySelectorAll('[id^="raid-filter-"][id$="-input"]').forEach((input) => { input.value = ''; });
      renderRaidLog();
    });
  }

  const host = getScrollHost();
  if (host) host.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('resize', () => {
    updateScrollWindow();
    scheduleRender();
  });
}

function applyInitialUrlFilters() {
  if (typeof AppNav !== 'undefined') {
    const seasonParam = Number(AppNav.get('season'));
    if (Number.isFinite(seasonParam) && seasonParam > 0) {
      raidLogState.filters.seasons = [String(seasonParam)];
      return;
    }
  }
  // Default selection: the current season only, so initial load stays light.
  const fallback = getDefaultSeason();
  if (fallback) raidLogState.filters.seasons = [String(fallback)];
}

async function initRaidLogPage() {
  if (typeof AppNav !== 'undefined') {
    AppNav.renderBreadcrumb([
      { label: 'Home', href: 'index.html' },
      { label: 'Raid Log' }
    ]);
  }

  await loadStaticData();
  await loadSeasonManifest();

  // Seed the season pool from the manifest so the season filter lists every
  // season even before its entries are loaded.
  raidLogState.seasonsMeta.forEach((season) => raidLogState.optionPools.seasons.add(season.season));

  applyInitialUrlFilters();
  setupFilters();
  updateScrollWindow();
  renderRaidLog();
  await ensureSeasonsLoaded();
}

document.addEventListener('DOMContentLoaded', () => {
  initRaidLogPage();
});
