# Phase 03 — Firebase data layer

Replace file-based data loading with Firebase. Firestore holds both the small metadata documents
and the gzipped snapshot payloads, and one service per concern exposes signals to pages.

**Depends on:** phases 01, 02.

> **Revised during implementation.** The plan originally put raw snapshots in Cloud Storage. Measuring
> the real captures changed that: they run 647 KB to 2,180 KB raw (two already exceed Firestore's
> 1 MiB document limit) but gzip to 68–140 KB, a 6–11% ratio. At 140 KB worst case there is roughly
> 7x headroom inside a single document, and browsers decompress natively via `DecompressionStream`.
> Storing gzipped blobs in Firestore keeps the project on the free Spark plan, since Cloud Storage
> now requires Blaze billing on new projects.

## Rules for this tier

- One concern per service. No god-service.
- Signal-based state; promise-based methods. **No RxJS** — use the modular `firebase/*` SDK, not
  `@angular/fire`.
- Services may import `@core/*`. Services must never import a component or page.
- Only pages inject these services.

## Firebase model

```
wars/{warId}                       metadata only, cheap to list
  id:              string   (uuid, matches the legacy history filename)
  label:           string   "Opponent (YYYY-MM-DD)"
  sourceLabel:     string   "GuildA vs. GuildB (YYYY-MM-DD)"
  opponentName:    string
  warDate:         timestamp
  isCurrent:       boolean  (the live war; at most one)
  rawBytes:        number   (uncompressed size, for diagnostics)
  compressedBytes: number
  uploadedBy:      string   (uid)
  uploadedAt:      timestamp

wars/{warId}/payload/snapshot      the heavy document, fetched only on demand
  gzip:            bytes    (gzipped UTF-8 JSON of the raw capture)

static/portraitMap        { map: { [unitId]: filename } }
static/imageManifest      { files: string[] }
static/guildTeams         { teams: TeamComp[] }        (phase 09)
admins/{uid}              { email: string }
```

The payload lives in a subcollection document rather than a field on `wars/{warId}` so that listing
wars does not drag every blob down with it.

### Size ceiling

A Firestore document caps at 1 MiB. Today's worst case is 140 KB compressed. The upload path must
reject anything that would exceed roughly 900 KB compressed and say so plainly, rather than failing
opaquely at write time. If captures ever approach that, revisit Cloud Storage.

### Security rules

- `wars/**` (including the payload subcollection) and `static/**`: `allow read: if true;` — war data
  is public.
- Same paths: `allow write: if isAdmin();` where `isAdmin()` checks
  `exists(/databases/$(database)/documents/admins/$(request.auth.uid))`.
- `admins/**`: no client writes at all — managed from the Firebase console.

Commit `firestore.rules` and a `firebase.json` that references them, so rules are reviewable in PRs
even though hosting stays on GitHub Pages.

## Services

### `services/firebase.service.ts`

Owns app initialisation. Reads config from `environments/`. Exposes lazily-created `Firestore` and
`Auth` handles. Nothing else in the app calls `initializeApp`.

The Firebase web config is public by design — it identifies the project, it does not authorise.
Security lives in the rules above and the admin allowlist.

### `services/war-dataset.service.ts`

Replaces `data/dataset-manifest.json` and its generator.

- `wars` — signal of `WarMetadata[]`, newest first.
- `currentWar` — `computed` picking `isCurrent`, falling back to the newest.
- `load(): Promise<void>` — one `getDocs` against `wars` ordered by `warDate desc`.
- `byId(id): WarMetadata | undefined`

### `services/war-snapshot.service.ts`

- `get(warId): Promise<GuildSnapshot[]>` — read `wars/{warId}/payload/snapshot`, gunzip the `gzip`
  bytes, `JSON.parse`, then `getPrimaryEventResponseData` + `buildSnapshot` from `@core`.
- In-memory `Map<warId, GuildSnapshot[]>` cache so tab switches don't refetch.
- IndexedDB layer keyed by `warId` holding the compressed bytes, so a repeat visit costs no reads.
  Store `uploadedAt` alongside and revalidate against the `wars/{warId}` metadata document.
- Expose loading/error state as signals so pages can drive skeletons without try/catch in templates.

Gunzip plus parse of a 2 MB payload on the main thread is acceptable to start. If it visibly janks,
move it into a Web Worker — `buildSnapshot` is already a pure function, which is why phase 02
mattered.

### `core/util/gzip.ts`

Compression helpers used by both the service and the upload path, built on the native
`CompressionStream` / `DecompressionStream`:

- `gzipJson(value: unknown): Promise<Uint8Array>`
- `gunzipJson<T>(bytes: Uint8Array): Promise<T>`

No library. Both APIs are available in every browser the app targets and in Node 18+.

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

`scripts/migrate-to-firebase.ts`, run once locally against the emulator and then live:

1. Gzip every `data/history/*.json` and write `wars/{uuid}/payload/snapshot`.
2. Include `data/current/live-war.json` if non-empty, flagged `isCurrent: true`.
3. Write the matching `wars/{uuid}` metadata docs, deriving label/opponent/date via the phase 02
   `war-metadata` helpers so the strings match the old manifest exactly.
4. Write `static/portraitMap`, `static/imageManifest` and `static/guildTeams` from `data/static/`.

Idempotent — re-running must not duplicate documents.

## Verification

- Migration script run against the real `data/` folder produces one `wars` doc per history file with
  labels byte-identical to the current `data/dataset-manifest.json`.
- Rules tests against the emulator: anonymous read of `wars` and of the payload subcollection
  succeeds; anonymous write is rejected; a uid present in `admins` can write; a uid absent cannot.
- A round trip through `gzipJson`/`gunzipJson` reproduces every capture byte-for-byte, and
  `buildSnapshot` over the result still passes `npm run verify:parity`.
- `warSnapshot.get(id)` twice issues one network read.
- A hard reload after a prior visit serves the snapshot from IndexedDB with no Firestore read.
- `grep -r "rxjs\|@angular/fire" src/` returns nothing.

## Out of scope

Rendering. The admin upload UI (phase 07). Auth guards (phase 07).
