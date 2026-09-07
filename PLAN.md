# Build plan

## Current priority (2026-09-07)

Visual-design and UX refinement are the active priorities. Public deployment is intentionally deferred: after the design direction and plan are complete, the user will manually configure Render. Do not start a Render service, request provider access, or perform public-service verification during the current refinement work.

- [x] Complete the visual-direction and UX-refinement work below.
- [x] Verify the completed experience across the required viewports and assistive paths.
- [x] Preserve the deployment configuration for the user's later manual setup in `DEPLOYMENT.md`.
- [ ] Resume public-service verification only after the user provides a deployed URL.

- [x] 1. Establish isolated repository, Ponytail guidance, exact toolchain, workspaces, repeatable commands, health route, production serving, review, and checkpoint commit.
- [x] 2. Implement physical tiles, crypto/injectable shuffle and deal, normal-hand decomposition, and seven-pairs validation.
- [x] 3. Implement and invariant-test the pure hand state machine, all claims and kongs, final-wall behavior, and dealer rotation.
- [x] 4. Implement guest sessions, private room lobby, seats, host transfer, readiness, capacity, expiry, and browser lobby flows.
- [x] 5. Implement reliable multiplayer queues, validation, decision IDs, acknowledgements/deduplication, private snapshots, origins, sizes, and rate limits.
- [x] 6. Implement deterministic bots, timeouts, disconnect takeover/rejoin, duplicate-tab control, restart behavior, and 100 simulations.
- [x] 7. Complete the responsive, accessible playable interface, local SVG tile art, help, reconnect, results, and rematches.
- [x] 8. Verify integrated two-human/two-bot play across desktop engines and mobile Chromium, including reconnect, claims, and rematch (Firefox deferred at the user's direction).

## Milestone 7 UI refinement feedback

- [x] Show each tile's name and value on hover (and retain the same label for keyboard/screen-reader access).
- [x] Keep every player's discarded tiles in one central discard pool in the middle of the table; do not repeat them inside player cards.
- [x] Present a four-sided table layout with one player card on each side, preserving a readable single-column mobile fallback.
- [x] Make the gameplay table occupy the full viewport on desktop, with a content-sized mobile fallback.
- [x] Anchor the viewer's player card and full hand rack to the lower side of the table, rotating the other seats relative to the viewer.
- [x] Add a randomized 1–5 second bot action cooldown, with an injectable clock/scheduler test path.
- [x] Render every player's exposed Pung and Chow melds (and exposed Kongs) publicly on their player card.
- [x] Let players drag and reorder their own concealed tiles while preserving that local order through live updates.
- [x] Color player cards by seat, highlight the active discard player, and label waiting/observing seats.
- [x] Add a results-view option to reveal the other players' concealed hands only after hand completion.
- [x] Keep the viewer's hand in one lower rack; the results toggle reveals opponents only, never a duplicate viewer hand.
- [x] Add a deterministic Sort hand control for the viewer's concealed tiles.
- [x] Keep a concise drag-to-reorder hint beside the hand controls without adding a grip control to every tile.
- [x] Keep the felt compact within the full-screen shell while giving opponent cards more room for inspection.
- [x] Sort revealed opponent concealed tiles by Mahjong type and stable physical-tile ID at hand end.
- [x] Make leaving an active hand release the guest session so a new room can be created immediately.
- [x] Add a host-only Play again action that starts a fresh hand after hand completion.
- [x] Collapse multiple legal Chow combinations into one Chow action with an explicit option selector.
- [x] Offer host auto-rematch after a 15-second countdown, with a checkbox to opt out.
- [x] Make the board use more tablet/desktop space while retaining the mobile fallback.
- [x] Guard leave mutations against duplicate clicks and preserve immediate new-room creation.
- [x] Let a selected tile be deselected by clicking it again, with an explicit pressed state for assistive technology.
- [x] Label every Chow selector option with its exact three-tile combination.
- [x] Reset readiness and release disconnected humans when a hand completes.
- [x] Let the host return a completed table to the lobby, clearing bot seats so friends can join before the next hand.
- [x] Release a host who disconnects on the results screen and transfer rematch and lobby controls to the next connected human.
- [x] Run the integrated two-human/two-bot table flow at desktop Chromium, iPad Pro 11 Chromium, and Safari-engine sizes, including a live table reload/reconnect.
- [x] Exercise the completed-hand rematch dialog through a browser result flow before closing the cross-browser milestone.
- [x] Exercise an in-browser Chow choice with its exact selector labels and confirm the exposed meld reaches both human players.
- [x] Add a persisted light/dark theme toggle with system-preference fallback and readable contrast across landing, lobby, table, tiles, results, and status surfaces.

## Supplied visual direction integration (captured 2026-09-07)

The attached HTML concepts and design-system note are recorded in [DESIGN.md](./DESIGN.md). Their visual principles are planned follow-up work; their external fonts, Unicode glyph implementation, audio, and demo scripts are explicitly out of scope.

- [x] Rework the gameplay surface toward one continuous felt plane with restrained wood HUD/rack framing, a scarce brass hierarchy accent, and dark-mode equivalents that preserve contrast.
- [x] Refine tile rendering as a physical object: consistent ivory bevel/depth, distinct woven back, perspective-preserving selected state, separated drawn tile, and stable small/medium/large proportions using the existing local SVG assets.
- [x] Refine spatial hierarchy into top/side opponents, physical wall treatment, central discard pond, and lower local rack/action dock. Keep the pond stable, explain its empty state, and retain an owner-color legend.
- [x] Add a readable latest public-action cue and an accessible live-region announcement. Use restrained origin-to-pond discard motion and an active-seat timer/glow that remain clear with reduced motion disabled.
- [x] Replace the moving winner treatment with a calm result dialog that uses the landing material, shows the winner and winning hand, and keeps rematch and opponent-hand controls together.
- [x] Apply the landing reference selectively: wood frame, felt hero, one oversized tile gesture, ivory material/suit accents, and brass CTA hierarchy, while keeping create/join as the primary first-viewport workflow.
- [x] Verify the material, hierarchy, dark mode, keyboard/touch reachability, and normal-turn no-scroll behavior at 1440×900, iPad Pro 11, 390×844, and 844×390.
- [x] Preserve exposed melds in a compact, horizontally scrollable strip at both phone orientations, with readable text summaries of the tile names; never hide public Chow, Pung, or Kong information to save space.
- [x] Make rules and end-hand inspection true keyboard dialogs: mount above the application surface, make background controls inert, contain Tab focus, support Escape, and restore the owning control on close.
- [x] Keep every interactive control at least 44×44 CSS pixels at touch breakpoints. Compress tile artwork and permit only intentional internal scrolling rather than shrinking targets.
- [x] Support hand reordering with mouse drag and a touch hold-then-tap placement pattern. Keep Sort hand and a concise visible affordance, but remove per-tile grip chrome and adjacent left/right movement buttons while preserving normal phone rack panning.

## Original visual refinement review gate (2026-09-07)

- [x] The original independent corrected re-review found no unresolved critical, high, or medium issue in the prior grip-based ordering implementation. The later landing-and-table feedback superseded that ordering mechanism; its current acceptance criteria are recorded below.

## Latest landing and table feedback (2026-09-07)

- [x] Use the landing page’s wood-backed ivory color tone for the private room lobby, including its dark-mode equivalent, so the invitation flow feels continuous.
- [x] Rebalance the landing page so the Mahjong tile is a compact title emblem and the equal create/join entry lanes—with full-width, 52px-or-taller controls—carry the visual hierarchy.
- [x] Give the dark landing card its own high-contrast material surface rather than inheriting a light ivory treatment.
- [x] Give light-mode player cards distinct seat-tinted fills with dark readable text and metadata.
- [x] Replace reconnect/controller prose in player cards with an accessible bot icon only when a bot controls that seat.
- [x] Remove left/right tile movement controls and the per-tile three-dot grip. Keep Sort hand, desktop mouse dragging, touch hold-then-tap placement, and a concise hint.
- [x] Add a landing-page **Join a lobby** section that validates a 12-character invite code and opens the existing private invitation flow.
- [x] Add browser checks for dark landing and light player-card contrast, private lobby-code entry, bot icons, removed ordering chrome, and touch hold-then-tap ordering.
- [x] Resolve the corrected review’s phone-scroll finding. The re-review found no unresolved critical, high, or medium issue in the landing, player-card, or revised ordering changes.
- [x] Let a player who has entered a nickname move their own membership between open seats directly from the lobby, reset readiness after movement, and reject occupied or active-hand targets without changing membership.

## Room lifecycle and result-dialog feedback (2026-09-07)

- [x] Remove a room immediately when its final human player leaves, without leaving a stale membership that blocks a new room.
- [x] Give a completed room one server-owned three-minute rematch window. Expire it on time even after a lobby return, and cancel the expiry only when a valid next hand starts.
- [x] Move the gameplay light/dark switch into the table header, leaving it fixed only on non-game screens.
- [x] Replace the moving colored winner trails with a calm, landing-material result dialog containing the winner/draw state, winning hand, Play again, auto-play, other-hands, close, and room-expiry controls.
- [x] Preserve keyboard dialog behavior: the result dialog traps focus, supports Escape and explicit close, restores its trigger, and can be reopened through **View result**.

## Future UX refinement backlog (captured 2026-09-06)

These player-review improvements were resolved as part of the completed visual refinement. They remain here as acceptance history for later changes.

- [x] Replace the persistent **How to play** disclosure with a circular question-mark icon button. Open the rules in a desktop popover or mobile bottom sheet, keep it closed by default, and provide an accessible name, keyboard focus handling, Escape-to-close, and a visible close action.
- [x] Remove the visible **Hand starting · Mahjong table** heading during gameplay. Retain a visually hidden semantic heading if needed, and move only useful context (room code, seat, connection, wall count, and turn timer) into a compact utility bar.
- [x] Rebalance the table composition so the felt has a stable aspect ratio and predictable footprint, uses less outer whitespace, and keeps the central discard pool visually dominant without stretching or collapsing between turns.
- [x] Add a clear central empty state (for example, **Waiting for the first discard**) and a compact legend explaining discard ownership colors so the middle never feels unexplained or empty.
- [x] Consolidate the local player card, hand rack, and legal actions into one bottom interaction dock. Keep the hand primary, show action buttons only when available, and reduce persistent drag/sort guidance to a compact affordance.
- [x] Improve player-card hierarchy with prominent text status, a strong active border/glow, and a timer/progress treatment. Color remains a secondary cue and is never the only way to identify the active player.
- [x] Make turn ownership immediately legible with a persistent text label, high-contrast animated active-seat treatment, and a short public action cue such as **West discarded 5 of bamboo**. Animate a discard from the player edge into the central pool, keep the latest action visible long enough to read, and provide an equivalent live-region announcement; disable motion under `prefers-reduced-motion`.
- [x] Present a calm, readable result dialog when a hand ends. Name the winner, show the winning hand, keep controls usable, and avoid decorative moving trails that obscure the result or controls.
- [x] Keep end-of-hand opponent-hand inspection in an overlay or expandable panel so revealing hands does not resize the table or push the local hand and controls out of view.
- [x] Verify the revised hierarchy at 1440×900, iPad Pro 11, 390×844, and 844×390. The normal turn must fit without page scrolling; only intentionally long hand/discard collections may scroll inside their own regions.

## Newly reported lobby feedback (2026-09-07)

- [x] Fix the completed-hand invite bug: a guest currently receives **This hand has already started** because `join` accepts only `lobby` rooms. During the three-minute `hand-ended` window, allow a valid invite to atomically replace an open/bot seat, reset the new guest’s readiness, and preserve private-hand visibility rules.
- [x] Add an explicit lobby seat picker for East, South, West, and North. Show only available seats, keep first-free E/S/W/N as the no-preference fallback, and reject a simultaneous claim without changing either player’s membership.
- [x] Verify host disconnect after results in two-human browser coverage: confirm the server transfers host to the longest-present connected human, does not auto-start by itself, and that the transferred host’s enabled auto-play starts exactly one rematch after 15 seconds with the correct rotated dealer.

## Newly reported gameplay and responsive UI feedback (2026-09-07)

- [x] Fix Kong visibility during play: exposed Kongs must be rendered as public four-tile melds for every player, while concealed-Kong identities remain face-down to opponents until the hand ends; add regression coverage for both cases and for the final reveal.
- [x] Fix the end-of-hand opponent-hand inspection control becoming unresponsive after a rematch starts. Clear stale result-dialog/inspection state on every `handId` transition, keep the control bound to the active result hand, and verify it can be opened and closed again after starting a new hand.
- [x] Add a compact responsive top navigation/menu for mobile gameplay. Move settings, light/dark mode, How to play (question-mark action), connection status, and Leave game into the top menu; remove the bottom navigation/status bar and its Leave game action, preserve accessible 44px controls, and verify the table remains usable without page-level scrolling at 390×844 and 844×390.
- [x] Simplify table activity to a public action feed: show only the discarded tile and meaningful player actions (Pung, Chow/Chuw, or Kong). Remove unrelated status chatter and keep the feed accessible without exposing private hand information.
- [x] Keep the central discard pond in chronological play order rather than grouping or sorting tiles by player. The newest discard must remain identifiable as the latest action, while older tiles preserve the sequence in which they were discarded.
- [x] Remove visible tile-name text from the public Pung, Chow/Chuw, and Kong melds. Show the tile faces only (retain non-visible accessible labels where needed), and verify the compact melds remain identifiable for every player.
- [x] Change turn progression to a consistent counter-clockwise seat sequence. Apply the same order to normal draws, discard claims, active-player indicators, timers, and dealer rotation, and add a full-loop regression test for the four seats.

## Newly reported Kong visibility bug (2026-09-08)

- [x] Verify exposed Kong visibility for opponents: exposed Kongs are serialized with their tiles for both the owner and opponents, while concealed Kongs remain face-down to opponents. Regression coverage now checks both owner/opponent snapshots and the live browser flow.
