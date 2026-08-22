# Phase 02 — Domain core

Port the POC's business logic into `src/app/core/` as pure, framework-free TypeScript. This is the
highest-value phase: it de-duplicates logic that currently exists in three copies and establishes
the test suite that guards the whole rewrite.

**Depends on:** phase 01.

## Rules for this tier

- No Angular imports. No `inject`. No DI. No `fetch`.
- Pure functions and interfaces only. Every export is directly unit-testable.
- Both services and pages may import from `@core/*`.

## Target structure

```
src/app/core/
  models/
    war-snapshot.model.ts
    activity-log.model.ts
    player.model.ts
    guild.model.ts
    zone.model.ts
    battle.model.ts
    team-comp.model.ts
  scoring/
    tile-scores.ts
    score-splitter.ts
    skill-rating.ts
  snapshot/
    primary-event.ts
    build-snapshot.ts
    battle-log.ts
    war-metadata.ts
  util/
    unit-id.ts
    format.ts
```

## Tasks

### 1. Models

Translate the observed JSON shapes into interfaces. Source of truth is `data/history/*.json`.

- `WarSnapshot` — `{ eventResults: EventResult[] }`
- `EventResult` — `{ eventId: string; eventResultType: string; eventResponseData: EventResponseData }`
- `EventResponseData` — `{ activityLogs: ActivityLog[]; playerData: PlayerData[]; guildData: GuildData[] }`
- `ActivityLog` — discriminated union on `type`:
  `'battleFinished' | 'playerClaimedZone' | 'playerLeftZone' | 'battlefieldSelected'`.
  Common fields: `id`, `userId`, `teamIndex`, `createdOn` (ms epoch).
- `BattleFinishedLog` — adds `score`, `zone`, `abandoned`, `attacker`, `defender`, `buffs`.
- `BattleSide` — `{ userId; units: BattleUnit[]; machineOfWar: BattleUnit | null; buffs?: Buff[] }`
- `BattleUnit` — `{ unitId; startHPBefore; remainingHPBefore; remainingHPAfter; startHPAfter }`
- `Zone` — `{ id; type: ZoneType; visualId }`
- `PlayerData` — `{ userId; displayName; avatarUnitId; avatarFrameId: string | null }`
- `GuildData` — `{ teamIndex: 1 | 2; guildId; name }`
- `TeamComp` — `{ name; type; core: string[]; flex: string[]; mow: string[] }` (used in phase 09)

Model the fields the app actually reads. Use `unknown` and narrow rather than `any` for the
long tail of unread fields.

### 2. `scoring/tile-scores.ts`

Lift `src/consts/tile-scores.js` verbatim, dropping the IIFE/globalThis wrapper:

- `TILE_SCORES` — Trenches1-3 → 10000; Bunker1-3, ArtilleryPosition1-2, LandingPad1-2,
  AntiAirBattery → 16000; MedicaeStation1-2, HQ → 40000.
- `KNOWN_TILE_BONUSES` — `[10000, 16000, 40000]`
- `POSSIBLE_TILE_SCORE` — `520000`
- Derive a `ZoneType` union type from the `TILE_SCORES` keys.

### 3. `scoring/score-splitter.ts`

Port `src/consts/score-splitter.js`. Single canonical implementation replacing the copies in
`app.js`, `player-page.js` and `guild-teams.js`.

- `MAX_TOKEN_SCORE = 1600`
- `getCoreScore(value: number, zoneType?: ZoneType | null): { core: number; bonus: number }`
- Preserve the existing behaviour exactly: values ≤ 1600 return `{ core: value, bonus: 0 }`;
  above that, try the zone-specific bonus first, then fall back through the known bonuses in
  descending order (40000, 30000, 16000, 10000).

Note the fallback list in the POC includes 30000 while `KNOWN_TILE_BONUSES` does not. Keep the
POC's behaviour and leave a one-line comment recording the discrepancy rather than "fixing" it.

### 4. `scoring/skill-rating.ts`

