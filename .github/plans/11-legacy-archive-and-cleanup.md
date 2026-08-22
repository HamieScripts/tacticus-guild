# Phase 11 — Legacy archive and cleanup

Retire the POC once the Angular app is deployed and verified. Nothing here runs until the migrated
data has been confirmed correct in production.

**Depends on:** all prior phases (at minimum 01–08 for v1 cleanup).

## Preconditions

Do not start until all of these hold:

- The Angular app is live on GitHub Pages and serving Firebase-hosted data.
- Every war present in `data/history/` exists in Firestore + Cloud Storage with matching labels.
- Guild Wars and Battle Log totals have been verified against the POC for at least one war.
- The admin upload flow has successfully published a new war end to end.

## Tasks

### 1. Archive the POC

Move, do not delete — `git mv` so history follows:

```
battle-log.html      → legacy/battle-log.html
guild-teams.html     → legacy/guild-teams.html
guild-wars.html      → legacy/guild-wars.html
index.html           → legacy/index.html
player-page.html     → legacy/player-page.html
src/app.js           → legacy/src/app.js
src/guild-teams.js   → legacy/src/guild-teams.js
src/player-page.js   → legacy/src/player-page.js
src/mobile-responsive.css → legacy/src/mobile-responsive.css
src/consts/          → legacy/src/consts/
tests/               → legacy/tests/
```

Delete outright:

- `src/components/page-overview.js` — empty placeholder, never used.
- `tmp-check.js` — scratch file.

Add `legacy/README.md`: one paragraph explaining this is the pre-Angular POC, kept for reference and
for diffing numbers, and that it is not built or deployed.

Ensure `legacy/` is excluded from the Angular build — add it to `tsconfig` excludes, `.eslintignore`
and the Vitest include globs so it can't break CI.

### 2. Retire the manifest generator

`scripts/generate-dataset-manifest.js` is superseded by Firestore metadata documents, and its
derivation logic now lives in `@core/snapshot/war-metadata`. Delete it along with the
`generate:datasets` npm script.

Confirm first that the phase 08 workflow no longer calls it.

### 3. Data folder

Keep `data/` until the Firebase migration has been verified in production, then:

- Move `data/history/**` and `data/current/**` to `legacy/data/` as a cold backup, or drop them if
  Cloud Storage is the accepted system of record. Prefer keeping one archived copy — these captures
  cannot be regenerated.
- Delete `data/dataset-manifest.json` and any `dataset-manifest.hash` — fully superseded.
- `data/static/**` moves to `legacy/data/static/` once `static/*` documents are live in Firestore.

### 4. Portrait tooling

`src/auto-map-portraits.js` is a Node utility, not browser code. Decide:

- **Keep** — move to `scripts/auto-map-portraits.mjs`, update it to write to Firestore
  (`static/portraitMap`, `static/imageManifest`) instead of local JSON, and keep the `map:portraits`
  script.
- **Retire** — only if the admin upload flow gains portrait discovery, which it does not in phase 07.

Recommend keeping it, ported to Firestore. `scripts/copy-portraits.ps1` and the `img/` / `img-temp/`
folders stay as-is unless portraits move to Cloud Storage — that's a separate decision, not part of
this cleanup.

### 5. README rewrite

Replace the POC README's mitmproxy-and-commit workflow with:

- **Capture** — the mitmproxy steps stay; they are still how war data is obtained.
- **Publish** — sign in as an admin, use `/admin/upload`. No commit, no deploy.
- **Develop** — `npm ci`, `npm start`, `npm test`, `npm run lint`.
- **Deploy** — automatic on push to `master`; rules deployed manually with
  `firebase deploy --only firestore:rules,storage`.
- **Architecture** — the pages / components / services / core rules, with a pointer to
  `.github/plans/00-overview.md`.

### 6. Final sweep

- `grep -rn "rxjs\|@angular/fire\|zone.js" src/` returns nothing.
- `grep -rn "inject(" src/app/components/` returns nothing.
- `grep -rn "innerHTML\|escapeHtml" src/` returns nothing.
- `getCoreScore` is defined once.
- No `cdn.tailwindcss.com` reference survives outside `legacy/`.
- `npm ci && npm run lint && npm test && npm run build` passes from a clean checkout.

## Verification

- A clean clone builds and deploys with no reference to any file under `legacy/`.
- The deployed site is byte-for-byte free of POC scripts.
- Historical war captures still exist somewhere durable — verify before deleting anything.

## Out of scope

Rewriting the capture process itself. Migrating portrait images off the repo.
