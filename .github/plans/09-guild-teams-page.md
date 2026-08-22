# Phase 09 — Guild Teams page (post-v1)

Port `guild-teams.html` and `src/guild-teams.js` (~1,000 lines): the team composition library, the
drag-and-drop team builder, the library builder and the comp performance aggregates.

**Depends on:** phases 05 and 06 (reuses their components and the loaded snapshot data).

**Not part of v1.** Start only once Home, Guild Wars and Battle Log are deployed and verified.

## Page — `src/app/pages/guild-teams/`

Injects `GuildTeamsService`, `WarDatasetService`, `WarSnapshotService`, `PortraitService`.

Three tabs via the shared `tab-strip`: **Library**, **Team Builder**, **Library Builder**.

The POC gated this page behind `data-prod-hidden`. Replace that with a real decision: either ship it
publicly or put it behind the `adminGuard` from phase 07. Do not reimplement attribute-based hiding.

## `services/guild-teams.service.ts`

Single concern: team composition templates.

- Reads `static/guildTeams` from Firestore (migrated from `data/static/guild-teams.json`).
- `teams` signal of `TeamComp[]` — `{ name, type, core[], flex[], mow[] }`.
- `save(teams)` — admin-only write, used by the Library Builder.

Comp *performance* aggregation is not this service's job — it is pure logic over battles and belongs
in `@core`.

## `@core` additions

- `core/teams/comp-match.ts`
  - `matchesComp(battle, comp): boolean` — core units required, flex optional, MoW slot.
  - `buildCompAggregate(battles, comp): CompAggregate` — uses, wins, losses, cleanup wins, cleanup
    losses, win rate.
  - `sortCompSummary(aggregates, sort)`.
- Memoise by comp signature the way the POC's `teamsState.coreMatchCache` does, but as a pure
  `Map` inside the aggregate builder — not global mutable state.

Aggregates run across **all** wars, so the page loads every snapshot. Fetch them in parallel through
`WarSnapshotService` (which caches), and show incremental progress rather than blocking on all six.

## Components — `src/app/components/teams/`

| Component | Inputs | Outputs |
| --- | --- | --- |
| `team-card` | `team`, `portraits`, `aggregate` | `select` |
| `team-library` | `teams`, `typeFilter`, `aggregates`, `portraits` | `typeFilterChange`, `teamSelect` |
| `unit-pool` | `units`, `portraits`, `search` | `searchChange`, `unitDragStart` |
| `team-builder-slot` | `unit`, `label`, `accepts` | `unitDropped`, `unitRemoved` |
| `team-builder` | `draft`, `portraits`, `aggregate` | `draftChange` |
| `comp-stats-badges` | `aggregate` | — |
| `library-builder` | `teams` | `teamsChange`, `exportRequested` |

### Drag and drop

Native HTML5 DnD only — **no Angular CDK**, no third-party library. Implement as a small
`draggableUnit` / `unitDropTarget` directive pair under `components/teams/`:

- `dragstart` sets `dataTransfer` with the unit id and a drag image.
- `dragover` calls `preventDefault` and applies a hover style only when the slot accepts the type.
- `drop` emits the unit id; the **page** owns the draft state and applies the change.
- `dragend` clears hover styles.
- Provide a keyboard alternative (select unit, then activate a slot) — DnD alone is inaccessible.

Directives are exempt from the "no logic in components" rule only in that they may hold DOM event
plumbing. They still must not inject data services.

## Labels

Per the established convention, cleanup counts are labelled with a paintbrush glyph — **W 🖌** and
**L 🖌** — and are kept visually separate from the main W/L labels. Do not merge them into a single
combined figure.

## Verification

- Library renders every team from Firestore with correct portraits, and the type filter matches the
  POC's att/def/hybrid behaviour.
- For a known comp, uses / wins / losses / cleanup counts equal the POC's values across the same set
  of wars.
- Builder: dragging a unit into core, flex and MoW slots updates the live aggregate; invalid drops
  are rejected.
- The whole builder is operable by keyboard.
- Library Builder exports JSON identical in shape to `data/static/guild-teams.json`.
- Comp aggregates for six wars compute without a visible freeze; if they don't, move
  `buildCompAggregate` to a Web Worker — it's pure.

## Out of scope

Sharing or persisting individual user drafts. Multi-user collaboration.
