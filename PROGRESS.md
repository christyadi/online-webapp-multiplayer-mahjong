# Progress and evidence

## Current milestone

Milestone 5 — Build the reliable multiplayer protocol.

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

## Milestone 1 checkpoint

- Commit `be44254` (`chore: establish project foundation`) was pushed to the new private repository `https://github.com/christyadi/mahjong-together` on branch `codex/mahjong-together`.

## Milestone 2 implementation

- Added the fixed 34-type ordering, physical tile DTO/schema, suit/rank metadata, and tile-type ordering helpers to the shared package.
- Added 136-tile construction, Node-crypto Fisher–Yates shuffling with an injectable test random source, and round-robin initial dealing with the dealer's extra tile.
- Added normal-hand validation that tries every pair and recursively memoizes pung/chow decompositions, validates declared chow/pung/kong melds, counts kongs as one set, rejects duplicate IDs or more than four copies, and materializes the actual physical winning combination.
- Added the separate fully concealed seven-distinct-pairs validation; quads are not treated as two pairs.
- Verification: strict typecheck, lint, and production build pass. Vitest passes 3 files and 17 tests covering 136 identities/copies, deterministic shuffle, invalid random values, deal counts/ownership, legal and illegal sequences, honors, ambiguous decomposition, declared pungs/kongs, valid seven pairs, quad rejection, malformed melds, duplicate IDs, invalid sizes, and decomposition ownership.

## Milestone 2 review round 1

- Confirmed medium: declared concealed chow/pung shapes were accepted even though only kongs can be declared concealed. The common meld validator now rejects any concealed non-kong, with focused regressions.
- Confirmed low: the exported meld validator did not independently reject repeated physical IDs. It now requires unique IDs within every meld, while whole-hand cross-location uniqueness remains enforced.
- Corrected verification: typecheck, lint, build, and 17 Vitest tests pass, including concealed/exposed kong acceptance and rejection of concealed chow/pung and repeated-ID pung/kong melds.

## Milestone 2 review round 2

- The same independent read-only reviewer verified both corrections and found no remaining critical, high, or medium issue.

## Milestone 2 checkpoint

- Commit `2310258` (`feat: implement mahjong hand validation`) was pushed to the private repository on branch `codex/mahjong-together`.

## Milestone 3 implementation

- Added a pure cloned-state transition function for dealer opening, automatic front draws, discards, self-draw wins, discard claim windows, chow/pung/exposed-kong resolution, concealed and added kongs, added-kong robbery, back-wall replacement draws, final-wall wins/draws, and hand completion.
- Pending discards and pending added kongs remain references to tiles in one owning location until resolution. Accepted claims transfer the physical tile exactly once. Competing claims resolve by win → kong/pung → chow and then clockwise distance, independently of response arrival order.
- Every discard opportunity and claim/robbery window receives its own decision ID. Wrong-seat, stale, duplicate, wrong-phase, missing-tile, illegal-win, illegal-claim, and illegal-kong requests return typed rejections without mutating the input state.
- Added invariant checks after every tested accepted and rejected transition: all 136 physical IDs occur once, every type occurs four times, and concealed-hand sizes match the phase while treating a kong as one declared set. Phase construction now copies only common hand fields so stale discard-only properties cannot survive into claim windows or a chow/pung turn.
- Verification before independent review: strict typecheck, lint, and production build pass. Vitest passes 4 files and 32 tests, including claim arrival orders and passes, exact chow choices, all three kong forms, robbery, front/back draws, final-wall win/draw behavior, state purity, decision response immutability, and dealer rotation.

## Milestone 3 review round 1

- Confirmed medium: an accepted discard response retained the caller's mutable choice object by reference. Caller mutation after validation could therefore change a recorded pass/chow before the remaining responses resolved. Accepted choices are now canonicalized into fresh objects, including a fresh chow tile-ID tuple.
- Added a focused regression that mutates the submitted chow after acceptance and proves the stored response and eventual resolution remain unchanged.
- Corrected verification: typecheck, lint, build, and 33 Vitest tests pass.

