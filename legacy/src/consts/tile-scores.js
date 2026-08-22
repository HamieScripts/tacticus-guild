(function initTileScores(globalScope) {
  const TILE_SCORES = Object.freeze({
    // Trenches: 10k bonus
    Trenches1: 10000,
    Trenches2: 10000,
    Trenches3: 10000,
    // Bunkers, Artillery, Landing Pads, Anti-Air: 16k bonus (confirmed from live data)
    Bunker1: 16000,
    Bunker2: 16000,
    Bunker3: 16000,
    ArtilleryPosition1: 16000,
    ArtilleryPosition2: 16000,
    LandingPad1: 16000,
    LandingPad2: 16000,
    AntiAirBattery: 16000,
    // Medicae Stations and HQ: bonus unconfirmed — fallback will match via KNOWN_TILE_BONUSES
    MedicaeStation1: 40000,
    MedicaeStation2: 40000,
    HQ: 40000
  });

  const KNOWN_TILE_BONUSES = Object.freeze([10000, 16000, 40000]);
  // Sum of all tile bonuses on a full war map (approximate; update when tile layout is confirmed)
  const POSSIBLE_TILE_SCORE = 520000;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TILE_SCORES, KNOWN_TILE_BONUSES, POSSIBLE_TILE_SCORE };
  }

  if (globalScope && typeof globalScope === 'object') {
    globalScope.TILE_SCORES = TILE_SCORES;
    globalScope.KNOWN_TILE_BONUSES = KNOWN_TILE_BONUSES;
    globalScope.POSSIBLE_TILE_SCORE = POSSIBLE_TILE_SCORE;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
