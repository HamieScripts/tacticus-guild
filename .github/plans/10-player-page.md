# Phase 10 — Player page (post-v1)

Port `player-page.html` and `src/player-page.js` (~590 lines): per-player attack/defence performance
trends across every war.

**Depends on:** phase 06 (reuses `performance-chart`).

**Not part of v1.**

## Page — `src/app/pages/players/`

Route `players`, with `?player=<userId>` bound as an input. Injects `WarDatasetService`,
`WarSnapshotService` and `PlayerStatsService`.

### State

```ts
readonly playerId = input<string | undefined>(undefined, { alias: 'player' });
readonly wars     = /* all snapshots, loaded in parallel via the cached service */;
readonly stats    = computed(() => buildWarPlayerStats(this.wars()));
readonly series   = computed(() => toChartSeries(this.stats(), this.playerId()));
readonly summary  = computed(() => summarisePlayer(this.stats(), this.playerId()));
```

Default view is "All players" (one line per player). Selecting a player narrows to a single pair of
attack/defence lines.

This page loads **every** war snapshot. Rely on the `WarSnapshotService` in-memory + IndexedDB cache
from phase 03, load them in parallel, and render progressively as each resolves rather than waiting
for all of them.

## `services/player-stats.service.ts`

Single concern: cross-war player identity and aggregates.

- Builds the `userId → displayName` map across all wars, preferring the most recent display name (a
  player can rename between wars).
- Exposes the player list for the selector, sorted by name.
- Aggregation maths itself lives in `@core`, not here.

## `@core` additions

`core/players/war-player-stats.ts`:

- `buildWarPlayerStats(wars): WarPlayerStats[]` — per war: `{ warId, label, timestamp, perPlayer: Map<userId, { attackScores: number[]; defenceScores: number[] }> }`. Ported from `PLAYER_PAGE_STATE` construction.
- `summarisePlayer(stats, playerId)` — totals, averages, best war, trend direction.
- `toChartSeries(stats, playerId | null)` — plain `{ label, points }[]`.

The POC's `getChartYDomain`, `getChartTicks` and the hand-rolled SVG path construction are **not**
ported — Chart.js handles axis scaling and rendering. Port only the data shaping.

## Components — `src/app/components/players/`

| Component | Inputs | Outputs |
| --- | --- | --- |
| `player-select` | `players`, `selectedId` | `selectionChange` |
| `player-summary` | `summary` | — |

The chart is the existing `performance-chart` from phase 06, unchanged. If the all-players view
needs a distinct visual treatment (many thin lines, muted palette), add it as an input to that
component rather than forking it.

Player line colours: replace the POC's ad-hoc hash-to-colour function with a fixed palette cycled by
index, so colours are stable and legible against the dark theme.

## Verification

- All-players view plots one line per player per war, matching the POC's point values.
- Selecting a player matches the POC's single-player chart and summary numbers.
- `?player=<userId>` deep link works cold.
- A player who renamed between wars appears once, under their latest name.
- A player absent from some wars shows gaps, not zeroes.
- Loading all wars stays responsive and shows progressive results.

## Out of scope

Player comparison view. Predictive trends.
