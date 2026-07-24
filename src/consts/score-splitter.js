(function initScoreSplitter(globalScope) {
  let tileScores = {};
  let knownTileBonuses = [10000, 16000, 30000, 40000];

  if (globalScope && typeof globalScope === 'object') {
    if (globalScope.TILE_SCORES && typeof globalScope.TILE_SCORES === 'object') {
      tileScores = globalScope.TILE_SCORES;
    }

    if (Array.isArray(globalScope.KNOWN_TILE_BONUSES)) {
      knownTileBonuses = globalScope.KNOWN_TILE_BONUSES;
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    try {
      const tileScoreConsts = require('./tile-scores');
      tileScores = tileScoreConsts.TILE_SCORES || tileScores;
      knownTileBonuses = tileScoreConsts.KNOWN_TILE_BONUSES || knownTileBonuses;
    } catch (error) {
      // Keep defaults when module loading is unavailable.
    }
  }

  const MAX_TOKEN_SCORE = 1600;

  function getCoreScore(value, zoneType = null) {
    const numericValue = Number(value) || 0;
    if (numericValue <= MAX_TOKEN_SCORE) {
      return { core: numericValue, bonus: 0 };
    }

    const mappedBonus = Number(tileScores[String(zoneType || '')] || 0);
    if (mappedBonus > 0) {
      const mappedCore = numericValue - mappedBonus;
      if (mappedCore >= 0 && mappedCore <= MAX_TOKEN_SCORE) {
        return { core: mappedCore, bonus: mappedBonus };
      }
    }

    for (const bonus of knownTileBonuses) {
      const core = numericValue - bonus;
      if (core >= 0 && core <= MAX_TOKEN_SCORE) {
        return { core, bonus };
      }
    }

    const fallbackCore = Math.min(numericValue, MAX_TOKEN_SCORE);
    return { core: fallbackCore, bonus: Math.max(numericValue - fallbackCore, 0) };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MAX_TOKEN_SCORE, getCoreScore };
  }

  if (globalScope && typeof globalScope === 'object') {
    globalScope.MAX_TOKEN_SCORE = MAX_TOKEN_SCORE;
    globalScope.getCoreScore = getCoreScore;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);