# Phase 03 — Firebase data layer

Replace file-based data loading with Firebase. Firestore holds small metadata documents, Cloud
Storage holds the raw war snapshot blobs, and one service per concern exposes signals to pages.

**Depends on:** phases 01, 02.

## Rules for this tier

- One concern per service. No god-service.
- Signal-based state; promise-based methods. **No RxJS** — use the modular `firebase/*` SDK, not
  `@angular/fire`.
- Services may import `@core/*`. Services must never import a component or page.
- Only pages inject these services.

## Firebase model

### Firestore

```
wars/{warId}
  id:           string   (uuid, matches the legacy history filename)
  label:        string   "Opponent (YYYY-MM-DD)"
  sourceLabel:  string   "GuildA vs. GuildB (YYYY-MM-DD)"
  opponentName: string
  warDate:      timestamp
  isCurrent:    boolean  (the live war; at most one)
  blobPath:     string   "snapshots/{warId}.json"
  sizeBytes:    number
  uploadedBy:   string   (uid)
  uploadedAt:   timestamp

static/portraitMap        { map: { [unitId]: filename } }
static/imageManifest      { files: string[] }
static/guildTeams         { teams: TeamComp[] }        (phase 09)
admins/{uid}              { email: string }
```

### Cloud Storage

`snapshots/{warId}.json` — the raw ~662KB capture, downloaded and parsed client-side.

Rationale: Firestore documents cap at 1 MiB and snapshots are read whole, never queried field-wise.

### Security rules

- `wars/**` and `static/**`: `allow read: if true;` — war data is public.
- `wars/**` and `static/**`: `allow write: if isAdmin();` where `isAdmin()` checks
  `exists(/databases/$(database)/documents/admins/$(request.auth.uid))`.
- `admins/**`: no client writes at all — managed from the Firebase console.
- Storage `snapshots/**`: public read, admin-only write, and a size cap (`request.resource.size < 5 * 1024 * 1024`)
  plus `contentType == 'application/json'`.

Commit `firestore.rules` and `storage.rules` at the repo root with a `firebase.json` that
references them, so rules are reviewable in PRs even though hosting stays on GitHub Pages.

## Services

### `services/firebase.service.ts`

Owns app initialisation. Reads config from `environments/`. Exposes lazily-created `Firestore`,
`Auth` and `FirebaseStorage` handles. Nothing else in the app calls `initializeApp`.

The Firebase web config is public by design — it identifies the project, it does not authorise.
Security lives in the rules above and the admin allowlist.

### `services/war-dataset.service.ts`

Replaces `data/dataset-manifest.json` and its generator.

- `wars` — signal of `WarMetadata[]`, newest first.
- `currentWar` — `computed` picking `isCurrent`, falling back to the newest.
- `load(): Promise<void>` — one `getDocs` against `wars` ordered by `warDate desc`.
- `byId(id): WarMetadata | undefined`

### `services/war-snapshot.service.ts`

- `get(warId): Promise<GuildSnapshot[]>` — resolve the blob URL via `getDownloadURL`, fetch, parse,
  run `getPrimaryEventResponseData` then `buildSnapshot` from `@core`.
- In-memory `Map<warId, GuildSnapshot[]>` cache so tab switches don't refetch.
- IndexedDB layer keyed by `warId` for the raw JSON, so a repeat visit costs no egress. Store the
  blob's `updated` timestamp alongside and revalidate against the Firestore metadata doc.
- Expose loading/error state as signals so pages can drive skeletons without try/catch in templates.

Parsing a 662KB payload on the main thread is acceptable to start. If it visibly janks, move
`buildSnapshot` into a Web Worker — it is already a pure function, which is why phase 02 mattered.

### `services/portrait.service.ts`

- Loads `static/portraitMap` and `static/imageManifest`.
- `urlFor(unitId): string | null` — normalises the id, looks up the filename, checks the manifest,
  returns the asset URL or `null` for a fallback placeholder.
- Cached after first load; portrait data changes rarely.

### `services/auth.service.ts`

Full detail in phase 07. Stubbed here so the shell can compile:

- `user` — signal of the current Firebase user or `null`.
- `isAdmin` — `computed`, backed by an `admins/{uid}` document read.
- `signIn()` / `signOut()`.

## Migration script

`scripts/migrate-to-firebase.mjs`, run once locally with admin credentials:

1. Upload every `data/history/*.json` to `snapshots/{uuid}.json`.
2. Upload `data/current/live-war.json` if non-empty, flagged `isCurrent: true`.
3. Write the matching `wars/{uuid}` metadata docs, deriving label/opponent/date via the phase 02
   `war-metadata` helpers so the strings match the old manifest exactly.
4. Write `static/portraitMap`, `static/imageManifest` and `static/guildTeams` from `data/static/`.

Idempotent — re-running must not duplicate documents.

## Verification

- Migration script run against the real `data/` folder produces one `wars` doc per history file with
  labels byte-identical to the current `data/dataset-manifest.json`.
- Rules tests (Firebase emulator): anonymous read of `wars` succeeds; anonymous write is rejected;
  a uid present in `admins` can write; a uid absent cannot.
- `warSnapshot.get(id)` twice issues one network request.
- A hard reload after a prior visit serves the snapshot from IndexedDB with no Storage download.
- `grep -r "rxjs\|@angular/fire" src/` returns nothing.

## Out of scope

Rendering. The admin upload UI (phase 07). Auth guards (phase 07).
