# Phase 08 — Deploy to GitHub Pages

Replace the "upload the whole repo" workflow with an Angular build, keeping GitHub Pages as the
host.

**Depends on:** phase 04 (needs something routable to build).

## Current state

`.github/workflows/deploy-pages.yml` runs `npm run generate:datasets` and uploads the entire repo as
a static artifact — no build step, because the POC has none.

## Target workflow

Trigger on push to `master` and `workflow_dispatch`.

1. `actions/checkout`
2. `actions/setup-node` with the Node version pinned and npm cache enabled
3. `npm ci`
4. `npm run lint`
5. `npm test`
6. `npm run build -- --base-href /tacticus-guild/`
7. Copy `dist/<app>/browser/index.html` → `dist/<app>/browser/404.html`
8. `touch dist/<app>/browser/.nojekyll`
9. `actions/upload-pages-artifact` with `path: dist/<app>/browser`
10. `actions/deploy-pages`

Lint and test run before the build so a broken commit never deploys.

## GitHub Pages specifics

### Base href

The site is served from a project subpath (`/tacticus-guild/`). Pass `--base-href` at build time
rather than hardcoding it, so local `ng serve` stays at `/`.

### SPA deep links

Pages returns its own 404 for unknown paths, which breaks `/guild-wars?war=...` on a cold load. The
`404.html` copy of `index.html` makes Pages serve the app shell for any path; Angular's router then
resolves the route client-side. This is why phase 04 uses path routing rather than hash routing.

### `.nojekyll`

Prevents Jekyll from stripping files and directories beginning with an underscore.

## Prerendering

Enable prerendering for routes with no per-request data:

- `/` (Home) — fully static, prerendered.
- Everything else stays client-rendered; the data lives in Firebase and is fetched at runtime.

Do not attempt to prerender Guild Wars or Battle Log — that would bake war data into the build and
reintroduce the deploy-to-publish coupling this rewrite is removing.

## Configuration and secrets

The Firebase web config (apiKey, authDomain, projectId, appId, storageBucket) is **not secret** —
it identifies the project and is visible in any Firebase web app. Commit it in
`src/environments/environment.production.ts`.

Security comes from:

- Firestore and Storage rules (phase 03)
- The `admins/{uid}` allowlist (phase 07)
- Authorised domains configured in the Firebase Auth console — add the GitHub Pages domain, remove
  anything unused

Never commit a service account key. The migration script (phase 03) runs locally with credentials
supplied via an environment variable and is not part of CI.

## Rules deployment

Firestore and Storage rules are committed at the repo root but are **not** deployed by this
workflow, since the app doesn't use Firebase Hosting. Deploy them manually with
`firebase deploy --only firestore:rules,storage` and document that in the README (phase 11).
Optionally add a separate, manually-dispatched workflow for it later.

## Verification

- A push to `master` produces a green run and a deployed site.
- Cold-loading `https://<user>.github.io/tacticus-guild/guild-wars?war=<id>` renders the war
  directly, with no flash of a 404.
- Assets, portraits and lazy chunks all resolve under the `/tacticus-guild/` base path.
- The initial JS bundle contains no Chart.js and no zone.js.
- A deliberately failing test blocks the deploy.

## Out of scope

Custom domains. Preview deployments for pull requests.
