# Build plan

- [x] 1. Establish isolated repository, Ponytail guidance, exact toolchain, workspaces, repeatable commands, health route, production serving, review, and checkpoint commit.
- [x] 2. Implement physical tiles, crypto/injectable shuffle and deal, normal-hand decomposition, and seven-pairs validation.
- [x] 3. Implement and invariant-test the pure hand state machine, all claims and kongs, final-wall behavior, and dealer rotation.
- [x] 4. Implement guest sessions, private room lobby, seats, host transfer, readiness, capacity, expiry, and browser lobby flows.
- [x] 5. Implement reliable multiplayer queues, validation, decision IDs, acknowledgements/deduplication, private snapshots, origins, sizes, and rate limits.
- [x] 6. Implement deterministic bots, timeouts, disconnect takeover/rejoin, duplicate-tab control, restart behavior, and 100 simulations.
- [ ] 7. Complete the responsive, accessible playable interface, local SVG tile art, help, reconnect, results, and rematches.
- [ ] 8. Verify integrated two-human/two-bot play across desktop engines and mobile Chromium, including reconnect and rematch.
- [ ] 9. Create the private GitHub repository and one zero-spend Render Free service; verify the public page, health, sockets, invite deep links, reconnect, and hand/rematch.
- [ ] 10. Complete three specialist final reviews and corrected re-review, release commit, and user handoff; leave the branch unmerged.

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
- [x] Add a visible drag-to-reorder hint and tile grip affordance beside the hand controls.
- [x] Keep the felt compact within the full-screen shell while giving opponent cards more room for inspection.
- [x] Sort revealed opponent concealed tiles by Mahjong type and stable physical-tile ID at hand end.
- [x] Make leaving an active hand release the guest session so a new room can be created immediately.
- [x] Add a host-only Play again action that starts a fresh hand after hand completion.
- [x] Collapse multiple legal Chow combinations into one Chow action with an explicit option selector.
- [x] Offer host auto-rematch after a 15-second countdown, with a checkbox to opt out.
- [x] Make the board use more tablet/desktop space while retaining the mobile fallback.
- [x] Guard leave mutations against duplicate clicks and preserve immediate new-room creation.
