# Progress and evidence

## Current milestone

Milestone 7 — Build the responsive, accessible playable mahjong table.

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

## Milestone 6 implementation

- Added a deterministic information-limited bot policy: bots choose legal wins, pass non-winning claims, and discard by an explicit keep-score with stable type/physical-ID tie breaks.
- Added per-room serialized deadline automation: 30-second discards, 10-second discard claims and added-kong robbery, absolute server deadlines, timeout discards, automatic passes, and stale timer guards.
- Added disconnect takeover and reconnect cancellation for active human seats; disconnected humans remain the seat owner while a bot controls their actions. If every human disconnects, scheduled bots continue until hand completion.
- Added deterministic bot-policy tests, a 100-seed all-bot transition simulation with physical-tile/phase invariants, deadline boundary tests, claim timeout coverage, reconnect cancellation, and all-human-disconnect completion coverage.
- Verification after implementation: formatting, strict typecheck, lint, production build, 77 Vitest tests, and the default Chromium Playwright suite pass. Firefox remains deferred at the user's direction.

## Milestone 6 checkpoint

- Independent review was requested twice but could not run because the reviewer agent exhausted its usage limit. Local review and all available automated verification were completed.
- Checkpoint commit `a977c28` (`feat: add bots and disconnect recovery`) was pushed to the private repository on branch `codex/mahjong-together`.

## Milestone 7 implementation in progress

- The active task is now explicitly updated to create the actual playable interface requested by the user: a real table view, visible local SVG tile art, hand selection/discard controls, claim/win/kong actions, server deadline display, reconnect/controller status, and hand results.
- The table is responsive down to narrow mobile widths, uses 44px-or-larger controls, keeps opponent concealed tiles private, exposes a native keyboard-accessible help panel, and renders public discards/meld context plus the current wall count.
- Added a Chromium end-to-end flow that starts a hand with bots, verifies 14 visible tile faces, selects a tile, enables the discard action, sends it through the live Socket.IO command path, and confirms the table remains synchronized.
- Verification: formatting, strict typecheck, lint, production build, 82 Vitest tests, and all 6 Chromium Playwright flows pass. Firefox remains deferred at the user's direction.

## Milestone 7 feedback integrated

- Added native SVG hover titles containing each tile's name and numeric value, with matching accessible labels.
- Reworked the felt into a four-sided board: East/South/West/North each have a positioned player card, while one central discard pool contains all public discards.
- Expanded gameplay to full viewport width and height on desktop; mobile keeps a readable content-sized scroll layout. The browser regression now checks the table fills the viewport.
- Rotated seat placement relative to the viewer so the viewer's player card and complete hand rack always occupy the lower side; side seats no longer constrain the hand to a narrow right column.
- Added cryptographically random 1–5 second bot cooldowns, clamped and injectable for deterministic scheduler tests.
- Player cards now show public exposed meld groups with tile faces and Pung/Chow/Kong labels; concealed opponent meld identities remain hidden.
- Own tiles are draggable/reorderable in a full-width rack, with stable local ordering as authoritative snapshots add or remove tiles.
- Added seat-specific card colors and authoritative `activeSeat`/`waitingSeats` snapshot fields so every card clearly indicates playing, waiting for discard/claim, observing, or ended state.
- Added a results-only “Show other hands” option; the server already reveals concealed hands only in `hand-ended` snapshots, and a regression verifies that boundary.
- Added regression assertions for four seat cards, centralized discards, no per-player discard strips, and value-bearing tile labels.
- Refined the end-of-hand reveal so the viewer's own lower rack remains the single source of their tiles; “Show other hands” now affects opponents only.
- Added a deterministic `Sort hand` button using Mahjong tile order with stable physical-tile tie breaks, clearing the current selection after sorting.
- Added a visible “Drag tiles to reorder” hint and a subtle grip affordance on each draggable tile while preserving native drag behavior.
- Tightened the desktop felt to a centered, compact board and enlarged opponent card/tile proportions so end-of-hand hands are easier to inspect without changing the full-screen shell.
- Revealed opponent concealed tiles are now sorted by Mahjong type with stable physical-tile ID tie breaks; the viewer's lower rack behavior is unchanged.
- Fixed active-table leave to execute the server leave mutation before returning home, releasing the guest for immediate room creation.
- Added a host-only `Play again` control on the result banner; rematches create a fresh hand and rotate the dealer while preserving the room and seats.
- Added regressions for active-hand leave/new-room recovery and server-side rematch behavior.
- Consolidated multiple legal Chow combinations into one visible Chow button plus an accessible combination selector, removing duplicate Chow actions without losing choice.
- Added an enabled-by-default host auto-rematch countdown that starts the next hand after 15 seconds; the result banner includes an opt-out checkbox and manual Play again control.
- Expanded the desktop/tablet felt sizing while keeping the narrow mobile layout content-sized.
- Added an in-flight leave guard to prevent duplicate leave requests during the transition back to the home screen.
- Tile selection is now a true toggle: selecting the same tile again deselects it, updates the discard control, and exposes the state through `aria-pressed`.
- Chow selectors now name the exact three-tile sequence rather than anonymous option numbers, retaining every legal combination without duplicated generic buttons.
- Completed hands now reset connected players' ready state and release disconnected human seats before either a rematch or a lobby return.
- The results view now offers the host a `Return to lobby` action, clearing bot seats and restoring the ready/start lobby workflow; server coverage proves the reset.
- A post-results host disconnect now releases that guest from the room and transfers the result controls to the next connected human, preventing stale room membership from blocking a later table.

