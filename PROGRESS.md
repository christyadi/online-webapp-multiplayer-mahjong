# Progress and evidence

## Current milestone

Milestone 1 — Establish the project and repeatable commands.

## Environment checks (2026-09-05)

- Ponytail marketplace and `ponytail@ponytail` 4.9.0 were already installed and enabled; no reinstall was performed. Full Ponytail guidance is active.
- ECC 2.2.1 was already installed and enabled. Its team-orchestration merge gates and Git workflow are being used.
- Node 24.20.0 was installed through the existing nvm-windows 1.2.2 installation. Commands use a process-local PATH to `C:\Users\jochr\AppData\Local\nvm\v24.20.0`; the user's persistent global Node selection remains unchanged.
- GitHub CLI 2.72.0 is authenticated as `christyadi` with private-repository scope. `christyadi/mahjong-together` was not occupied at check time.
- Microsoft Edge 152 was present. Playwright 1.62.0 Chromium is installed and verified. Firefox verification is deferred at the user's direction after the 1.63.0 patched browser failed Windows activation twice because its `mozglue` side-by-side assembly could not be resolved. WebKit verification remains for the full browser milestone.
- Dependency downloads from `https://registry.npmjs.org/` are available.
- The workspace root contained only an empty, uncommitted Git repository. It is preserved as a container; this game uses its own nested `mahjong-together` repository.

## External blockers

- Render CLI is not installed, and the available in-app browser reached Render's GitHub sign-in page without an authenticated session. A user-supported Render sign-in is required before account billing safeguards, service access, and zero-spend deployment can be verified. Independent implementation continues meanwhile.

## Resolved direct dependency versions

- Runtime: React/React DOM 19.2.8, Express 5.2.1, Socket.IO/server client 4.8.3, and Zod 4.5.4.
- Build and checks: Vite 8.2.2, React plugin 6.1.1, TypeScript 6.0.3, tsx 4.23.13, Vitest 5.0.0, Playwright 1.62.0, ESLint 10.10.0, typescript-eslint 8.69.0, React Hooks ESLint plugin 7.1.1, Prettier 3.9.6, and concurrently 10.0.5.
- Types: Node 24.13.3, Express 5.0.6, React 19.2.18, and React DOM 19.2.7.
- Playwright 1.63.0 was not retained: its Firefox 155/build 1543 executable reproduced a Windows loader failure after a forced reinstall. The previous stable Playwright 1.62.0 was selected before the lockfile was frozen.

## Milestone 1 verification

- `npm ci`: passed; 303 packages installed, 0 reported vulnerabilities.
- `npm run build`: passed; shared declarations, Vite production assets, and server JavaScript built.
- `npm run typecheck`: passed in all three workspaces.
- `npm run lint`: passed.
- `npm run format`: passed.
- `npm test`: passed, 1 file and 2 tests.
- `npm run test:e2e -- --project=chromium`: passed, 1 production page/health smoke test.
- Firefox: explicitly deferred. WebKit: deferred to the complete browser verification milestone.

## Milestone 1 review round 1

- Confirmed high: a clean `npm run typecheck` could not resolve ignored shared declarations unless `build` ran first. Root typecheck now builds shared before checking every workspace; verification passed after `tsc -b packages/shared/tsconfig.json --clean` removed generated declarations.
- Confirmed medium: the repository `SPEC.md` was only a summary and relied on a nonportable attachment path. It now contains the complete authoritative fixed specification in source control.
- Confirmed medium: `@types/node` 26.4.1 exposed Node 26-only APIs while runtime is Node 24.20.0. It is pinned to the latest Node 24 declaration line, 24.13.3.
- Confirmed low: bare `npm run test:e2e` scheduled deferred browsers. During the user-requested Firefox deferral it now runs Chromium, while `npm run test:e2e:all` preserves the final cross-browser gate.

## Milestone 1 corrected verification

- Clean generated-output typecheck: passed after cleaning shared TypeScript outputs; the command rebuilt shared before all no-emit checks.
- Exact package verification: `@types/node@24.13.3` and `@playwright/test@1.62.0` installed at the root.
- `npm ci`: passed again after the corrected lockfile; 303 packages installed and 0 reported vulnerabilities.
- Build, lint, formatting, 2 unit tests, and the Chromium production page/health smoke test all passed after the review corrections.

## Milestone 1 review round 2

- The same independent read-only reviewer verified all four corrections and found no remaining critical, high, or medium issue.

## Next exact step

Create the Milestone 1 checkpoint commit, then implement Milestone 2 physical tiles, injectable shuffling/dealing, and winning-hand decomposition tests.