Extract from `src/app.js`:

- `isEasyGameBattle(battle)` — detects NPC opponents (e.g. `templNpc1Initiate` unit ids).
- `calculateSkillRating(battle)` — applies the cleanup, easy-game and win-state multipliers.

Both must be pure functions over the model types, with no DOM or HTML in them. The POC's
`getEasyGameBadgeHtml()` is **not** ported — badge rendering becomes a component in phase 05.

### 5. `snapshot/primary-event.ts`

- `getPrimaryEventResponseData(snapshot: WarSnapshot): EventResponseData | null`

Selects the event result with the largest combined `activityLogs + playerData + guildData` payload,
matching both `src/app.js` and `scripts/generate-dataset-manifest.js`.

### 6. `snapshot/build-snapshot.ts`

- `buildSnapshot(raw: WarSnapshot): GuildSnapshot[]`

Port the POC's transformation: raw events → per-guild buckets → per-player token arrays, with token
scores split into core + tile bonus, easy-game flags and skill ratings attached. Define the output
types (`GuildSnapshot`, `PlayerSnapshot`, `TokenEntry`) explicitly rather than inferring them.

### 7. `snapshot/battle-log.ts`

Extract the Battle Log data shaping from `src/app.js`:

- `flattenBattles(data: EventResponseData): Battle[]` — one row per `battleFinished` log, joined to
  player display names and guild names.
- `BattleLogFilters` interface — sort, zone type, result, cleanup, mode, players, characters.
- `applyBattleFilters(battles, filters): Battle[]` and `sortBattles(battles, sort): Battle[]` as
  pure predicates. Phase 06 wraps these in `computed()`.
- `buildPerformanceSeries(battles, dimension)` — the aggregates behind the performance tabs, emitted
  as plain `{ label, points }` data, not chart config.

### 8. `snapshot/war-metadata.ts`

Port the derivation logic from `scripts/generate-dataset-manifest.js` so the admin upload page
(phase 07) can reuse it:

- `deriveOpponentName(guildData, homeGuildName): string`
- `deriveWarDate(activityLogs): number | null` — latest `createdOn`.
- `buildWarLabel(...)` — reproduces the existing `"Opponent (YYYY-MM-DD)"` and
  `"GuildA vs. GuildB (YYYY-MM-DD)"` strings.
- `validateSnapshot(json: unknown): { ok: true; snapshot: WarSnapshot } | { ok: false; reason: string }`

The home guild name (`[TW] Praetorians of Terra`) is currently hardcoded in the script — move it to
a named constant in `core/`, not a magic string.

### 9. `util/`

- `unit-id.ts` — `normalizeUnitId()`, `getBattleUnitId()` from `guild-teams.js`.
- `format.ts` — `formatBattleDate()` and number formatting. `escapeHtml()` is **not** ported;
  Angular templates escape by default.

### 10. Tests

Port `tests/live-war-dataset.test.js` to `src/app/core/**/*.spec.ts`. Existing coverage to preserve:

- `isEasyGameBattle` detects `templNpc1Initiate`.
- `buildSnapshot` produces the expected token structure and easy-game flag.
- `getCoreScore(41600, 'HQ')` → `{ core: 1600, bonus: 40000 }`.
- `calculateSkillRating` honours cleanup / easy-game / win-state multipliers.
- `shouldDisplayCurrentDataset` equivalent — snapshot shape validation, now `validateSnapshot`.

Add new coverage for `getPrimaryEventResponseData`, `applyBattleFilters`, `sortBattles` and
`deriveOpponentName`. Use a trimmed fixture derived from a real history file — do not commit a
662KB fixture.

## Verification

- `npm test` green, with the ported assertions passing unchanged in meaning.
- `grep -r "@angular" src/app/core` returns nothing.
- `getCoreScore` exists in exactly one file.
- Running `buildSnapshot` over a real `data/history/*.json` produces player totals identical to the
  POC page for the same file.

## Out of scope

Any rendering, any service, any Firebase access.
