const RAID_CURRENT_URL = './data/raid/current.json';
const RAID_MANIFEST_URL = './data/raid/manifest.json';
const PLAYER_DIRECTORY_URL = './data/static/players.json';
const MISSING_UNIT_AVATAR_URL = './img/missing-unit.svg';
const AVATAR_BASE_URL = 'https://webstore-assets.loki.snowprintstudios.com/live/images';
const AVATAR_FRAME_URLS = {
  frameMythic01: 'https://tacticus.xyz/assets/frames/ui_avatar_frame_framemythic01-90960f24.png'
};

// Tier count varies by season, so colours follow the encounter rarity rather than the tier index.
const RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];
const RARITY_STYLES = {
  Common: { label: 'Common', border: 'border-slate-500/40 hover:border-slate-300/70', badge: 'border-slate-400/40 bg-slate-500/15 text-slate-200', text: 'text-slate-300', bar: 'bg-slate-400', dot: 'bg-slate-400' },
  Uncommon: { label: 'Uncommon', border: 'border-amber-700/50 hover:border-amber-600/80', badge: 'border-amber-700/50 bg-amber-800/25 text-amber-500', text: 'text-amber-500', bar: 'bg-amber-700', dot: 'bg-amber-700' },
  Rare: { label: 'Rare', border: 'border-zinc-300/30 hover:border-zinc-200/70', badge: 'border-zinc-300/40 bg-zinc-300/10 text-zinc-200', text: 'text-zinc-300', bar: 'bg-zinc-300', dot: 'bg-zinc-300' },
  Epic: { label: 'Epic', border: 'border-yellow-400/35 hover:border-yellow-300/70', badge: 'border-yellow-400/40 bg-yellow-500/15 text-yellow-200', text: 'text-yellow-300', bar: 'bg-yellow-400', dot: 'bg-yellow-400' },
  Legendary: { label: 'Legendary', border: 'border-violet-400/35 hover:border-violet-300/70', badge: 'border-violet-400/40 bg-violet-500/15 text-violet-200', text: 'text-violet-300', bar: 'bg-violet-400', dot: 'bg-violet-400' },
  Mythic: { label: 'Mythic', border: 'border-orange-400/40 hover:border-orange-300/80', badge: 'border-orange-400/45 bg-orange-500/15 text-orange-200', text: 'text-orange-300', bar: 'bg-orange-400', dot: 'bg-orange-400' }
};

function getTierStyle(boss) {
  return RARITY_STYLES[boss?.rarity]
    || RARITY_STYLES[RARITY_ORDER[Number(boss?.tier)]]
    || RARITY_STYLES.Common;
}

const raidState = {
  loaded: false,
  error: '',
  season: null,
  seasons: [],
  activeSeason: null,
  currentSeason: null,
  seasonConfigId: null,
  guild: null,
  fetchedOn: null,
  entries: [],
  players: new Map(),
  portraitMap: {},
  portraitKeyIndex: new Map(),
  portraitManifestSet: new Set(),
  selectedBossKey: '',
  activeView: 'bosses',
  playerSort: { key: 'totalDamage', direction: 'desc' },
  activeTab: 'attacks'
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
    hour: '2-digit',
    minute: '2-digit'
  });
}

