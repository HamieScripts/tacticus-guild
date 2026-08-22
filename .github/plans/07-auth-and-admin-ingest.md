# Phase 07 — Auth and admin ingest

Add Google sign-in and an admin-only page for uploading captured war snapshots, replacing the manual
"drop a file in `data/history/` and push" workflow.

**Depends on:** phase 03.

## Auth scope

War data stays **publicly readable**. Sign-in exists only to unlock admin/edit features. An
anonymous visitor sees every read-only page exactly as today.

## `services/auth.service.ts`

Completes the phase 03 stub.

- `user` — signal of `AppUser | null`, kept in sync via `onAuthStateChanged` (a callback API — no
  RxJS needed).
- `isAdmin` — signal, set by reading `admins/{uid}` after sign-in, cleared on sign-out.
- `signIn()` — `signInWithPopup` with `GoogleAuthProvider`.
- `signOut()`.
- Use `browserLocalPersistence` so a refresh doesn't drop the session.

Admin membership is a document in `admins/{uid}`, managed from the Firebase console. Firestore and
Storage rules check the same collection, so the client-side `isAdmin` signal is a UX affordance
only — it is not the security boundary.

## Guard

`src/app/services/admin.guard.ts` — functional `CanActivateFn`:

- Waits for the first auth state resolution before deciding, so a refresh on `/admin/upload` doesn't
  bounce a signed-in admin to home.
- Not signed in → redirect to home.
- Signed in but not admin → render a "not authorised" state rather than a silent redirect.

Applied to the `admin/upload` route only.

## Header integration

`site-header` gains `user` input and `signIn` / `signOut` outputs (already specified in phase 04).
The **app shell**, not the header, injects `AuthService` and wires them. The admin nav link is
rendered only when `isAdmin()` is true.

## Page — `src/app/pages/admin-upload/`

Injects `AuthService`, `WarDatasetService` and a new `WarUploadService`.

### Flow

1. **Provide JSON** — drag-and-drop a `.json` file, pick via file input, or paste into a textarea.
2. **Validate** — `validateSnapshot()` from `@core` (phase 02). On failure show the reason; on
   success continue.
3. **Preview derived metadata** — opponent name, war date, label, source label, battle count, player
   count, file size. All from `@core/snapshot/war-metadata`, the same code that generated the old
   manifest, so labels stay consistent with historical entries.
4. **Confirm** — the admin can override the label and tick "this is the current live war".
5. **Upload** — blob to `snapshots/{warId}.json`, then the `wars/{warId}` metadata document.
   If `isCurrent` is ticked, clear the flag on the previously-current war in the same batch.
6. **Result** — success with a link to the new war, or a clear error.

`warId` is the snapshot's own event UUID when available, otherwise a generated UUID — this matches
the existing history filenames and makes re-uploading the same war idempotent.

### Components — `src/app/components/admin/`

| Component | Inputs | Outputs |
| --- | --- | --- |
| `json-drop-zone` | `disabled`, `accept` | `fileSelected`, `textPasted` |
| `snapshot-preview` | `metadata`, `warnings` | — |
| `upload-progress` | `state: 'idle' \| 'uploading' \| 'done' \| 'error'`, `progress`, `message` | `retry` |

None of these touch Firebase. The page owns the upload.

## `services/war-upload.service.ts`

Single concern: writing a war.

- `upload(warId, json, metadata, onProgress): Promise<void>` — `uploadBytesResumable` for progress,
  then the Firestore write.
- Rejects payloads over the Storage rule's size cap before attempting the upload.
- On a failed metadata write after a successful blob upload, delete the orphaned blob.

## Safety

- Client-side validation is UX; the Storage rules enforce content type and size, and the Firestore
  rules enforce admin identity. Never rely on the client alone.
- The uploaded JSON is never rendered as HTML — it is parsed and read through typed models.
- Uploading over an existing `warId` overwrites. Warn explicitly in the confirm step and record
  `uploadedBy` / `uploadedAt` on every write.

## Verification

- Signed out: `/admin/upload` redirects home; read-only pages are unaffected.
- Signed in, non-admin: sees the "not authorised" state; a direct Firestore write from the console
  is rejected by the emulator rules test.
- Signed in admin: uploads a real captured file; the derived label matches what
  `generate-dataset-manifest.js` would have produced for the same file.
- The new war appears in the dataset selector on Guild Wars without a manual deploy.
- Ticking "current live war" moves the flag off the previous war.
- A malformed JSON paste is rejected with a readable reason and nothing is written.
- Refreshing on `/admin/upload` as an admin stays on the page.

## Out of scope

Editing or deleting existing wars. User management UI — admins are added in the Firebase console.