## Milestone 7 lifecycle review

- Independent re-review found no remaining critical, high, or medium issue in the result lifecycle, rematch countdown, return-to-lobby route, Chow selector, or tile-selection accessibility.
- The review confirmed that rematch timer cancellation and the shared mutation latch prevent manual/automatic start races; completed-table disconnects transfer host controls without preserving stale membership.
- Verification after correction: formatting, strict typecheck, lint, production build, 82 Vitest tests, and all 6 Chromium Playwright flows pass. Firefox remains deferred at the user's direction.

## Milestone 8 verification

- Added a named iPad Pro 11 Chromium project and reproducible tablet/WebKit test commands. The responsive two-human/two-bot table flow now reloads the active host page and verifies that the same private hand reconnects with all 14 viewer tiles.
- All six browser flows pass in desktop Chromium and iPad Pro 11 Chromium. The same six flows pass in the Safari-engine WebKit project; refresh actions are asserted through the resulting same-origin request to avoid a Windows WebKit pointer-completion stall after synchronization.
- Added a separate result-flow Playwright configuration backed by a test-only server entrypoint. It injects completed draw hands, confirms that opting out prevents any rematch for more than 15 seconds, then starts the next real hand manually; it also proves the enabled-by-default timer does not fire early and sends exactly one automatic rematch request without an error. The fixture is test-suite code only: production server startup never imports it and no cheat route exists.
- Added a separate claim-flow Playwright configuration with a controlled real hand that gives the joining human exactly three Chow choices. The browser test proves the UI renders one Chow button, labels every sequence exactly, resolves the selected middle Chow, and exposes its three tiles to both the claimant and host. This is test-suite-only startup injection, not a production route or runtime flag.
- The claim-flow review initially found that the test counted an exposed Chow without proving the selected combination was committed. The corrected test now checks the exact `2 of dots`, `4 of dots`, and discarded `3 of dots` accessible labels on both clients. The independent correction re-review found no remaining critical, high, or medium issue.
- Firefox has not been installed or run during this verification pass, as requested.

## Deployment readiness check

- Render is signed in to the Hobby workspace with no card, no pending charges, zero used free-instance hours, and 750 included free-instance hours. The account page also states that usage beyond included limits is chargeable, so a hard zero-spend guarantee was not available to verify.
- No service was created and no source access was granted. The ready-to-configure Web Service page requires a GitHub OAuth connection before the private repository can be selected; its setup tab is preserved for an explicit user decision.