## Milestone 3 review round 2

- The same independent read-only reviewer verified that accepted claim objects and nested chow tuples are detached from caller-owned input and found no remaining critical, high, or medium issue.

## Milestone 3 checkpoint

- Commit `603434c` (`feat: implement mahjong hand state machine`) was pushed to the private repository on branch `codex/mahjong-together`.

## Milestone 4 implementation

- Added 24-hour opaque guest sessions backed by 32 random bytes, with only SHA-256 token hashes retained in memory, HttpOnly/SameSite=Lax cookies, Secure cookies for the configured HTTPS origin, reuse on refresh, expiry pruning, and the 1,000-session capacity guard.
- Added cryptographically generated 12-character room codes, one-room-per-guest enforcement, 20-room capacity, first-free E/S/W/N seat assignment, duplicate-safe display names, ready/host/start controls, bot filling, explicit leave behavior, longest-present host transfer, and 30-minute empty/2-hour lobby/12-hour absolute expiry rules.
- Added same-origin mutation enforcement, 16 KiB JSON body limits, private no-store API responses, standard security/noindex headers, and viewer-specific lobby DTOs without guest credentials or ownership identifiers.
- Added the working home/invite/lobby interface with create, join, ready, start, refresh, copy/manual-copy, leave, useful errors, session-preserving refresh, and responsive 44px controls. It uses no background polling; live socket-driven updates are part of the reliable multiplayer protocol milestone.
- Verification before independent review: typecheck, lint, and build pass; Vitest passes 6 files and 44 tests; Chromium Playwright passes 3 tests covering two isolated guests plus bot start, four isolated duplicate-named guests retaining distinct seats across refresh, and a useful fifth-player rejection. Firefox remains deferred at the user's direction.

## Milestone 4 review round 1

- Confirmed medium: ready/start/leave/disconnect mutation paths did not check expiry first, so a mutation could revive a two-hour lobby; cleanup was also only lazy. Every public room operation now enforces expiry, and the server starts one unref'ed cleanup interval that is disposed when the HTTP server closes. Fake-clock tests cover mutation rejection, scheduled deletion, and timer disposal.
- Confirmed medium: manual refresh ignored a missing current room and left a stale lobby visible; the shared refresh path also lacked a distinct recovery state. The client now tracks prior occupancy, clears expired state and route data, presents an accessible `Room expired` screen with a return-home action, and handles `room-not-found` mutation responses the same way.
- Corrected verification: format, typecheck, lint, and build pass; Vitest passes 6 files and 46 tests; Chromium Playwright passes 4 tests, including the explicit expired-room recovery transition.

## Milestone 4 review round 2

- The same independent read-only reviewer verified both lifecycle corrections and found no remaining critical, high, or medium issue.

## Milestone 4 checkpoint

- Commit `325915e` (`feat: build guest room lobby`) was pushed to the private repository on branch `codex/mahjong-together`.

## Milestone 5 implementation

- Connected started rooms to real authoritative hand state and added a per-room sequential command queue so simultaneous commands are evaluated against one ordered state history.
- Added strict shared Zod command, acknowledgement, lobby acknowledgement, and recipient-specific game snapshot contracts. Game commands bind room, hand, decision, authenticated guest, action, and UUID command identity.
- Added session-lifetime HTTP replay handling and room-lifetime gameplay replay handling with payload-hash binding, bounded command counts, typed cached outcomes, and sliding request/command rate limits. Exact retries bypass the gameplay rate counter and cannot execute twice.
- Added Socket.IO guest authentication, configured-origin enforcement, a 16 KiB transport limit, latest-connection ownership, reconnect grace, room watching, live lobby invalidation, and viewer-specific game broadcasts. Same-origin browser polling handshakes are admitted only when their host and Fetch Metadata match the configured origin; explicit cross-origin requests remain rejected.
- Added recipient snapshot construction that omits wall order, other concealed hands, concealed-kong identities, and other players' private offers/responses while publishing only the viewer's legal actions. Completed hands reveal their result decomposition.
- Added a React server-state reducer/context and a retrying Socket.IO client that ignores stale room/game revisions and refreshes lobby state from server notifications.
- Verification before independent review: formatting, strict typecheck, lint, and production build pass; Vitest passes 9 files and 59 tests; Chromium Playwright passes all 4 lobby/production tests, including live four-guest fan-out. Firefox remains deferred at the user's direction.
- A Chromium trace exposed legitimate same-origin polling handshakes being rejected because browsers omit `Origin` on the initial same-origin GET. The fallback now requires the exact configured host plus `Sec-Fetch-Site: same-origin`; the focused preconnected-room socket test and full Chromium flow pass after correction.

