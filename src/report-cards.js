(function initReportCards() {
  const RAID_MANIFEST_URL = './data/raid/manifest.json';
  const WAR_MANIFEST_URL = './data/dataset-manifest.json';
  const RAID_WINDOW_SIZE = 6;
  const WAR_ARCHIVE_COUNT = 5;
  const numberFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
    return response.json();
  }

  async function loadRaidSeasons() {
    const manifest = await fetchJson(RAID_MANIFEST_URL);
    const seasons = (Array.isArray(manifest?.seasons) ? manifest.seasons : [])
      .slice()
      .sort((left, right) => Number(right.season) - Number(left.season))
      .slice(0, RAID_WINDOW_SIZE + 1);

    return Promise.all(seasons.map(async (season) => {
      try {
        const url = season.url || `./data/raid/${season.season}.json`;
        return await fetchJson(url);
      } catch (error) {
        return null;
      }
    })).then((results) => results.filter(Boolean));
  }

  async function loadWars() {
    const [current, manifest] = await Promise.all([
      fetchJson('./data/war/current.json').catch(() => null),
      fetchJson(WAR_MANIFEST_URL)
    ]);
    const archives = (Array.isArray(manifest?.datasets) ? manifest.datasets : [])
      .slice()
      .sort((left, right) => Date.parse(right.end || right.start || 0) - Date.parse(left.end || left.start || 0))
      .slice(0, WAR_ARCHIVE_COUNT);
    const archiveReports = await Promise.all(archives.map(async (dataset) => {
      try {
        return {
          label: dataset.label || dataset.sourceLabel || 'Archived war',
          data: await fetchJson(dataset.url)
        };
      } catch (error) {
        return null;
      }
    }));

    const wars = [];
    if (current) wars.push({ label: 'Active war', data: current });
    wars.push(...archiveReports.filter(Boolean));
    return wars;
  }

  function formatNumber(value) {
    return numberFormat.format(Number(value) || 0);
  }

  function formatPercentile(value) {
    return Number.isFinite(value) ? `${Math.round(value)}%` : '—';
  }

  function renderPlayerAvatar(card) {
    const avatarUnitId = String(card.avatarUnitId || '').trim().toLowerCase();
    const initials = card.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
    const image = avatarUnitId
      ? `<img class="absolute inset-0 h-full w-full rounded-full object-cover" src="https://webstore-assets.loki.snowprintstudios.com/live/images/avatar_${encodeURIComponent(avatarUnitId)}.png" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
      : '';

    return `<span class="relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-600 bg-slate-800 text-xs font-bold text-slate-200">${image}<span aria-hidden="true">${escapeHtml(initials || '?')}</span></span>`;
  }

  function getGradeClasses(grade) {
    const classes = {
      'A+': 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200',
      A: 'border-lime-400/50 bg-lime-400/10 text-lime-200',
      B: 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200',
      C: 'border-amber-400/50 bg-amber-400/10 text-amber-200',
      D: 'border-orange-400/50 bg-orange-400/10 text-orange-200',
      F: 'border-rose-400/50 bg-rose-400/10 text-rose-200'
    };
    return classes[grade] || classes.F;
  }

  function renderDamageChange(currentStats, previousStats, previousSeason) {
    if (!previousSeason) return '<span class="ml-1 text-[10px] text-slate-500" title="No older season in this report">—</span>';
    if (!previousStats || previousStats.totalDamage <= 0) {
      return currentStats.totalDamage > 0
        ? '<span class="ml-1 text-[10px] font-semibold text-emerald-300" title="No prior-season damage to compare">NEW</span>'
        : '<span class="ml-1 text-[10px] text-slate-500">—</span>';
    }

    const change = ((currentStats.totalDamage - previousStats.totalDamage) / previousStats.totalDamage) * 100;
    if (Math.abs(change) < 0.05) {
      return `<span class="ml-1 text-[10px] font-semibold text-slate-400" title="Compared with season ${previousSeason.season}">±0.0%</span>`;
    }

    const increased = change > 0;
    const sign = increased ? '+' : '−';
    const color = increased ? 'text-emerald-300' : 'text-rose-300';
    return `<span class="ml-1 text-[10px] font-semibold ${color}" title="Compared with season ${previousSeason.season}">${sign}${Math.abs(change).toFixed(1)}%</span>`;
  }

  function renderTable(headers, rows, emptyMessage, rightAlignedColumns = []) {
    if (rows.length === 0) return `<p class="py-2 text-xs text-slate-500">${emptyMessage}</p>`;

    return `<div class="overflow-x-auto">
      <table class="w-full min-w-max border-collapse text-left text-[11px]">
        <thead><tr class="border-b border-slate-800 text-[10px] uppercase text-slate-500">${headers.map((header, index) => `<th scope="col" class="px-2 py-1.5 font-semibold ${rightAlignedColumns.includes(index) ? 'text-right' : ''}">${header}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
  }

  function renderRaidTable(card, seasons, olderSeason) {
    const rows = seasons.map((season, index) => {
      const stats = season.players.get(card.id);
      if (!stats) {
        return `<tr class="border-b border-slate-800/60 text-slate-600"><td class="px-2 py-1.5">${season.season}</td><td colspan="4" class="px-2 py-1.5">No recorded activity</td></tr>`;
      }
      const previousSeason = seasons[index + 1] || olderSeason;
      const previousStats = previousSeason?.players.get(card.id);
      const damageChange = renderDamageChange(stats, previousStats, previousSeason);
      return `<tr class="border-b border-slate-800/60">
        <th scope="row" class="px-2 py-1.5 font-medium text-slate-300">${season.season}</th>
        <td class="px-2 py-1.5 text-right tabular-nums">${formatNumber(stats.totalDamage)}</td>
        <td class="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">${damageChange}</td>
        <td class="px-2 py-1.5 text-right tabular-nums">${formatNumber(stats.averageDamage)}</td>
        <td class="px-2 py-1.5 text-right tabular-nums text-cyan-200">${formatPercentile(stats.percentile)}</td>
      </tr>`;
    });

    return renderTable(['Season', 'Total dmg', '', 'Avg/token', 'Guild %'], rows, 'No raid data.', [1, 2, 3, 4]);
  }

  function renderWarTable(card, wars) {
    const rows = wars.map((war) => {
      const stats = war.players.get(card.id);
      const label = escapeHtml(war.label);
      if (!stats) {
        return `<tr class="border-b border-slate-800/60 text-slate-600"><th scope="row" title="${label}" class="max-w-36 truncate px-2 py-1.5 font-medium">${label}</th><td colspan="5" class="px-2 py-1.5">No recorded activity</td></tr>`;
      }
      return `<tr class="border-b border-slate-800/60">
        <th scope="row" title="${label}" class="max-w-36 truncate px-2 py-1.5 font-medium text-slate-300">${label}</th>
        <td class="px-2 py-1.5 text-right tabular-nums">${formatNumber(stats.totalScore)}</td>
        <td class="px-2 py-1.5 text-right tabular-nums">${formatNumber(stats.averageScore)}</td>
        <td class="px-2 py-1.5 text-right tabular-nums">${formatNumber(stats.tokens)}</td>
        <td class="px-2 py-1.5 text-right tabular-nums text-violet-200">${formatNumber(stats.skillRating)}</td>
        <td class="px-2 py-1.5 text-right tabular-nums text-cyan-200">${formatPercentile(stats.percentile)}</td>
      </tr>`;
    });

    return renderTable(['War', 'Score', 'Avg/token', 'Spent', 'Skill', 'Guild %'], rows, 'No war data.', [1, 2, 3, 4, 5]);
  }

  function renderCards(cards, raidSeasons, olderRaidSeason, wars, query) {
    const normalizedQuery = query.trim().toLowerCase();
    const sortMode = document.getElementById('report-sort').value;
    const visibleCards = cards
      .filter((card) => card.name.toLowerCase().includes(normalizedQuery))
      .slice()
      .sort((left, right) => {
        const byName = left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });
        if (sortMode === 'raid-rank') return left.raidRank - right.raidRank || byName;
        if (sortMode === 'war-rank') return left.warRank - right.warRank || byName;
        if (sortMode === 'combined-average') return right.combinedAveragePercentile - left.combinedAveragePercentile || byName;
        if (sortMode === 'combined-rank') return left.combinedAverageRank - right.combinedAverageRank || byName;
        return byName;
      });
    const container = document.getElementById('report-cards');
    const status = document.getElementById('report-status');
    const count = document.getElementById('report-count');

    count.textContent = `${visibleCards.length} of ${cards.length} players`;
    status.textContent = cards.length === 0
      ? 'No player activity was found in the selected periods.'
      : (visibleCards.length === 0 ? 'No players match that search.' : '');
    container.innerHTML = visibleCards.map((card) => `
      <article class="min-w-0 rounded-lg border border-slate-700/80 bg-slate-900/80 p-3 shadow-lg shadow-black/20">
        <header class="mb-2 border-b border-slate-800 pb-2">
          <div class="flex min-w-0 items-center gap-2.5">
            ${renderPlayerAvatar(card)}
            <h3 class="min-w-0 truncate text-base font-bold text-slate-100" title="${escapeHtml(card.name)}">${escapeHtml(card.name)}</h3>
          </div>
          <div class="mt-2 flex justify-center gap-8">
            <div class="flex flex-col items-center gap-1">
              <div class="flex h-14 w-14 items-center justify-center rounded-md border text-2xl font-black ${getGradeClasses(card.raidGrade)}" title="Average raid damage: ${formatNumber(card.averageRaidDamage)}">${escapeHtml(card.raidGrade)}</div>
              <span class="text-[10px] font-bold uppercase text-slate-400">Raid</span>
            </div>
            <div class="flex flex-col items-center gap-1">
              <div class="flex h-14 w-14 items-center justify-center rounded-md border text-2xl font-black ${getGradeClasses(card.warGrade)}" title="Total score across recent wars: ${formatNumber(card.totalWarScore)}">${escapeHtml(card.warGrade)}</div>
              <span class="text-[10px] font-bold uppercase text-slate-400">War</span>
            </div>
          </div>
        </header>
        <section aria-label="Raid performance">
          <h4 class="mb-1 text-xs font-bold uppercase text-rose-200">Guild Raid</h4>
          ${renderRaidTable(card, raidSeasons, olderRaidSeason)}
        </section>
        <section aria-label="War performance" class="mt-3 border-t border-slate-800 pt-2">
          <h4 class="mb-1 text-xs font-bold uppercase text-cyan-200">Guild War</h4>
          ${renderWarTable(card, wars)}
        </section>
      </article>`).join('');
  }

  async function initialize() {
    const status = document.getElementById('report-status');
    try {
      const [raidData, wars, playerDirectory] = await Promise.all([
        loadRaidSeasons(),
        loadWars(),
        fetchJson('./data/static/players.json').catch(() => [])
      ]);
      const raidSeasons = raidData.slice(0, RAID_WINDOW_SIZE);
      const olderRaidSeasonData = raidData[RAID_WINDOW_SIZE];
      const olderRaidSeason = olderRaidSeasonData
        ? window.ReportCardMetrics.buildRaidSeasonStats(olderRaidSeasonData)
        : null;
      const metrics = window.ReportCardMetrics.buildReportCards(raidSeasons, wars, playerDirectory);

      const raidWindow = raidSeasons.map((season) => season.season).filter(Number.isFinite);
      const warWindow = wars.map((war) => war.label === 'Active war' ? 'Active' : war.label);
      document.getElementById('report-window').textContent = `Raids ${raidWindow.join(', ') || 'unavailable'} · Wars ${warWindow.join(' · ') || 'unavailable'}`;

      const search = document.getElementById('report-search');
      const sort = document.getElementById('report-sort');
      const draw = () => renderCards(metrics.cards, metrics.raidReports, olderRaidSeason, metrics.warReports, search.value);
      search.addEventListener('input', draw);
      sort.addEventListener('change', draw);
      draw();
    } catch (error) {
      status.textContent = `Could not load report data: ${error.message}`;
    }
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();