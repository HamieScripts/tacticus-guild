# Phase 05 — Guild Wars page

Port `guild-wars.html` and the leaderboard/projection half of `src/app.js` (~3,670 lines total) to a
signals-driven page with data-driven child components.

**Depends on:** phases 02, 03, 04. Can run in parallel with phase 06.

## Page — `src/app/pages/guild-wars/`

The only file in this feature allowed to inject services: `WarDatasetService`, `WarSnapshotService`,
`PortraitService`.

### Inputs (bound from query params)

- `war` — war id; falls back to the current war when absent.

### State

```ts
readonly warId       = input<string | undefined>(undefined, { alias: 'war' });
readonly snapshot    = resource({ params: () => this.selectedWarId(), loader: ... });
readonly layout      = signal<'table' | 'cards'>('table');
readonly search      = signal('');
readonly sort        = signal<SortState>({ key: 'total', dir: 'desc' });
readonly legend      = signal<LegendVisibility>(DEFAULT_LEGEND);
readonly activeGuild = signal<number>(1);

readonly rows = computed(() => sortRows(filterRowsByName(this.baseRows(), this.search()), this.sort()));
```

All filtering and sorting delegates to pure functions from `@core` — the page holds state and wires
inputs, it does not implement logic.

Persist `layout`, `sort` and `legend` to `localStorage` so preferences survive reloads.

## Components — `src/app/components/guild-wars/`

| Component | Inputs | Outputs |
| --- | --- | --- |
| `dataset-selector` | `wars`, `selectedId` | `selectionChange` |
| `token-projection-table` | `projection: GuildProjection[]` | — |
| `leaderboard-table` | `rows`, `sort`, `legend`, `portraits` | `sortChange` |
| `leaderboard-cards` | `rows`, `legend`, `portraits` | — |
| `layout-toggle` | `layout` | `layoutChange` |
| `player-search` | `value`, `resultCount` | `valueChange` |
| `buff-legend` | `buffs`, `visibility` | `visibilityChange` |
| `token-cell` | `token: TokenEntry`, `portraits` | — |
| `unit-avatar` | `unitId`, `url`, `size` | — |
| `easy-game-badge` | `battle` | — |

Notes:

- `dataset-selector` changing emits upward; the **page** then does `router.navigate` to update
  `?war=`. The component knows nothing about routing.
- `unit-avatar` receives a resolved URL, never the `PortraitService`. The page resolves URLs once
  and passes a `Map<unitId, string>` down.
- `easy-game-badge` replaces the POC's `getEasyGameBadgeHtml()` string builder, including the 🏢
  building icon case.
- `token-cell` renders the core/bonus split from `getCoreScore` — it receives the already-split
  values, it does not call the splitter.

## Rendering migration notes

- Every `innerHTML` template string in `app.js` becomes an Angular template. `escapeHtml()` is
  dropped; Angular escapes interpolation by default. Do not reintroduce `[innerHTML]`.
- `@for` blocks need a `track` on a stable id (`token.id`, `row.userId`) — not `$index`.
- Long leaderboards: measure first. Only add virtual scrolling (hand-rolled, no CDK) if a real war
  renders slowly.
- Skeletons render from `snapshot.isLoading()`, errors from `snapshot.error()` via `error-state`
  with a retry output.

## Verification

- Load a migrated historical war; every player row's total, core, bonus, token count, win/loss and
  skill rating matches the POC page rendered from the same source file.
- Token projection table totals match the POC exactly.
- Search filters case-insensitively and the result count updates.
- Sorting by each column matches the POC ordering, including ties.
- Toggling legend entries hides/shows the same tokens as the POC.
- Layout toggle switches table/cards and survives a reload.
- `?war=<id>` deep link loads the right war from cold.
- `grep -rn "inject(" src/app/components/guild-wars/` returns nothing.

## Out of scope

Battle log tab (phase 06). Portrait mapper tab — dropped entirely.
