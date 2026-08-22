# Phase 06 — Battle Log page

Port `battle-log.html` and the battle-log half of `src/app.js`: four tabs, a dense filter bar and
the performance charts.

**Depends on:** phases 02, 03, 04. Can run in parallel with phase 05.

## Page — `src/app/pages/battle-log/`

Injects `WarDatasetService`, `WarSnapshotService`, `PortraitService`. Nothing below it does.

### Inputs (query params)

- `war` — war id.
- `tab` — `history | guild | attack | defence`, default `history`.

### State

```ts
readonly filters  = signal<BattleLogFilters>(DEFAULT_FILTERS);
readonly battles  = computed(() => flattenBattles(this.data()));
readonly filtered = computed(() => sortBattles(applyBattleFilters(this.battles(), this.filters()), this.filters().sort));
readonly stats    = computed(() => summariseBattles(this.filtered()));
readonly series   = computed(() => buildPerformanceSeries(this.filtered(), this.tab()));
```

One filter signal, not eleven. Child components emit partial patches and the page merges them —
this keeps the derived chain to a single dependency.

Filter state serialises into the URL query string so a filtered view is shareable, and restores on
load. Debounce the router update so typing in a text filter doesn't spam history entries.

## Tabs

| Tab | Content |
| --- | --- |
| `history` | Filter bar, stat badges, battle list |
| `guild` | Guild-level performance chart + summary |
| `attack` | Attack performance chart |
| `defence` | Defence performance chart |

Rendered through the shared `tab-strip` from phase 04. Tab changes update `?tab=` from the page.

## Components — `src/app/components/battle-log/`

| Component | Inputs | Outputs |
| --- | --- | --- |
| `battle-filter-bar` | `filters`, `options: FilterOptions` | `filtersChange` |
| `multi-select` | `options`, `selected`, `label`, `placeholder` | `selectionChange` |
| `battle-stat-badges` | `stats: BattleStats` | — |
| `battle-list` | `battles`, `portraits` | `battleSelect` |
| `battle-row` | `battle`, `portraits` | — |
| `battle-lineup` | `units`, `portraits`, `side` | — |
| `performance-chart` | `series`, `title`, `yLabel` | — |

### `multi-select`

Hand-rolled, no third-party library. Needed for the player and character filters. Requirements:

- Typeahead filter over options, checkbox list, "select all" / "clear".
- Full keyboard support: arrows, Enter, Escape, type-ahead.
- `role="listbox"` with `aria-multiselectable`, proper `aria-activedescendant`.
- Character lists run to hundreds of units — render the filtered subset only, cap the visible
  window if needed.

### `performance-chart`

The single approved third-party exception. Chart.js, lazily imported so it stays out of the initial
bundle:

```ts
const { Chart } = await import('chart.js/auto');
```

- Input is our plain `{ label, points }[]` series — Chart.js config is built inside the component
  and never leaks into the page or `@core`.
- Destroy the chart instance in `ngOnDestroy`; recreate or `update()` on input change via `effect`.
- Respect `prefers-reduced-motion` by disabling animation.
- This component is reused by phase 10.

## Filter options

`FilterOptions` (available zone types, results, modes, players, characters) is derived by the page
from the loaded snapshot via a `@core` helper, then passed down. Components never scan the raw data
to discover their own options.

## Verification

- For a given war, the unfiltered battle count matches the POC.
- Each filter dimension, applied alone and in combination, yields identical counts and ordering to
  the POC. Test at least: result + zone type; cleanup + player; character multiselect with two units.
- Stat badges match the POC values.
- Each of the three charts plots the same points as the POC's canvas/SVG output.
- Chart.js is absent from the initial bundle (`ng build --stats-json`) and appears in a lazy chunk.
- A filtered URL, copied and opened cold, restores the same view.
- `multi-select` is fully operable by keyboard alone.
- `grep -rn "inject(" src/app/components/battle-log/` returns nothing.

## Out of scope

Guild Teams comp aggregates (phase 09). Multi-war player trends (phase 10).
