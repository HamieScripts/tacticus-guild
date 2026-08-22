# Phase 01 — Scaffold and tooling

Stand up the Angular workspace at the repo root with the mandated folder structure, Tailwind v4 and
strict tooling. No features yet — this phase ends with an empty shell that builds and lints clean.

**Depends on:** nothing.

## Tasks

### 1. Create the workspace

Generate at the repo root, keeping the existing POC files in place for now (they move in phase 11).

- Standalone components, no NgModules.
- SSR/prerender enabled — needed for the static build in phase 08.
- Skip the default test setup if it pulls Karma; wire Vitest instead.

Because the POC currently owns `package.json` and `src/`, generate into a temp directory and move
the Angular files in, or generate in place and reconcile. Preserve the existing npm scripts
(`map:portraits`, `copy:portraits`, `generate:datasets`) until phase 11 retires them.

### 2. Zoneless change detection

- `provideZonelessChangeDetection()` in `app.config.ts`.
- Remove `zone.js` from `polyfills` and from `package.json`.
- Set `changeDetection: ChangeDetectionStrategy.OnPush` on every component.

### 3. Strict TypeScript

In `tsconfig.json`: `strict`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`,
`noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, plus Angular's
`strictTemplates` and `strictInjectionParameters`.

### 4. Path aliases

```jsonc
"paths": {
  "@core/*":       ["src/app/core/*"],
  "@services/*":   ["src/app/services/*"],
  "@components/*": ["src/app/components/*"],
  "@pages/*":      ["src/app/pages/*"]
}
```

### 5. Folder skeleton

Create the four tiers with a `.gitkeep` or index barrel each:

```
src/app/core/
src/app/services/
src/app/components/
src/app/pages/
```

### 6. Tailwind v4

- Install `tailwindcss` and `@tailwindcss/postcss`; add a `.postcssrc.json` with the plugin.
- `src/styles.css` starts with `@import "tailwindcss";`.
- Port the POC theme into an `@theme` block: dark slate-950 background, slate-100 text, and the
  accent roles used throughout — cyan (info/projection), emerald (win), rose (loss), amber
  (warning), violet (buffs).
- Port `legacy/src/mobile-responsive.css` (currently `src/mobile-responsive.css`, ~180 lines):
  mobile header/sidebar/hamburger rules, `-webkit-overflow-scrolling: touch`, `overscroll-behavior:
  contain` on scroll containers, and the `max-width: 640px` font sizing. Express as Tailwind
  utilities where a utility exists; keep the rest as plain CSS in `styles.css`.
- Remove any reliance on the Tailwind CDN script — it does not ship to production.

### 7. Linting and formatting

- `angular-eslint` with the recommended + template rules.
- Add a lint rule or CI grep that fails if a file under `src/app/components/**` contains `inject(`.
  This mechanically enforces the "components are data-driven" rule.
- Prettier with the Angular HTML parser.

### 8. Testing

- Vitest with `jsdom`, plus `@analogjs/vitest-angular` (or the Angular CLI's Vitest builder) for
  component tests.
- Domain tests under `src/app/core/**/*.spec.ts` must run without any Angular test bed.
- npm scripts: `test`, `test:watch`, `lint`, `build`, `start`.

### 9. Environments

`src/environments/environment.ts` and `environment.production.ts` holding the Firebase web config
shape (values filled in phase 03) and a `production` flag. The POC's `data-prod-hidden` gating is
replaced by route-level checks against this flag.

## Verification

- `npm run build` succeeds and produces `dist/<app>/browser`.
- `npm run lint` passes on the empty skeleton.
- `npm test` runs and reports zero tests without erroring.
- A throwaway component using `@if`/`@for` and a `signal` renders in `ng serve` with no zone.js in
  the bundle (confirm via `npm ls zone.js` returning empty).

## Out of scope

Any page, service or domain logic. Firebase config values. Deleting POC files.
