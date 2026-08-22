# Phase 04 — Shell and home

Build the application shell, routing and the home page. Establishes the reusable component
vocabulary that phases 05 and 06 consume.

**Depends on:** phase 01. Can run in parallel with 02 and 03.

## Routing

`src/app/app.routes.ts`, every route lazy via `loadComponent`:

| Path | Page | Notes |
| --- | --- | --- |
| `''` | `HomePage` | prerendered in phase 08 |
| `guild-wars` | `GuildWarsPage` | reads `?war=<id>` |
| `battle-log` | `BattleLogPage` | reads `?war=<id>&tab=<tab>` |
| `admin/upload` | `AdminUploadPage` | `adminGuard` (phase 07) |
| `**` | `NotFoundPage` | |

- `provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling(...))`.
- Query params bind straight to page `input()`s — pages never inject `ActivatedRoute` for this.
- Path-based routing, not hash. Phase 08 adds the `404.html` fallback that makes this work on
  GitHub Pages.
- Deferred routes (`guild-teams`, `players`) are added by phases 09 and 10, not stubbed now.

## Components

All under `src/app/components/`, all `OnPush`, all communicating only via `input()` / `output()`.

### `site-header`

Ports the shared header from every POC page.

- Inputs: `links: NavLink[]`, `user: AppUser | null`.
- Outputs: `signIn`, `signOut`.
- Desktop nav inline; below `sm` it collapses to the hamburger + slide-in panel + overlay from
  `mobile-responsive.css`.
- Active link state comes from `routerLinkActive`, which is a directive, not a service — allowed.

### `mobile-nav`

The slide-in panel. Inputs `links`, `open`; output `close`. Body scroll lock while open.

### `page-card`

Home page link tile. Inputs: `title`, `description`, `route`, `icon`.

### `tab-strip`

Used by Guild Wars and Battle Log. Inputs `tabs: TabDef[]`, `activeId`; output `tabChange`.
Keyboard navigable (arrow keys, Home/End) with correct `role="tablist"` semantics.

### `skeleton-loader`

Replaces the POC's `.animate-pulse` blocks. Inputs: `rows`, `variant: 'table' | 'card'`.

### `empty-state` / `error-state`

Inputs: `message`, optional `retry` output. Pages render these off service error signals.

## Home page

`src/app/pages/home/` — ports `index.html`. Static overview of the app's sections rendered as
`page-card`s from a local constant array. No service injection; nothing async.

Drop the POC's `data-prod-hidden` inline script. Sections not yet built simply aren't in the array.

## Styling notes

- Dark theme by default; no light theme in v1.
- Accent roles stay consistent with the POC: emerald = win, rose = loss, cyan = info/projection,
  amber = warning, violet = buffs.
- Every interactive element needs a visible focus ring — the POC is weak here.

## Verification

- `ng serve`: header nav works at desktop and mobile widths; hamburger opens/closes; overlay click
  and Escape both dismiss.
- Home renders all cards and each navigates correctly.
- Route lazy chunks appear as separate files in `ng build --stats-json`.
- `grep -rn "inject(" src/app/components/` returns nothing.
- Axe or Lighthouse accessibility pass on Home with no critical violations.

## Out of scope

Any data fetching. Guild Wars and Battle Log page bodies.
