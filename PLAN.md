# Build plan

- [x] 1. Establish isolated repository, Ponytail guidance, exact toolchain, workspaces, repeatable commands, health route, production serving, review, and checkpoint commit.
- [x] 2. Implement physical tiles, crypto/injectable shuffle and deal, normal-hand decomposition, and seven-pairs validation.
- [x] 3. Implement and invariant-test the pure hand state machine, all claims and kongs, final-wall behavior, and dealer rotation.
- [x] 4. Implement guest sessions, private room lobby, seats, host transfer, readiness, capacity, expiry, and browser lobby flows.
- [x] 5. Implement reliable multiplayer queues, validation, decision IDs, acknowledgements/deduplication, private snapshots, origins, sizes, and rate limits.
- [x] 6. Implement deterministic bots, timeouts, disconnect takeover/rejoin, duplicate-tab control, restart behavior, and 100 simulations.
- [x] 7. Complete the responsive, accessible playable interface, local SVG tile art, help, reconnect, results, and rematches.
- [x] 8. Verify integrated two-human/two-bot play across desktop engines and mobile Chromium, including reconnect, claims, and rematch (Firefox deferred at the user's direction).
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
- [x] Let a selected tile be deselected by clicking it again, with an explicit pressed state for assistive technology.
- [x] Label every Chow selector option with its exact three-tile combination.
- [x] Reset readiness and release disconnected humans when a hand completes.
- [x] Let the host return a completed table to the lobby, clearing bot seats so friends can join before the next hand.
- [x] Release a host who disconnects on the results screen and transfer rematch and lobby controls to the next connected human.
- [x] Run the integrated two-human/two-bot table flow at desktop Chromium, iPad Pro 11 Chromium, and Safari-engine sizes, including a live table reload/reconnect.
- [x] Exercise the completed-hand rematch banner through a browser result flow before closing the cross-browser milestone.
- [x] Exercise an in-browser Chow choice with its exact selector labels and confirm the exposed meld reaches both human players.

## Future UX refinement backlog (captured 2026-09-06)

These are planned follow-up improvements from the latest player review. They are intentionally unchecked and do not change the completed gameplay milestone.

- [ ] Replace the persistent **How to play** disclosure with a circular question-mark icon button. Open the rules in a desktop popover or mobile bottom sheet, keep it closed by default, and provide an accessible name, keyboard focus handling, Escape-to-close, and a visible close action.
- [ ] Remove the visible **Hand starting · Mahjong table** heading during gameplay. Retain a visually hidden semantic heading if needed, and move only useful context (room code, seat, connection, wall count, and turn timer) into a compact utility bar.
- [ ] Rebalance the table composition so the felt has a stable aspect ratio and predictable footprint, uses less outer whitespace, and keeps the central discard pool visually dominant without stretching or collapsing between turns.
- [ ] Add a clear central empty state (for example, **Waiting for the first discard**) and a compact legend explaining discard ownership colors so the middle never feels unexplained or empty.
- [ ] Consolidate the local player card, hand rack, and legal actions into one bottom interaction dock. Keep the hand primary, show action buttons only when available, and reduce persistent drag/sort guidance to a compact affordance.
- [ ] Improve player-card hierarchy with prominent text status, a strong active border/glow, and a timer/progress treatment. Color remains a secondary cue and is never the only way to identify the active player.
- [ ] Keep end-of-hand opponent-hand inspection in an overlay or expandable panel so revealing hands does not resize the table or push the local hand and controls out of view.
- [ ] Verify the revised hierarchy at 1440×900, iPad Pro 11, 390×844, and 844×390. The normal turn must fit without page scrolling; only intentionally long hand/discard collections may scroll inside their own regions.
