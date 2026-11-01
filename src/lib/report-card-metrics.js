(function registerReportCardMetrics(globalScope) {
  const SKILL_BUFF_MULTIPLIERS = {
    EnvDefenderHealthBuff2: 1.25,
    EnvArmourSupplies: 1.1,
    EnvFlakFire: 1.2,
    EnvArtillerySupport: 1.15,
    EnvAngelsOfDeath: 1.1,
    EnvFortified: 1.025
  };

  function getCoreScore(score, zoneType) {
    if (typeof globalScope.getCoreScore === 'function') {
      return globalScope.getCoreScore(score, zoneType).core;
    }

    if (typeof module !== 'undefined' && module.exports) {
      return require('../consts/score-splitter').getCoreScore(score, zoneType).core;
    }

    return Math.min(Number(score) || 0, 1600);
  }

  function percentileRank(value, population) {
    if (population.length <= 1) return 100;

    const below = population.filter((candidate) => candidate < value).length;
    const tied = population.filter((candidate) => candidate === value).length;
    return ((below + (tied - 1) / 2) / (population.length - 1)) * 100;
  }

  function addPercentiles(players, field) {
    const values = [...players.values()].map((player) => player[field]);
    players.forEach((player) => {
      player.percentile = percentileRank(player[field], values);
    });
  }

  function assignGrades(players, metric, gradeField, rankField) {
    const ordered = players.slice().sort((left, right) => (
      right[metric] - left[metric]
      || left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
    ));
    const remainingGrades = ['A', 'B', 'C', 'D', 'F'];

    ordered.forEach((player, index) => {
      player[rankField] = index + 1;
      player[gradeField] = index === 0
        ? 'A+'
        : remainingGrades[Math.floor(((index - 1) * remainingGrades.length) / Math.max(ordered.length - 1, 1))];
    });
  }

  function buildRaidSeasonStats(data) {
    const players = new Map();

    (Array.isArray(data?.entries) ? data.entries : []).forEach((entry) => {
      const userId = String(entry?.userId || '').trim();
      if (!userId) return;

      if (!players.has(userId)) {
        players.set(userId, { userId, totalDamage: 0, battleDamage: 0, tokens: 0 });
      }

      const player = players.get(userId);
      const damage = Number(entry.damageDealt) || 0;
      player.totalDamage += damage;
      if (entry.damageType !== 'Bomb') {
        player.tokens += 1;
        player.battleDamage += damage;
      }
    });

    players.forEach((player) => {
      player.averageDamage = player.tokens > 0 ? player.battleDamage / player.tokens : 0;
    });
    addPercentiles(players, 'totalDamage');

    return {
      season: Number(data?.season),
      fetchedOn: Number(data?.fetchedOn) || 0,
      players
    };
  }

  function getEventResponseData(data) {
    const results = Array.isArray(data?.eventResults) ? data.eventResults : [];
    return results
      .filter((result) => result?.eventResultType === 'SUCCESS')
      .map((result) => result.eventResponseData)
      .filter(Boolean)
      .sort((left, right) => (
        (right.activityLogs?.length || 0) - (left.activityLogs?.length || 0)
      ))[0] || null;
  }

  function isCleanup(log) {
    const units = Array.isArray(log?.defender?.units) ? log.defender.units : [];
    return units.some((unit) => {
      if (!Object.prototype.hasOwnProperty.call(unit, 'remainingHPBefore')) return true;
      return Number(unit.remainingHPBefore ?? 0) < Number(unit.startHPBefore ?? 0);
    });
  }

  function isDefended(log) {
    const units = Array.isArray(log?.defender?.units) ? log.defender.units : [];
    return units.some((unit) => Object.prototype.hasOwnProperty.call(unit, 'remainingHPAfter'));
  }

  function isEasyGame(log) {
    const attacker = Array.isArray(log?.attacker?.units) ? log.attacker.units : [];
    const defender = Array.isArray(log?.defender?.units) ? log.defender.units : [];
    const units = [
      ...attacker,
      ...defender,
      log?.attacker?.machineOfWar,
      log?.defender?.machineOfWar
    ];
    return units.some((unit) => unit?.unitId === 'templNpc1Initiate');
  }

  function calculateSkillRating(log, coreScore, hasScore, abandoned) {
    if (!hasScore || abandoned || coreScore <= 0) return 0;

    let rating = coreScore;
    const buffs = Array.isArray(log?.buffs)
      ? log.buffs
      : (Array.isArray(log?.attacker?.buffs) ? log.attacker.buffs : []);
    const uniqueBuffs = new Set(buffs.map((buff) => buff?.abilityId || buff?.name || buff?.id || ''));

    uniqueBuffs.forEach((buff) => {
      rating *= SKILL_BUFF_MULTIPLIERS[buff] || 1;
    });

    if (isCleanup(log)) rating *= 0.75;
    if (isEasyGame(log)) rating *= 0.1;
    if (!isDefended(log)) rating *= 2;

    return rating / 10;
  }

  function buildWarStats(data, label = 'War') {
    const eventData = getEventResponseData(data);
    const guilds = Array.isArray(eventData?.guildData) ? eventData.guildData : [];
    const guild = guilds.find((entry) => (
      String(entry?.guildTag || '').toUpperCase() === 'XXPQS'
      || String(entry?.name || '').toLowerCase().includes('praetorians of terra')
    ));
    const ourTeamIndex = Number(guild?.teamIndex);
    const players = new Map();
    const activityLogs = Array.isArray(eventData?.activityLogs) ? eventData.activityLogs : [];
    const names = new Map(
      (Array.isArray(eventData?.playerData) ? eventData.playerData : [])
        .map((player) => [String(player?.userId || ''), String(player?.displayName || '')])
        .filter(([id]) => id)
    );
    const seenBattleIds = new Set();

    if (Number.isFinite(ourTeamIndex)) {
      activityLogs.forEach((log) => {
        if (Number(log?.teamIndex) !== ourTeamIndex) return;
        const userId = String(log?.userId || log?.attacker?.userId || '').trim();
        if (!userId || players.has(userId)) return;
        players.set(userId, {
          userId,
          name: names.get(userId) || userId,
          totalScore: 0,
          tokens: 0,
          skillRating: 0
        });
      });

      activityLogs.forEach((log) => {
        if (log?.type !== 'battleFinished' || Number(log.teamIndex) !== ourTeamIndex) return;

        const userId = String(log?.userId || log?.attacker?.userId || '').trim();
        if (!userId) return;

        const battleId = String(log.id || `${userId}-${log.createdOn}-${log.score}`);
        if (seenBattleIds.has(battleId)) return;
        seenBattleIds.add(battleId);

        if (!players.has(userId)) {
          players.set(userId, {
            userId,
            name: names.get(userId) || userId,
            totalScore: 0,
            tokens: 0,
            skillRating: 0
          });
        }

        const player = players.get(userId);
        const hasScore = Object.prototype.hasOwnProperty.call(log, 'score');
        const abandoned = Boolean(log.abandoned);
        const coreScore = hasScore ? getCoreScore(log.score, log.zone?.type) : 0;

        player.tokens += 1;
        if (!abandoned) player.totalScore += coreScore;
        player.skillRating += calculateSkillRating(log, coreScore, hasScore, abandoned);
      });
    }

    players.forEach((player) => {
      player.averageScore = player.tokens > 0 ? player.totalScore / player.tokens : 0;
    });
    addPercentiles(players, 'skillRating');

    return { label, players };
  }

  function buildReportCards(raidSeasons, wars, playerDirectory = []) {
    const nameMap = new Map();
    const profileMap = new Map();
    (Array.isArray(playerDirectory) ? playerDirectory : []).forEach((player) => {
      if (!player?.id) return;
      const userId = String(player.id);
      if (player?.name) nameMap.set(userId, String(player.name));
      profileMap.set(userId, {
        avatarUnitId: String(player?.avatarUnitId || '').trim(),
        avatarFrameId: String(player?.avatarFrameId || '').trim()
      });
    });

    const raidReports = raidSeasons.map(buildRaidSeasonStats);
    const warReports = wars.map(({ data, label }) => buildWarStats(data, label));
    const cards = new Map();
    const ensurePlayer = (userId) => {
      if (!cards.has(userId)) {
        cards.set(userId, {
          id: userId,
          name: nameMap.get(userId) || userId,
          avatarUnitId: profileMap.get(userId)?.avatarUnitId || '',
          avatarFrameId: profileMap.get(userId)?.avatarFrameId || '',
          activityTokens: 0,
          raids: [],
          wars: []
        });
      }
      return cards.get(userId);
    };

    raidReports.forEach((season) => {
      season.players.forEach((stats, userId) => {
        const card = ensurePlayer(userId);
        card.activityTokens += stats.tokens;
        card.raids.push({ season: season.season, stats });
      });
    });

    warReports.forEach((war) => {
      war.players.forEach((stats, userId) => {
        const card = ensurePlayer(userId);
        if (!nameMap.has(userId) && stats.name && stats.name !== userId) card.name = stats.name;
        card.activityTokens += stats.tokens;
        card.wars.push({ label: war.label, stats });
      });
    });

    const topPlayers = [...cards.values()]
      .sort((left, right) => right.activityTokens - left.activityTokens || left.name.localeCompare(right.name))
      .slice(0, 30)
      .map((card) => {
        const seasonsPlayed = card.raids.filter((entry) => entry.stats.totalDamage > 0);
        const totalDamage = seasonsPlayed.reduce((total, entry) => total + entry.stats.totalDamage, 0);
        const warsPlayed = card.wars.filter((entry) => entry.stats.tokens > 0);
        const totalWarScore = warsPlayed.reduce((total, entry) => total + entry.stats.totalScore, 0);
        const raidPercentiles = seasonsPlayed.map((entry) => entry.stats.percentile);
        const warPercentiles = warsPlayed.map((entry) => entry.stats.percentile);
        const averageRaidPercentile = raidPercentiles.length > 0
          ? raidPercentiles.reduce((total, value) => total + value, 0) / raidPercentiles.length
          : null;
        const averageWarPercentile = warPercentiles.length > 0
          ? warPercentiles.reduce((total, value) => total + value, 0) / warPercentiles.length
          : null;
        const combinedPercentiles = [averageRaidPercentile, averageWarPercentile].filter(Number.isFinite);
        return {
          ...card,
          averageRaidDamage: seasonsPlayed.length > 0 ? totalDamage / seasonsPlayed.length : 0,
          totalWarScore,
          averageRaidPercentile,
          averageWarPercentile,
          combinedAveragePercentile: combinedPercentiles.length > 0
            ? combinedPercentiles.reduce((total, value) => total + value, 0) / combinedPercentiles.length
            : 0
        };
      });

    assignGrades(topPlayers, 'averageRaidDamage', 'raidGrade', 'raidRank');
    assignGrades(topPlayers, 'totalWarScore', 'warGrade', 'warRank');
    topPlayers.forEach((card) => {
      card.combinedAverageRank = (card.raidRank + card.warRank) / 2;
    });

    topPlayers.sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }));

    return { raidReports, warReports, cards: topPlayers };
  }

  const api = { percentileRank, buildRaidSeasonStats, buildWarStats, buildReportCards };
  globalScope.ReportCardMetrics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);