function prettifyUnitName(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Unknown boss';
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

function getPlayer(userId) {
  return raidState.players.get(String(userId || '')) || null;
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

function renderPlayerCell(userId) {
  return `<div class="flex items-center gap-2">${renderPlayerAvatar(userId)}<span class="font-semibold text-slate-100">${escapeHtml(getPlayerName(userId))}</span></div>`;
}

function getPortraitUrlForUnitId(unitId) {
  const imageName = String((raidState.portraitMap || {})[unitId] || '').trim();
  if (!imageName) return MISSING_UNIT_AVATAR_URL;
  if (raidState.portraitManifestSet.has(imageName)) return `./img-temp/${imageName}`;
  return `./img/${imageName}`;
}

// Raid bosses are not in the player portrait map, so fall back to initials.
function renderBossAvatar(boss, sizeClasses) {
  const portraitKey = raidState.portraitKeyIndex.get(getBossUnitKey(boss.unitId).toLowerCase()) || '';
  const shell = `inline-flex ${sizeClasses} shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-700/70 bg-slate-950/70`;

  if (portraitKey) {
    return `<span class="${shell}">
      <img src="${escapeHtml(getPortraitUrlForUnitId(portraitKey))}" alt="" class="h-full w-full object-cover" onerror="this.src='${MISSING_UNIT_AVATAR_URL}'" />
    </span>`;
  }

  const initials = boss.name.split(' ').map((word) => word.charAt(0)).join('').slice(0, 2).toUpperCase();
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
  const [players, portraitMap, imageManifest] = await Promise.all([
    loadJson(PLAYER_DIRECTORY_URL, []),
    loadJson('./data/static/portrait-map.json', {}),
    loadJson('./data/static/image-manifest.json', [])
  ]);

  raidState.players = new Map(
    (Array.isArray(players) ? players : [])
      .filter((player) => player && player.id)
      .map((player) => [String(player.id), player])
  );
  raidState.portraitMap = portraitMap && typeof portraitMap === 'object' ? portraitMap : {};
  raidState.portraitKeyIndex = new Map(
    Object.keys(raidState.portraitMap).map((key) => [key.toLowerCase(), key])
  );
  raidState.portraitManifestSet = new Set(
    (Array.isArray(imageManifest) ? imageManifest : []).map((entry) => String(entry || '').trim()).filter(Boolean)
  );
}

function getSeasonFromUrl() {
  const requested = Number(new URLSearchParams(window.location.search).get('season'));
  return raidState.seasons.some((season) => season.season === requested) ? requested : null;
}

async function loadSeasonManifest() {
  const manifest = await loadJson(RAID_MANIFEST_URL, null);
  const seasons = Array.isArray(manifest?.seasons) ? manifest.seasons : [];

  raidState.seasons = seasons
    .filter((season) => Number.isFinite(Number(season?.season)))
    .map((season) => ({ ...season, season: Number(season.season) }))
    .sort((left, right) => right.season - left.season);
  raidState.currentSeason = Number(manifest?.current);
}

async function loadSeason(season) {
  const entry = raidState.seasons.find((item) => item.season === season);
  const url = entry?.url || (season === raidState.currentSeason ? RAID_CURRENT_URL : `./data/raid/${season}.json`);
  const raid = await loadJson(raidState.seasons.length === 0 ? RAID_CURRENT_URL : url, null);

  if (!raid) {
    raidState.error = 'Guild raid data has not been published yet.';
    raidState.entries = [];
    raidState.loaded = true;
    return;
  }

  raidState.error = '';
  raidState.season = raid.season ?? null;
  raidState.activeSeason = Number(raid.season);
  raidState.seasonConfigId = raid.seasonConfigId ?? null;
  raidState.guild = raid.guild ?? null;
  raidState.fetchedOn = raid.fetchedOn ?? null;
  raidState.entries = Array.isArray(raid.entries) ? raid.entries : [];
  raidState.loaded = true;
}

// Each tier/set/encounter combination is a distinct boss instance with its own health pool.
function getBossKey(entry) {
  return [
    Number(entry.tier) || 0,
    Number(entry.set) || 0,
    Number(entry.encounterIndex) || 0,
    entry.encounterType || '',
    entry.unitId || entry.type || 'unknown'
  ].join('|');
}

function getBosses() {
  const bosses = new Map();

  raidState.entries.forEach((entry) => {
    const key = getBossKey(entry);
    if (!bosses.has(key)) {
      bosses.set(key, {
        key,
        unitId: entry.unitId,
        type: entry.type,
        name: getBossDisplayName(entry),
        encounterType: entry.encounterType,
        tier: Number(entry.tier) || 0,
        set: Number(entry.set) || 0,
        encounterIndex: Number(entry.encounterIndex) || 0,
        rarity: entry.rarity || '',
        players: new Set(),
        totalDamage: 0,
        attacks: 0,
        bombs: 0,
        firstActivity: Infinity,
        lastActivity: 0,
        remainingHp: null,
        maxHp: 0
      });
    }

    const boss = bosses.get(key);
    if (entry.userId) boss.players.add(entry.userId);
    boss.totalDamage += Number(entry.damageDealt) || 0;
    if (entry.damageType === 'Bomb') boss.bombs += 1;
    else boss.attacks += 1;
    boss.maxHp = Math.max(boss.maxHp, Number(entry.maxHp) || 0);

    const startedOn = Number(entry.startedOn || entry.completedOn) || 0;
    if (startedOn > 0) boss.firstActivity = Math.min(boss.firstActivity, startedOn);

    const completedOn = Number(entry.completedOn || entry.startedOn) || 0;
    if (completedOn >= boss.lastActivity) {
      boss.lastActivity = completedOn;
      boss.remainingHp = Number(entry.remainingHp) || 0;
    }
  });

  return [...bosses.values()]
    .map((boss) => ({
      ...boss,
      firstActivity: Number.isFinite(boss.firstActivity) ? boss.firstActivity : 0
    }))
    .sort((left, right) => right.tier - left.tier
      || right.set - left.set
      || left.encounterIndex - right.encounterIndex
      || left.firstActivity - right.firstActivity);
}

function getEntriesForBoss(bossKey) {
  return raidState.entries.filter((entry) => getBossKey(entry) === bossKey);
}

function aggregatePlayers(entries) {
  const stats = new Map();

  entries.forEach((entry) => {
    const userId = entry.userId || 'unknown';
    if (!stats.has(userId)) {
      stats.set(userId, {
        userId,
        name: getPlayerName(userId),
        totalDamage: 0,
        battleDamage: 0,
        bombDamage: 0,
        tokens: 0,
        bombs: 0,
        bestDamage: 0,
        lastActivity: 0
      });
    }

    const player = stats.get(userId);
    const damage = Number(entry.damageDealt) || 0;
    player.totalDamage += damage;
    player.bestDamage = Math.max(player.bestDamage, damage);
    if (entry.damageType === 'Bomb') {
      player.bombs += 1;
      player.bombDamage += damage;
    } else {
      player.tokens += 1;
      player.battleDamage += damage;
    }
    player.lastActivity = Math.max(player.lastActivity, Number(entry.completedOn || entry.startedOn) || 0);
  });

  return [...stats.values()]
    .map((player) => ({
      ...player,
      damagePerToken: player.tokens > 0 ? player.battleDamage / player.tokens : 0
    }))
    .sort((left, right) => right.totalDamage - left.totalDamage);
}

function getPlayerStatsForBoss(bossKey) {
  return aggregatePlayers(getEntriesForBoss(bossKey));
}

function renderHeroPortraits(entry) {
  const heroes = Array.isArray(entry.heroDetails) ? entry.heroDetails : [];
  const all = entry.machineOfWarDetails ? [...heroes, entry.machineOfWarDetails] : heroes;

  if (all.length === 0) {
    return '<span class="text-xs text-slate-500">-</span>';
  }

  return `<div class="flex flex-wrap items-center gap-1">${all.map((hero) => `
    <span class="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded border border-slate-700/70 bg-slate-900/70" title="${escapeHtml(hero.unitId)} (${formatNumber(hero.power)})">
      <img src="${escapeHtml(getPortraitUrlForUnitId(hero.unitId))}" alt="${escapeHtml(hero.unitId)}" class="h-full w-full object-cover" onerror="this.src='${MISSING_UNIT_AVATAR_URL}'" />
    </span>`).join('')}</div>`;
}

function renderSeasonSelect() {
  const select = document.getElementById('raid-season-select');
  if (!select) return;

  const seasons = raidState.seasons.length > 0
    ? raidState.seasons
    : [{ season: raidState.activeSeason, entries: raidState.entries.length }];

  select.innerHTML = seasons.map((season) => `
    <option value="${escapeHtml(String(season.season))}"${season.season === raidState.activeSeason ? ' selected' : ''}>Season ${escapeHtml(String(season.season))}${season.season === raidState.currentSeason ? ' (live)' : ''}</option>`).join('');
  select.disabled = seasons.length < 2;
}

function renderSummary() {
  const summary = document.getElementById('raid-summary');
  if (!summary) return;

  const totalDamage = raidState.entries.reduce((total, entry) => total + (Number(entry.damageDealt) || 0), 0);
  const players = new Set(raidState.entries.map((entry) => entry.userId).filter(Boolean));
  const bombs = raidState.entries.filter((entry) => entry.damageType === 'Bomb').length;

  const cards = [
    { label: 'Season', value: raidState.season === null ? '-' : `#${raidState.season}${raidState.season === raidState.currentSeason ? ' (live)' : ''}` },
    { label: 'Total damage', value: formatNumber(totalDamage) },
    { label: 'Attacks', value: formatNumber(raidState.entries.length - bombs) },
    { label: 'Bombs', value: formatNumber(bombs) },
    { label: 'Players', value: formatNumber(players.size) },
    { label: 'Updated', value: formatTimestamp(raidState.fetchedOn) }
  ];

  summary.innerHTML = cards.map((card) => `
    <div class="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
      <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">${escapeHtml(card.label)}</p>
      <p class="mt-1 text-lg font-black text-slate-100">${escapeHtml(card.value)}</p>
    </div>`).join('');
}

function renderBossGrid() {
  const grid = document.getElementById('raid-boss-grid');
  if (!grid) return;

  if (raidState.error) {
    grid.innerHTML = `<p class="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-200">${escapeHtml(raidState.error)}</p>`;
    return;
  }

  const bosses = getBosses();
  if (bosses.length === 0) {
    grid.innerHTML = '<p class="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-400">No raid activity recorded for this season yet.</p>';
    return;
  }

  const tiers = [];
  bosses.forEach((boss) => {
    const current = tiers[tiers.length - 1];
    if (current && current.tier === boss.tier) current.bosses.push(boss);
    else tiers.push({ tier: boss.tier, bosses: [boss] });
  });

  grid.innerHTML = tiers.map((group) => {
    const style = getTierStyle(group.bosses[0]);
    const damage = group.bosses.reduce((total, boss) => total + boss.totalDamage, 0);
    const encounters = groupBySet(group.bosses);

    return `
      <section class="space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <span class="inline-flex h-2.5 w-2.5 rounded-full ${style.dot}"></span>
          <h3 class="text-lg font-black ${style.text}">Tier ${group.tier + 1} · ${escapeHtml(style.label)}</h3>
          <span class="text-xs text-slate-400">${escapeHtml(formatNumber(group.bosses.length))} encounters · ${escapeHtml(formatCompactNumber(damage))} damage</span>
        </div>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          ${encounters.map((encounter) => renderEncounterCard(encounter, style)).join('')}
        </div>
      </section>`;
  }).join('');
}

// Side bosses belong to the same set as their main boss, so they nest inside its card.
function groupBySet(bosses) {
  const sets = new Map();

  bosses.forEach((boss) => {
    if (!sets.has(boss.set)) sets.set(boss.set, { set: boss.set, main: null, sides: [] });
    const encounter = sets.get(boss.set);
    if (boss.encounterType === 'SideBoss') encounter.sides.push(boss);
    else if (!encounter.main) encounter.main = boss;
    else encounter.sides.push(boss);
  });

  return [...sets.values()]
    .map((encounter) => {
      const sides = encounter.sides.sort((left, right) => left.encounterIndex - right.encounterIndex);
      return encounter.main ? { ...encounter, sides } : { ...encounter, main: sides[0], sides: sides.slice(1) };
    })
    .filter((encounter) => encounter.main);
}

function getBossProgress(boss) {
  const damageTaken = boss.maxHp > 0
    ? Math.min(100, Math.round(((boss.maxHp - (boss.remainingHp ?? boss.maxHp)) / boss.maxHp) * 100))
    : 0;
  return { damageTaken, killed: boss.remainingHp === 0 && boss.maxHp > 0 };
}

function renderEncounterCard(encounter, style) {
  const boss = encounter.main;
  const { damageTaken, killed } = getBossProgress(boss);

  return `
    <div class="rounded-2xl border ${style.border} bg-slate-900/80 p-4 shadow-lg shadow-black/30 transition hover:bg-slate-900">
      <button type="button" data-boss-key="${escapeHtml(boss.key)}" class="w-full text-left">
        <div class="mb-3 flex items-center justify-between gap-2">
          <span class="rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${style.badge}">${escapeHtml(style.label)}</span>
          <span class="text-xs text-slate-400">Set ${escapeHtml(String(boss.set + 1))}</span>
        </div>
        <div class="flex items-center gap-3">
          ${renderBossAvatar(boss, 'h-12 w-12')}
          <div class="min-w-0">
            <h4 class="truncate text-lg font-bold text-white">${escapeHtml(boss.name)}</h4>
            <p class="text-xs ${style.text}">Boss · ${escapeHtml(killed ? 'Defeated' : `${damageTaken}% down`)}</p>
          </div>
        </div>
        <div class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div class="h-full ${style.bar}" style="width: ${damageTaken}%"></div>
        </div>
        <dl class="mt-3 grid grid-cols-3 gap-2 text-center">
          <div><dt class="text-[10px] uppercase tracking-wide text-slate-500">Damage</dt><dd class="text-sm font-bold text-slate-100">${escapeHtml(formatCompactNumber(boss.totalDamage))}</dd></div>
          <div><dt class="text-[10px] uppercase tracking-wide text-slate-500">Hits</dt><dd class="text-sm font-bold text-slate-100">${escapeHtml(formatNumber(boss.attacks + boss.bombs))}</dd></div>
          <div><dt class="text-[10px] uppercase tracking-wide text-slate-500">Players</dt><dd class="text-sm font-bold text-slate-100">${escapeHtml(formatNumber(boss.players.size))}</dd></div>
        </dl>
      </button>
      ${encounter.sides.length === 0 ? '' : `
        <div class="mt-3 grid grid-cols-2 gap-2 border-t border-slate-800 pt-3">
          ${encounter.sides.map((side) => renderSideBossTile(side, style)).join('')}
        </div>`}
    </div>`;
}

function renderSideBossTile(boss, style) {
  const { damageTaken, killed } = getBossProgress(boss);

  return `
    <button type="button" data-boss-key="${escapeHtml(boss.key)}" class="rounded-xl border border-slate-800 bg-slate-950/60 p-2 text-left transition hover:border-slate-600 hover:bg-slate-900">
      <div class="flex items-center gap-2">
        ${renderBossAvatar(boss, 'h-8 w-8')}
        <div class="min-w-0">
          <p class="truncate text-xs font-bold text-slate-100">${escapeHtml(boss.name)}</p>
          <p class="text-[10px] uppercase tracking-wide text-slate-500">Side ${escapeHtml(String(boss.encounterIndex))} · ${escapeHtml(killed ? 'Defeated' : `${damageTaken}%`)}</p>
        </div>
      </div>
      <div class="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-800">
        <div class="h-full ${style.bar}" style="width: ${damageTaken}%"></div>
      </div>
      <p class="mt-1 text-[11px] text-slate-400">${escapeHtml(formatCompactNumber(boss.totalDamage))} · ${escapeHtml(formatNumber(boss.attacks + boss.bombs))} hits</p>
    </button>`;
}

function renderAttacksTab(bossKey) {
  const entries = getEntriesForBoss(bossKey)
    .slice()
    .sort((left, right) => Number(right.completedOn || right.startedOn || 0) - Number(left.completedOn || left.startedOn || 0));

  if (entries.length === 0) {
    return '<p class="p-4 text-sm text-slate-400">No attacks recorded.</p>';
  }

  return `
    <div class="overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="border-b border-slate-700 text-[11px] uppercase tracking-wide text-slate-400">
          <tr>
            <th class="px-3 py-2">Player</th>
            <th class="px-3 py-2">Type</th>
            <th class="px-3 py-2 text-right">Damage</th>
            <th class="px-3 py-2">Team</th>
            <th class="px-3 py-2">Completed</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/80">
          ${entries.map((entry) => `
            <tr class="hover:bg-slate-900/60">
              <td class="px-3 py-2">${renderPlayerCell(entry.userId)}</td>
              <td class="px-3 py-2"><span class="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${entry.damageType === 'Bomb' ? 'border-amber-400/40 bg-amber-500/10 text-amber-200' : 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200'}">${escapeHtml(entry.damageType || 'Battle')}</span></td>
              <td class="px-3 py-2 text-right font-bold text-slate-100">${escapeHtml(formatNumber(entry.damageDealt))}</td>
              <td class="px-3 py-2">${renderHeroPortraits(entry)}</td>
              <td class="px-3 py-2 text-slate-400">${escapeHtml(formatTimestamp(entry.completedOn || entry.startedOn))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderPlayersTab(bossKey) {
  const players = getPlayerStatsForBoss(bossKey);

  if (players.length === 0) {
    return '<p class="p-4 text-sm text-slate-400">No player activity recorded.</p>';
  }

  return `
    <div class="overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="border-b border-slate-700 text-[11px] uppercase tracking-wide text-slate-400">
          <tr>
            <th class="px-3 py-2">#</th>
            <th class="px-3 py-2">Player</th>
            <th class="px-3 py-2 text-right">Total damage</th>
            <th class="px-3 py-2 text-right">Tokens</th>
            <th class="px-3 py-2 text-right">Damage per token</th>
            <th class="px-3 py-2 text-right">Bombs</th>
            <th class="px-3 py-2 text-right">Bomb damage</th>
            <th class="px-3 py-2 text-right">Best hit</th>
            <th class="px-3 py-2">Last hit</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/80">
          ${players.map((player, index) => `
            <tr class="hover:bg-slate-900/60">
              <td class="px-3 py-2 text-slate-400">${index + 1}</td>
              <td class="px-3 py-2">${renderPlayerCell(player.userId)}</td>
              <td class="px-3 py-2 text-right font-bold text-cyan-200">${escapeHtml(formatNumber(player.totalDamage))}</td>
              <td class="px-3 py-2 text-right text-slate-300">${escapeHtml(formatNumber(player.tokens))}</td>
              <td class="px-3 py-2 text-right text-slate-300">${escapeHtml(formatNumber(player.damagePerToken))}</td>
              <td class="px-3 py-2 text-right text-slate-300">${escapeHtml(formatNumber(player.bombs))}</td>
              <td class="px-3 py-2 text-right text-slate-300">${escapeHtml(formatNumber(player.bombDamage))}</td>
              <td class="px-3 py-2 text-right text-slate-300">${escapeHtml(formatNumber(player.bestDamage))}</td>
              <td class="px-3 py-2 text-slate-400">${escapeHtml(formatTimestamp(player.lastActivity))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderBossDetail() {
  const detail = document.getElementById('raid-boss-detail');
  if (!detail) return;

  const boss = getBosses().find((entry) => entry.key === raidState.selectedBossKey);
  if (!boss) {
    detail.innerHTML = '';
    return;
  }

  const isAttacks = raidState.activeTab === 'attacks';
  const style = getTierStyle(boss);
  const activeTabClasses = 'border-b-2 border-cyan-400 px-5 py-3 text-sm font-semibold text-cyan-300';
  const inactiveTabClasses = 'border-b-2 border-transparent px-5 py-3 text-sm font-semibold text-slate-400 transition-colors hover:text-slate-100';

  detail.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        ${renderBossAvatar(boss, 'h-12 w-12')}
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-xl font-black text-slate-100">${escapeHtml(boss.name)}</h3>
            <span class="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] ${style.badge}">Tier ${escapeHtml(String(boss.tier + 1))} · ${escapeHtml(style.label)}</span>
          </div>
          <p class="text-xs text-slate-400">Set ${escapeHtml(String(boss.set + 1))} · ${escapeHtml(boss.encounterType === 'SideBoss' ? `Side boss ${boss.encounterIndex}` : 'Boss')} · ${escapeHtml(formatNumber(boss.totalDamage))} total damage · ${escapeHtml(formatNumber(boss.attacks + boss.bombs))} hits</p>
        </div>
      </div>
      <button id="raid-back-button" type="button" class="rounded-md border border-slate-500/50 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-400/70 hover:text-white">Back to bosses</button>
    </div>
    <div class="rounded-xl border border-slate-800 bg-slate-900/70 shadow-2xl shadow-black/25">
      <div class="tab-strip flex flex-wrap border-b border-slate-700">
        <button type="button" data-raid-tab="attacks" class="${isAttacks ? activeTabClasses : inactiveTabClasses}">Attacks</button>
        <button type="button" data-raid-tab="players" class="${isAttacks ? inactiveTabClasses : activeTabClasses}">Players</button>
      </div>
      <div class="p-2">${isAttacks ? renderAttacksTab(boss.key) : renderPlayersTab(boss.key)}</div>
    </div>`;

  const backButton = document.getElementById('raid-back-button');
  if (backButton) {
    backButton.addEventListener('click', () => {
      raidState.selectedBossKey = '';
      render();
    });
  }

  detail.querySelectorAll('[data-raid-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      raidState.activeTab = button.getAttribute('data-raid-tab') === 'players' ? 'players' : 'attacks';
      renderBossDetail();
    });
  });
}

const SEASON_PLAYER_COLUMNS = [
  { key: 'name', label: 'Player', numeric: false },
  { key: 'totalDamage', label: 'Damage', numeric: true, emphasis: true },
  { key: 'tokens', label: 'Tokens', numeric: true },
  { key: 'damagePerToken', label: 'Damage per token', numeric: true },
  { key: 'bombs', label: 'Bombs', numeric: true },
  { key: 'bombDamage', label: 'Bomb damage', numeric: true }
];

function sortSeasonPlayers(players) {
  const { key, direction } = raidState.playerSort;
  const column = SEASON_PLAYER_COLUMNS.find((entry) => entry.key === key) || SEASON_PLAYER_COLUMNS[1];
  const sign = direction === 'asc' ? 1 : -1;

  return players.slice().sort((left, right) => {
    if (!column.numeric) return sign * String(left[column.key]).localeCompare(String(right[column.key]));
    return sign * ((Number(left[column.key]) || 0) - (Number(right[column.key]) || 0));
  });
}

function renderSeasonPlayers() {
  const container = document.getElementById('raid-season-players');
  if (!container) return;

  const players = sortSeasonPlayers(aggregatePlayers(raidState.entries));
  if (players.length === 0) {
    container.innerHTML = '<p class="p-4 text-sm text-slate-400">No player activity recorded this season.</p>';
    return;
  }

  const headers = SEASON_PLAYER_COLUMNS.map((column) => {
    const isSorted = raidState.playerSort.key === column.key;
    const arrow = isSorted ? (raidState.playerSort.direction === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="px-3 py-2 ${column.numeric ? 'text-right' : ''}" aria-sort="${isSorted ? (raidState.playerSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}">
      <button type="button" data-player-sort="${column.key}" class="uppercase tracking-wide transition-colors hover:text-slate-100 ${isSorted ? 'text-cyan-300' : ''}">${escapeHtml(column.label)}${arrow}</button>
    </th>`;
  }).join('');

  container.innerHTML = `
    <div class="overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead class="border-b border-slate-700 text-[11px] uppercase tracking-wide text-slate-400">
          <tr>
            <th class="px-3 py-2">#</th>
            ${headers}
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/80">
          ${players.map((player, index) => `
            <tr class="hover:bg-slate-900/60">
              <td class="px-3 py-2 text-slate-400">${index + 1}</td>
              <td class="px-3 py-2">${renderPlayerCell(player.userId)}</td>
              <td class="px-3 py-2 text-right font-bold text-cyan-200">${escapeHtml(formatNumber(player.totalDamage))}</td>
              <td class="px-3 py-2 text-right text-slate-300">${escapeHtml(formatNumber(player.tokens))}</td>
              <td class="px-3 py-2 text-right text-slate-300">${escapeHtml(formatNumber(player.damagePerToken))}</td>
              <td class="px-3 py-2 text-right text-slate-300">${escapeHtml(formatNumber(player.bombs))}</td>
              <td class="px-3 py-2 text-right text-slate-300">${escapeHtml(formatNumber(player.bombDamage))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll('[data-player-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.getAttribute('data-player-sort');
      const column = SEASON_PLAYER_COLUMNS.find((entry) => entry.key === key);
      if (!column) return;

      raidState.playerSort = raidState.playerSort.key === key
        ? { key, direction: raidState.playerSort.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: column.numeric ? 'desc' : 'asc' };

      renderSeasonPlayers();
    });
  });
}

function render() {
  const gridView = document.getElementById('raid-grid-view');
  const detailView = document.getElementById('raid-detail-view');
  const playersView = document.getElementById('raid-players-view');
  if (!gridView || !detailView || !playersView) return;

  renderSummary();
  renderSeasonSelect();

  const showPlayers = raidState.activeView === 'players';
  const showDetail = !showPlayers && Boolean(raidState.selectedBossKey);

  gridView.hidden = showPlayers || showDetail;
  detailView.hidden = !showDetail;
  playersView.hidden = !showPlayers;

  document.querySelectorAll('[data-raid-view]').forEach((button) => {
    const isActive = button.getAttribute('data-raid-view') === raidState.activeView;
    button.className = isActive
      ? 'border-b-2 border-cyan-400 px-5 py-3 text-sm font-semibold text-cyan-300 transition-colors hover:text-slate-100'
      : 'border-b-2 border-transparent px-5 py-3 text-sm font-semibold text-slate-400 transition-colors hover:text-slate-100';
  });

  if (showPlayers) {
    renderSeasonPlayers();
  } else if (showDetail) {
    renderBossDetail();
  } else {
    renderBossGrid();
  }
}

function bindGridEvents() {
  const grid = document.getElementById('raid-boss-grid');
  if (!grid) return;

  grid.addEventListener('click', (event) => {
    const button = event.target.closest('[data-boss-key]');
    if (!button) return;
    raidState.selectedBossKey = button.getAttribute('data-boss-key');
    raidState.activeTab = 'attacks';
    render();
  });
}

function bindViewTabs() {
  document.querySelectorAll('[data-raid-view]').forEach((button) => {
    button.addEventListener('click', () => {
      raidState.activeView = button.getAttribute('data-raid-view') === 'players' ? 'players' : 'bosses';
      render();
    });
  });
}

function bindSeasonSelect() {
  const select = document.getElementById('raid-season-select');
  if (!select) return;

  select.addEventListener('change', async () => {
    const season = Number(select.value);
    if (!Number.isFinite(season) || season === raidState.activeSeason) return;

    raidState.selectedBossKey = '';
    await loadSeason(season);

    const params = new URLSearchParams(window.location.search);
    params.set('season', String(season));
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);

    render();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  bindGridEvents();
  bindViewTabs();
  bindSeasonSelect();

  await Promise.all([loadStaticData(), loadSeasonManifest()]);
  await loadSeason(getSeasonFromUrl() ?? raidState.currentSeason ?? raidState.seasons[0]?.season);

  render();
});