## Milestone 8 result-flow review

- The first independent review found that the initial result test did not establish the full 15-second lower bound, prove that opting out cancelled rematch, or rule out duplicate start requests. The corrected browser tests keep the opt-out result visible for 16 seconds with zero rematch requests, and retain the automatic result at 14 seconds before confirming exactly one successful rematch and no error alert.
- The required corrected re-review found no remaining critical, high, or medium issue. It confirmed that the fixture uses the real app, Socket.IO, HTTP routes, and built client while remaining unimported by production startup and exposing no test endpoint.
- Verification: format, lint, strict typecheck, production build, and all 82 unit/integration tests pass. Default Chromium has 6 passing flows; iPad Pro 11 Chromium has 6; the Safari-engine active-table flow passes; the dedicated result suite has 2 passing Chromium flows; and the dedicated Chow-claim suite has 1 passing Chromium flow. Firefox remains intentionally deferred.

## Milestone 9 stabilization and final-review corrections

- Added the visible **Upgrade Pung to Kong** action for every legal added-Kong option, with a focused built-app Socket.IO browser flow. The test fixture deliberately gives no opponent a rob-the-Kong win, so it proves the resulting exposed four-tile Kong.
- Result banners now identify the dealer and render the complete physical winning decomposition (pair plus all sets, or seven pairs), not merely the win source. The dedicated result fixture verifies the full presentation.
- Dealer state is now part of the validated game snapshot. The dealer advances exactly once per finished hand and remains correct if the host returns to the lobby before starting the next hand.
- Corrected active-room recovery: ordinary invite links stay on the join screen for a new guest, while a room the current guest had occupied is safely cleared after a server restart or expiry. A stale marker for a different invite is discarded rather than blocking that invite. A restart integration test verifies the new process has no stale room state.
- Latest-tab control now has an explicit **Take control here** path. The old socket is disconnected and rejected on automatic reconnection once a newer tab takes control; the replacement keeps control. HTTP and Socket.IO coverage exercise the controller race.
- Production startup now requires an explicit secure external `APP_ORIGIN`, ensuring cookie security and origin checks cannot silently be disabled by an incomplete deployment configuration.
- Added reconnect regressions during an open discard-claim and an open added-Kong robbery decision. Reconnecting before the bot acts preserves the exact decision and deadline.
- Moved the visual table to the required pale neutral surface while retaining distinctive, higher-contrast colored player cards. The full-size PC/tablet board and lower local hand remain unchanged.
- Added exact 390×844 portrait and 844×390 landscape Chromium projects, including keyboard selection and reachable discard controls. The all-browser command includes the isolated claim, Kong, result, and winning-hand fixtures, but is intentionally not run while Firefox remains deferred.

## Final verification after stabilization

- `npm run format`, `npm run lint`, strict `npm run typecheck`, production `npm run build`, and `npm test` pass; Vitest reports 13 files and 89 tests.
- Chromium desktop passes all eight standard page/lobby flows. Chromium phone portrait and landscape pass all sixteen standard flows across the exact required viewports. iPad Pro 11 Chromium passes all eight standard flows.
- WebKit passes all eight standard flows. Its isolated-guest multi-context test receives a documented 60-second allowance for the Windows WebKit engine and completed in 29 seconds; native drag is still asserted in Chromium, while WebKit verifies the keyboard/click interaction path.
- Isolated Chromium flows pass for Chow claims, added-Kong upgrade, winning decomposition, opt-out/manual rematch, and default 15-second auto-rematch. Firefox was not installed or run, as requested.

## Next exact step

The implementation and local verification are complete. Public deployment remains deliberately incomplete: connecting the private GitHub repository would grant Render OAuth access, and the Render Hobby account cannot guarantee a zero-spend hard cap because overage can be billable. Deployment requires the user's explicit decision on that OAuth access and overage policy; Firefox remains deferred.
