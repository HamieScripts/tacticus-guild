# Angular Rewrite — Overview

The POC (vanilla HTML/JS static site) is complete. This plan rewrites it as a modern Angular
application: zoneless, signals-first, Tailwind v4, Firebase-backed, deployed as a prerendered
static site to GitHub Pages.

## Goals

- Replace the ~3,670-line `src/app.js` monolith with a componentised, testable Angular app.
- Keep the bundle light: no RxJS, no third-party component libraries.
- Move war data from checked-in JSON files into Firebase, with an in-app admin upload flow.
- Preserve every number the POC renders — the ported domain tests are the correctness gate.

## Tech stack

| Concern | Choice |
| --- | --- |
| Framework | Angular (latest), standalone components, zoneless change detection |
| State | Angular signals (`signal`, `computed`, `linkedSignal`, `resource`) |
| Styling | Tailwind CSS (latest) via `@tailwindcss/postcss` |
| Data | Firebase — Firestore (metadata), Cloud Storage (snapshot blobs), Auth (admin) |
| Firebase client | Modular `firebase/*` SDK directly |
| Charts | Chart.js (sole approved third-party exception, wrapped in our own component) |
| Hosting | GitHub Pages, Angular prerender + SPA fallback |
| Tests | Vitest for domain logic, Angular TestBed for components |

## Architecture rules

These are non-negotiable and every phase doc restates the relevant slice.

### `src/app/pages/**`

Top-level pages wired into the router. **This is the only place in the application that may inject
a data service.** A page owns the async lifecycle (loading, error, retry) and hands plain data down.

### `src/app/components/**`

Reusable and strictly data-driven. A component communicates *only* through `input()` and `output()`.
No service injection, no `fetch`, no router access, no global state. If a component "needs" a
service, the requirement belongs on the page instead and should arrive as an input.

### `src/app/services/**`

Each service covers exactly one concern (wars, war snapshots, portraits, auth, users...). Services
expose signals and promise-returning methods. No RxJS.

### `src/app/core/**`

Supporting tier for pure domain logic: TypeScript models, scoring maths, snapshot parsing, filter
predicates. No Angular imports, no DI, no side effects — plain functions that are trivially
unit-testable. Services and pages both consume it.

```
src/app/
  core/        pure domain logic + models (no Angular)
  services/    one concern each, signal-based, injectable
  components/  reusable, input()/output() only
  pages/       routed, may inject services
```

## Decisions

| Decision | Choice |
| --- | --- |
| Repo layout | POC archived to `/legacy`, Angular app at repo root |
| Deployment | GitHub Pages (not Firebase Hosting) |
| Auth scope | War data is publicly readable; login gates admin/edit only |
| Ingestion | Admin-only page in the app to paste/upload captured war JSON |
| Snapshot storage | Raw blob in Cloud Storage, parsed client-side; Firestore holds metadata only |
| `@angular/fire` | Not used — it is RxJS-first. Use the modular `firebase/*` SDK |
| Charts | Chart.js allowed, lazily imported, wrapped in a local component |
| v1 scope | Home, Guild Wars, Battle Log |
| Deferred | Guild Teams, Player Page |
| Dropped | Portrait mapper dev tab |

### Why Cloud Storage for snapshots

Historical snapshots are ~662KB each. A Firestore document is capped at 1 MiB, so storing the raw
JSON as a document field leaves almost no headroom for growth. Snapshots are also read whole and
never queried field-by-field, which is exactly the Cloud Storage access pattern. Firestore keeps a
small `wars/{warId}` metadata document that points at the blob.

## Phase index

| # | Phase | Depends on |
| --- | --- | --- |
| 01 | [Scaffold and tooling](01-scaffold-and-tooling.md) | — |
| 02 | [Domain core](02-domain-core.md) | 01 |
| 03 | [Firebase data layer](03-firebase-data-layer.md) | 01, 02 |
| 04 | [Shell and home](04-shell-and-home.md) | 01 |
| 05 | [Guild Wars page](05-guild-wars-page.md) | 02, 03, 04 |
| 06 | [Battle Log page](06-battle-log-page.md) | 02, 03, 04 |
| 07 | [Auth and admin ingest](07-auth-and-admin-ingest.md) | 03 |
| 08 | [Deploy to GitHub Pages](08-deploy-github-pages.md) | 04 |
| 09 | [Guild Teams page](09-guild-teams-page.md) | 05, 06 |
| 10 | [Player page](10-player-page.md) | 06 |
| 11 | [Legacy archive and cleanup](11-legacy-archive-and-cleanup.md) | all |

Phases 05 and 06 can run in parallel once 04 lands. Phases 09 and 10 are explicitly post-v1.

## Definition of done for v1

- Home, Guild Wars and Battle Log render from Firebase-hosted data.
- Every ported domain test passes; totals match the POC for at least one historical war.
- Deep links work on GitHub Pages from a cold load.
- An admin can sign in and upload a new war snapshot without touching the repo.
- `/legacy` holds the POC; the root has no vanilla-JS leftovers.