## Milestone 5 review round 1

- Confirmed high: callback-less or wrong-callback Socket.IO packets could invoke a non-function acknowledgement and escape an event listener. Both handlers now runtime-check the callback and safely ignore malformed packets; integration coverage proves the connection and subsequent valid acknowledgement remain available.
- Confirmed medium: lobby room DTOs lacked a revision, so overlapping HTTP refreshes could apply an older lobby after a newer active-room response. Every room view now carries its authoritative revision, and the reducer compares room and game revisions before accepting a response; a controlled stale-response regression covers the transition.
- Confirmed medium: latest-tab ownership only disconnected the prior socket, while its shared-cookie HTTP lobby mutations remained authorized. Each tab now presents a random controller ID in its authenticated socket handshake and HTTP mutations; the session store records only the latest connected controller, and superseded-tab mutations receive a typed rejection. A two-socket/HTTP integration test proves the stale controller cannot mutate while the replacement can.
- Confirmed medium: repeating a UUID could bypass socket rate limits before payload-bound replay validation, disconnect cleanup reset the rate window, and malformed create/join attempts were not counted. Exact retry exemption now requires a room-cache payload match, histories survive reconnect, all malformed socket traffic counts, and invalid create/join bodies consume the same attempt budget. Focused regressions cover all three paths.
- Corrected verification: formatting, typecheck, lint, and production build pass; Vitest passes 10 files and 64 tests; Chromium Playwright passes all 4 tests. Firefox remains deferred at the user's direction.

## Milestone 5 review round 2

- The reviewer verified all four round-one corrections and found no remaining critical or high issue.
- Confirmed medium: clearing or changing rooms removed reducer ordering history, so a delayed old-room read could still resurrect a cleared room or replace a newer membership. The client now uses a monotonic request gate: every room read receives a generation, accepted room/clear outcomes invalidate outstanding reads, and create/join/leave transitions invalidate older membership work. Regressions cover delayed room-after-clear and old-room-after-new-room ordering.
- Confirmed medium: stale-hand/stale-decision acknowledgements did not include the required recovery view when a client had missed the advancing broadcast. The socket handler now emits a fresh recipient-specific snapshot after either authenticated stale rejection; integration coverage verifies the returned decision and revision match current authoritative state.
- Corrected verification: formatting, typecheck, lint, and production build pass; Vitest passes 11 files and 66 tests; Chromium Playwright passes all 4 tests. Firefox remains deferred at the user's direction.

## Milestone 5 review round 3

- The reviewer verified stale-command snapshot recovery plus the prior callback, controller, rate-limit, and same-room ordering corrections and found no remaining critical or high issue.
- Confirmed medium: the join component still performed one direct unguarded current-room fetch, allowing its delayed response to bypass the monotonic request gate. Join completion now calls the shared guarded `refreshRoom` path exclusively; no room response can run `acceptRoom` side effects without winning its request generation.
- The three-round milestone review cap was reached. The final correction was validated by a focused Chromium race that captures and delays the joined-room response, applies a newer null-room response, releases the stale response, and proves the join page and invite URL remain unchanged.
- Final corrected verification: formatting, typecheck, lint, and production build pass; Vitest passes 11 files and 66 tests; Chromium Playwright passes all 5 tests. Firefox remains deferred at the user's direction.

## Next exact step

Create and push the Milestone 5 checkpoint, then implement deterministic bots, action timers, reconnect takeover, and simulation coverage for Milestone 6.
