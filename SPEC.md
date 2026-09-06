# Mahjong Together — autonomous build prompt

Set a goal to build, test, and publicly deploy the Mahjong Together web game described below. Treat this document as the implementation specification. Deliver a working game, not a mockup or a plan.

## Fixed decisions — read before implementation

### Product and scope

- Name: Mahjong Together. Language: English. A private, casual game for friends, with four seats and simple Chinese house rules. Label the rules as house rules, not an official tournament variant.
- Two friends can play with two bots. Support one to four human players; fill empty seats with bots when a hand starts. Additional humans may replace empty/bot slots in the lobby between hands, never join an active hand except to reclaim their own disconnected seat.
- No scoring, points, money, gambling, leaderboard, accounts, matchmaking, spectators, text chat, voice chat, or AI API integrations. A hand ends with one winner or a draw.
- Include private invite links, nicknames, ready/start controls, legal-action guidance, reconnecting, basic bots, rules/help, and rematches.
- Presentation: English interface, clean light theme, flat ivory tiles with dark markings, off-white page background, pale neutral table, and blue controls/highlights. Minimal 150 ms selection/movement transitions, disabled under reduced-motion preferences. No sound, music, 3D, or elaborate animations. Support desktop and phone, both phone orientations. Use system fonts and locally bundled assets; do not depend on external fonts or mahjong Unicode glyphs rendering correctly.
- Hosting: one Render Free Node web service serves the website, HTTP endpoints, and multiplayer connections. Use the provider-generated HTTPS address. The total paid-service budget is zero. Use existing user-provided GitHub and Render accounts and supported authenticated access; the builder cannot supply accounts or pay for them. No paid upgrades, domains, databases, add-ons, or keep-awake monitoring services. Startup delays, provider quotas, and games ending on server restart are accepted limitations. Provider references: [Render Free limitations](https://render.com/docs/free) and [WebSocket hosting](https://render.com/docs/websocket).
- Timing: 30 seconds for each human discard opportunity and 10 seconds for each discard-claim or kong-robbery window. Use absolute server deadlines, not client timers. On a human discard timeout, auto-discard the just-drawn tile if still held; following chow/pung, discard the highest tile-type/physical-ID remaining tile. Never auto-declare a human win or kong. On claim timeout, unanswered seats pass. Resolve early only after all eligible seats respond. A valid committed kong and its replacement draw start a new 30-second discard opportunity; a rejected request never resets a deadline.
- Disconnections: keep play running and let the fixed bot policy control a seat as soon as the server detects its disconnection. Use Socket.IO pingInterval=10000 and pingTimeout=10000. A pending bot action runs after a cryptographically random 1–5 second cooldown, bounded by the current decision deadline; existing human deadlines do not restart. A returning guest cancels uncommitted bot actions for their seat and resumes the currently available decision with the remaining time. Already-submitted claims remain submitted. If no decision is available, resume control at the next decision. If the deadline has passed, resolve it before accepting a returning player's move. After all humans disconnect, finish the current hand with bots, but never auto-start another hand.
- The initial release is a casual hobby service, with capacity and availability limits documented. Do not promise continuous availability or recovery after a server restart. Configure available provider spending controls to prevent billable overages. If an existing account's billing configuration cannot guarantee the zero-spend requirement without changing unrelated services, leave deployment blocked and report that exact issue; do not silently accept billable usage.

### Technology and structure

- Use Node.js 24 LTS, npm workspaces, TypeScript in strict mode, React, Vite, plain CSS, locally bundled SVG tiles, Express, and Socket.IO 4.x. Use Vitest for unit/integration tests and Playwright for browser tests. Use Zod for request validation. Use ESLint and Prettier for code checks and formatting. Node 24 is an LTS release as verified on September 5, 2026: [Node release schedule](https://nodejs.org/en/about/previous-releases).
- At initialization, resolve stable releases compatible with Node 24 and one another; exclude prereleases. Save exact direct dependency versions, commit one package-lock.json, and use npm ci after initialization. Record the resolved versions; do not upgrade working dependencies during the build without a concrete blocker.
- Create or resume this game's project in a mahjong-together subdirectory of the assigned workspace. If that directory already contains an unrelated project, use the first available mahjong-together-2, mahjong-together-3, etc. Inside it, use apps/web, apps/server, and packages/shared. Put the pure rules engine in apps/server/src/game; shared contains public DTOs, tile definitions, and protocol schemas only. Bots run on the server and receive a restricted player view. Keep full server state out of browser imports.
- Run one server process and one hosting instance. Express serves the built frontend and Socket.IO from the same origin in production. During development, Vite proxies /api and /socket.io to the server. Bind the production server to 0.0.0.0 and process.env.PORT. Use ES modules throughout.
- Keep rooms and guest sessions in memory. Do not add a database, Redis, persistent disk, Docker, a second hosting service, or horizontal scaling for this version. Browser/network reconnection is supported while the process lives; process restarts end existing games. Show an honest room-expired message with a route back to the home screen.
- Use a React context/reducer for the latest server view plus local interface state. No Redux, external state library, game engine, canvas renderer, Three.js, or drag-and-drop dependency. Separate rendering and animations from game rules.
- Use server-issued opaque guest identity in an HttpOnly cookie, SameSite=Lax and Secure in production. Generate 32 random bytes per session token. Session lifetime is 24 hours. Never put guest credentials in invite URLs, browser-readable storage, logs, or source code.
- Cap guest sessions at 1,000; remove expired entries before enforcing the cap. Return a useful capacity error instead of evicting an active guest. Keep only the session-token hash in server memory. A server restart invalidates sessions; establish a fresh guest and show room expiration when a previously joined room no longer exists.
- Use POST /api/session to establish a guest before connecting Socket.IO; reuse an existing valid cookie rather than allocating another session on every refresh. Derive identity from the validated session, never from a client-supplied player ID or socket.id. On a second connection for the same guest, the newest connection takes control and the old one becomes inactive with a clear message. Connection replacement must not briefly trigger a false player disconnect. Explicitly disconnect the superseded socket and stop its automatic reconnect attempts; offer a manual Take control here button. Never let two browser tabs repeatedly take control back from each other automatically.
- Invite URLs use /room/<code>. Generate 12-character cryptographically random lowercase alphanumeric codes with collision checking. The invitation is shareable room access; seat ownership still requires the guest session. Names are trimmed, 1–20 characters, rendered as text, and are display labels rather than credentials.
- Limit the service to 20 simultaneous rooms, four seats per room, and one room per guest. Reject excess capacity with a useful message. Expire empty rooms after 30 minutes without a connected human, inactive lobbies after two hours, and all rooms after 12 hours. Use the server clock and clean up associated timers. Announce room expiration in the interface when connected.
- Lobby creator is host. If that host leaves or disconnects in the lobby, transfer host controls to the longest-present connected human. Only the host starts a hand, after all connected humans are ready. Bots count as ready. Reset readiness after each hand.
- Seat allocation uses the first free seat in E/S/W/N order. A human leaving or disconnecting in the lobby releases their seat; disconnection during a hand reserves their seat for rejoining for that hand. At hand end, release disconnected human seats and transfer host to the longest-present connected human if needed. Keep connected humans in their seats for the next hand. From results, the host can return everyone to the lobby, where more friends may join before the next start.
- An explicit Leave game action during a hand requires one interface confirmation, forfeits that guest's seat for the hand, assigns a bot, and releases the guest to join another room. This is different from a network disconnect. The forfeited seat cannot accept a new human until the lobby. A host who explicitly leaves transfers host ownership to the longest-present remaining human; if none remain, finish with bots and expire the room under the stated lifecycle rules.
- Development commands are npm run dev, npm run build, npm start, npm run typecheck, npm run lint, npm test, and npm run test:e2e. Use cross-platform scripts compatible with Windows and Linux. Build shared code before its consumers. /api/health returns a minimal 200 JSON status without game/session data; client-side room routes fall back to index.html, but unknown /api routes return JSON 404 errors.
- Use one new private GitHub repository named mahjong-together under the authenticated user's personal account; if occupied, use the first free numeric suffix starting at -2. The deployment target is one newly created Render Free service, using the same naming rule for collisions. Do not repurpose existing services. Select Frankfurt if offered for Free services; otherwise use the provider's default available region. Use manual deployments after the initial release, with automatic deployment disabled, so routine code pushes cannot restart ongoing games.
- Before publishing, inspect and exclude secrets, local credentials, build caches, node_modules, test traces, and personal files. Keep a .gitignore, .env.example with non-secret placeholders, README.md, RULES.md, DEPLOYMENT.md, render.yaml, and verification results. Source control the lockfile. The release uses npm ci && npm run build, npm start, NODE_ENV=production, a pinned supported Node 24 patch release, and an explicit APP_ORIGIN derived from the assigned Render URL. Do not invent account IDs or URLs.

### Exact house rules

- Use 136 physical tiles: four copies of each of the 34 tile types. Types are dots 1–9, bamboo 1–9, characters 1–9, East/South/West/North winds, and red/green/white dragons. No flowers, seasons, or jokers. Every physical copy has a unique server identity.
- Seat positions are labelled East, South, West, North. Turn order is E → S → W → N → E. The initial dealer is the host's seat. The dealer rotates one seat after every finished hand, regardless of winner or draw; these are stable table-position labels, not scoring winds. Do not implement dealer retention or round winds.
- Shuffle with Fisher–Yates using Node crypto.randomInt. Inject a deterministic random source in tests only. Deal 13 tiles to each seat, then an extra tile to the dealer. Dealer begins by discarding. Normal draws take the next tile from the wall's front. Do not implement dice, wall-breaking rituals, or a reserved dead wall.
- A normal winning hand has four sets and one pair, counting previously declared melds. A set is a suited three-tile consecutive sequence, three identical tiles, or a declared kong of four identical tiles. Honor tiles cannot form sequences. A declared kong counts as one set despite containing four tiles.
- Also allow seven pairs: a fully concealed hand containing exactly seven distinct tile types with a count of two each. Four identical tiles do not count as two pairs. Declared melds, including concealed kongs, disqualify seven pairs. Do not implement thirteen orphans or other special wins.
- On a normal turn, draw automatically, then let the player discard, declare a legal kong, or declare a legal win. Winning is optional for humans; bots always take a legal win. Human self-draw wins can be declared after a normal/replacement draw or the dealer's initial extra tile, not by turning a chow/pung claim into a later win. There are no minimum hand values, ready declarations, furiten rules, or permanent penalties for passing.
- A discard may be claimed for a win by any other player, for pung or exposed kong by any other player, or for chow only by the next seat in turn order. Chow must be within one suit and ranks 1–9. If several chow combinations are possible, present each exact legal combination.
- Collect eligible players' claim/pass responses before resolving the discard. Use this fixed priority: win, then exposed kong/pung, then chow. If multiple players claim at the same priority, the closest claimant following the discarder in turn order wins. Allow only one winner. A faster network response must not beat a higher-priority claim.
- Automatically pass players who have no legal claim. Keep responses private until resolution. One response per seat per claim window; it cannot be changed. Give each window a unique ID, independent of the room revision, so one player's response does not invalidate other responses to the same window.
- A successful chow or pung transfers the discarded tile into an exposed meld; the claimant discards next without drawing. No restrictions on which remaining tile they discard. If everyone passes, advance to the next seat and draw.
- Support exposed kong from a discard, concealed kong from four tiles during the player's discard phase, and added kong by upgrading their exposed pung with the fourth tile during that phase. Draw a replacement tile from the wall's back after a committed kong; allow further legal kongs or a win before discarding.
- Only an added kong can be robbed, and only to complete a winning hand. Open a win/pass window before committing the upgrade. If robbed, retain the original pung and transfer the proposed fourth tile to the winner. If everyone passes, commit the kong and draw the replacement. Concealed and discard-claimed kongs cannot be robbed in these house rules.
- A kong is not legal when no replacement tile remains. Allow a win claim on the final discard; if no one wins, end in a draw when the wall is empty. Do not allow chow/pung/kong on a discard with an empty wall. A win on the final normal or replacement draw remains valid.
- Keep concealed-kong identities private during the hand; show its owner the tiles and opponents a face-down four-tile meld. At hand end, reveal all hands and melds. Show the winning combination and source: self-draw, discard, or robbed added kong.

### State, networking, and privacy

- Model explicit phases: lobby, awaiting-discard, awaiting-discard-claims, awaiting-kong-robbery, and hand-ended. Track whether a seat is controlled by its connected human or a bot separately from hand phase. Automatic draws are atomic transitions, not client-controlled actions. There is no pause phase in this version.
- A pure transition function validates an actor/action and returns the new state plus effects. Keep wall draws, discards, meld transfer, and phase changes atomic. Process all commands, bot moves, and deadlines through one sequential queue per room. Async handlers must never overlap state mutation.
- Each accepted mutation increments roomRevision. Each discard opportunity and claim window has a unique decisionId. Client game commands include commandId (UUID), roomId, handId, decisionId, and the action payload. Validate ownership and decision eligibility against server state. Use decisionId for claim concurrency, not an exact roomRevision check on every claim response.
- Acknowledge commands with a typed success or error. Configure Socket.IO acknowledgements with a five-second timeout and two retries. Reuse the same commandId on retry. Cache the small acknowledgement to each accepted/rejected command for the room lifetime, not full snapshots; look up that cache before phase validation so a retry after a state transition gets the original result without repeating the action. Bound this to 10,000 commands per guest per room; reject further commands if exceeded. Never cache unauthenticated or rate-limited traffic into room state. Apply replay protection to lobby mutations and room creation as well, using a bounded per-session cache for commands before a room exists.
- Bind cached commands to guest identity and payload; reject a reused ID with a different payload. Independently enforce one transition per decision opportunity, so double-clicks with different IDs cannot discard twice. Reject stale hand/decision IDs without altering state and provide a refreshed player view.
- Send a full, small, recipient-specific state snapshot after each accepted action and at connect/reconnect. Include revision and server time. Ignore older snapshots in the client. Keep Socket.IO connection-state recovery disabled for version one; use session-based rejoining and fresh snapshots as the single recovery path.
- Socket.IO's default event delivery is at most once, so acknowledgements, deduplication, and full resynchronization are required parts of this implementation, not optional improvements. Reference: [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/).
- Send only the recipient's concealed tiles, public discards/melds, opponent hand counts, wall count, connection status, and that recipient's legal actions. Never send the wall order, opponents' hands, other players' offered legal actions, bot internals, or unrevealed claim choices. Never broadcast full server state to a room and rely on the browser to hide it.
- Disable move controls when disconnected or while a command is pending. Do not optimistically draw or discard. After uncertain delivery, reconnect and resync before allowing a new action; duplicate detection handles late retries. Do not queue newly initiated moves while offline.
- Serialize timer callbacks through the room queue and validate captured hand/decision IDs before acting. Cancel obsolete bot and deadline timers after phase changes, hand completion, and room destruction. Returning players resume control only at a safe decision boundary; cancel any uncommitted bot action for that seat and never undo a committed action.
- Before processing each command, resolve any expired decision using the server clock. A command dequeued at or after its deadline is late. A claim/pass response is accepted only before that window's deadline. Sync the displayed countdown from serverTime/deadline, refresh on tab focus, and do not trust a client's clock or claimed send timestamp. Changes to connection status or submission of another player's claim do not reset the deadline or decisionId.
- Reject malformed/oversized messages, unauthorized starts, moves from another seat, nonexistent tile IDs, illegal claims, and stale commands. Set the socket message limit to 16 KiB. Allow at most 10 game commands/second per guest and 10 room create/join attempts per minute per guest; cap unauthenticated session creation at 30/minute per IP. Return readable rate-limit errors. Configure proxy trust for the actual host, not arbitrary forwarded headers.
- Enforce the configured application origin for HTTP mutations and Socket.IO handshakes. Production uses HTTPS/WSS. Add standard HTTP security headers; do not log hands, session cookies, or full invite links. Log room/action errors and health information without secrets.
- Give private room pages a no-referrer policy and noindex metadata. Bundle original SVG tile artwork with the project; do not scrape images or introduce assets with unknown licenses. Do not expose test-only state injection, bot speed controls, or deterministic wall seeds in production builds.

### Basic computer players

- Use deterministic local heuristics, not an LLM or paid service. Feed bots exactly the own-hand/public-table information a human seat receives; bots must not inspect other hands or future draws.
- Always claim a legal win. For version one, pass all chow/pung/kong opportunities and never initiate a kong. Bots can win by normal draws or discard claims and remain legal, intentionally basic opponents.
- For discarding, compute a keep score per tile type: +6 if there are at least three copies in hand, otherwise +4 for a pair; for suited tiles add +2 for each distinct same-suit rank one away present and +1 for each rank two away present. Discard the tile with the lowest keep score. Break ties by tile-type order (dots, bamboo, characters, winds E/S/W/N, dragons red/green/white), then physical tile ID. Recompute after every draw.
- Bots act after 700 ms in the normal game. Inject a scheduler in tests so simulation needs no real-time delays. Bot actions must use the same validated transitions as human actions.

### Execution guidelines

- Follow these decisions without asking preference questions during implementation. An omitted visual detail follows the established style; an omitted optional feature is excluded. If a necessary issue is still unspecified, use the smallest behavior consistent with this document, record it in DECISIONS.md, and continue. Do not silently change the house rules or expand scope.
- Treat missing credentials, required tool permissions, provider billing verification, and impossible external constraints as blockers that cannot be solved by guessing. Complete independent work, then report the precise action required. Never claim a local preview is a public deployment.
- At the beginning, check available Node/npm/browser tooling, dependency-download permissions, and whether the user's GitHub/Render accounts are accessible. Surface missing setup early so the user can supply it before leaving; continue independent implementation while access is pending. A prompt's authorization does not override the environment's permission controls. Do not wait until the final milestone to discover that deployment access is missing.
- At the beginning, install the Ponytail Codex plugin by running these commands in order:

  ```text
  codex plugin marketplace add DietrichGebert/ponytail
  codex plugin add ponytail@ponytail
  ```

  These commands and the required network/configuration changes are authorized for this project, subject to the environment's permission controls. If Ponytail is already installed, verify the installed plugin and do not reinstall it. If the commands differ in the installed Codex version, inspect `codex plugin --help`, use the current equivalent, and record the exact command used. Apply the Ponytail coding-style guidance to all new and modified code. The fixed architecture, security requirements, game rules, acceptance criteria, and repository instructions in this specification take precedence if plugin guidance conflicts with them. Do not install other plugins or marketplaces.

- Keep code straightforward and explicit. Prefer small cohesive modules, pure functions for game logic, clear domain names, early validation, and typed boundaries. Avoid `any`, non-null assertions without a proven invariant, hidden mutable global state, speculative abstractions, clever one-liners, duplicated rule logic, and comments that merely restate code. Comments should explain rules, invariants, concurrency decisions, or non-obvious tradeoffs. Remove dead code and temporary debugging output before each commit.
- Read applicable repository instructions first and preserve unrelated existing files. Use an isolated project directory if the workspace contains unrelated work. Do not overwrite existing repositories, rewrite history, or modify global computer settings.
- Maintain SPEC.md with these fixed decisions, PLAN.md with checkable tasks, and PROGRESS.md with completed work, verification evidence, blockers, and the next exact step. Update them after each milestone so another run resumes without starting over.
- Write meaningful tests for game rules, state transitions, privacy, and failure recovery. Do not write tests that only mirror implementation. Fix root causes rather than disabling checks or weakening assertions. After relevant checks pass, move to the next milestone instead of endlessly retesting or polishing.
- After three failed attempts at the same external operation with the same cause, record the blocker and continue independent work. Do not repeatedly retry unavailable services or permissions. Mark the goal complete only when the final completion criteria are actually met.
- Keep credentials in approved credential storage/provider secrets. Request account access through supported sign-in or permission mechanisms, never by asking the user to paste secrets into source code. Do not purchase services, domains, or add-ons outside the fixed hosting authorization.

### Git workflow and authorization

- Initialize a Git repository before implementation if this game is not already in its own repository. Create `.gitignore` before the first commit. Work on a dedicated branch named `codex/mahjong-together`; if that branch already exists for unrelated work, use the first free numeric suffix beginning with `codex/mahjong-together-2`.
- The user authorizes routine local commits and pushes for this project without separate confirmation. This authorization does not override filesystem, network, account, organization, or tool permission controls. If Git metadata is not writable, network access is unavailable, or authentication fails, preserve all working files, record the exact blocker, and continue every independent task.
- Before every commit, inspect the complete diff and repository status. Stage only files belonging to this project and the completed milestone. Never include credentials, secret-bearing `.env` files, browser profiles, account data, `node_modules`, build caches, generated test traces, or unrelated user files.
- Make one focused checkpoint commit after each milestone is implemented, reviewed, corrected, and verified. Use conventional, descriptive messages such as `feat: implement mahjong hand validation`. Do not combine unfinished milestones merely to reduce the number of commits.
- A milestone may be committed only after its applicable checks pass and the review gate below has no unresolved critical, high, or medium finding. If a check cannot run, record why and do not describe the milestone as verified.
- Push the branch to the project's new private GitHub repository after each verified checkpoint when authenticated network access is available. Never push to an unrelated repository, force-push, amend published commits, rebase shared history, delete branches, rewrite history, or push directly to an existing protected/default branch.
- Do not merge into the default branch automatically. Keep the completed work on the dedicated branch for review. Deployment may use this dedicated branch. Creating a pull request is allowed only if the GitHub integration makes it straightforward and non-destructive; do not merge the pull request.

### Independent reviewer-agent workflow

- After implementing and testing each milestone, and before committing it, spawn one independent read-only reviewer subagent. Give the reviewer this full specification, the milestone's acceptance criteria, the current diff, and the relevant test output. Wait for the reviewer to finish before proceeding.
- The reviewer must challenge the implementation rather than confirm the primary agent's conclusions. It must inspect the actual code and tests and look for incorrect mahjong rules or tile ownership; state-machine errors; races, stale commands, duplicate actions, and timer faults; hidden-hand or wall-order leaks; identity, authorization, validation, rate-limit, and secret-handling weaknesses; reconnect and bot/human ownership conflicts; missing realistic tests; accessibility/mobile failures; and divergence from this specification.
- The reviewer must remain read-only. It must not edit files, stage changes, create commits, push, deploy, or approve external actions. Reviewer and primary agent must not perform concurrent writes in the same checkout.
- Findings must be ordered by severity and include file and line references, evidence, likely impact, reproduction steps when possible, and a concrete correction. The reviewer must avoid style-only findings unless they obscure a real defect. It must explicitly say when it finds no material issue.
- The primary agent must independently verify every finding. Fix every confirmed critical, high, and medium finding before committing. Add a focused regression test when a finding exposes testable behavior. Record rejected findings and the evidence for rejecting them in PROGRESS.md.
- Ask the same reviewer to inspect the corrected diff. Allow at most three review-and-fix rounds for one milestone. If a material issue remains after three rounds, record the blocker and do not mark or commit the milestone as complete.
- After all implementation milestones, spawn three final read-only reviewers in parallel: one for game rules and state invariants, one for multiplayer/security/concurrency, and one for product quality/accessibility/deployment/tests. Wait for all three. Combine duplicate findings, verify each against the code, fix all confirmed material issues, rerun the relevant checks, and request one final read-only review of the resulting branch.
- Create the release commit only after required checks pass and no reviewer has an unresolved critical, high, or medium finding. Reviewer approval is evidence for the primary agent; it never replaces provider permissions or the user's fixed deployment constraints.

## Implementation milestones — complete in order

### 1. Establish the project and repeatable commands

**Problem:** frontend, backend, and shared messages can drift or build differently locally and online.

**Solution:** verify/install the authorized Ponytail plugin and apply its coding-style guidance; initialize the isolated repository and dedicated branch; scaffold the three workspaces and strict TypeScript configuration; lock dependencies; configure the development proxy and production static serving; add /api/health; and implement root commands dev, build, start, typecheck, lint, test, and test:e2e. Ensure commands work on Windows and Linux without shell-specific environment assignment.

**Done when:** Ponytail is verified or an exact installation blocker is recorded; the repository, branch, `.gitignore`, and project documentation exist; a clean npm ci, typecheck, lint, build, and start succeeds; the built page loads; the health endpoint responds; the read-only milestone review is resolved; and the checkpoint commit is created.

### 2. Implement tiles, shuffling, and hand validation

**Problem:** duplicate physical tiles and ambiguous meld decompositions can produce false wins.

**Solution:** separate physical IDs from tile types; implement injectable shuffling/dealing; recursively try every valid pair and set decomposition with memoization; account for declared melds and kongs; implement the separate seven-distinct-pairs rule. Return an actual winning decomposition for the end screen.

**Done when:** tests cover 136 unique physical tiles, four of each type, dealing counts, legal/illegal sequences, honor handling, ambiguous decompositions, exposed melds, kongs, valid seven pairs, quad rejection for seven pairs, and invalid hands.

### 3. Implement the pure hand state machine

**Problem:** draws, claims, kongs, and wins can overlap or lose tiles.

**Solution:** implement each specified phase and transition without network/UI dependencies. Keep a pending discard as a reference to its physical tile in the discard pile, not a duplicate tile container. Transfer it exactly once when claimed. Represent an added kong as pending until robbery resolves.

**Done when:** tests exercise every legal transition and illegal action, competing claims in different arrival orders, claim passes, all kong types, robbery, replacement draws, final-wall cases, and dealer rotation. Assert all 136 physical IDs occur in exactly one owning location after every transition; references must not count as ownership. Assert phase-specific hand sizes, allowing a kong's fourth physical tile in melds.

### 4. Build guest identity and the room lobby

**Problem:** invite links must join the right room without letting someone take another player's seat.

**Solution:** implement guest cookies, validated names, room creation/joining, host/ready controls, seat assignment, lobby host transfer, capacity/expiration handling, and current-session room lookup after refresh. Render the lobby using server state.

**Done when:** isolated browser contexts create and join one room, a fifth player gets a useful rejection, refreshing retains the correct seat, duplicate nicknames do not grant control, and a different guest cannot reclaim an occupied seat.

### 5. Connect the rules through a reliable multiplayer protocol

**Problem:** retries, stale screens, simultaneous claims, and hidden information can corrupt play.

**Solution:** implement room queues, schema validation, command acknowledgements/deduplication, decision IDs, typed errors, and per-player snapshots. Route timers and bots through the same queue. Implement the stated origin, size, and rate controls.

**Done when:** integration tests prove duplicate commands execute once, simultaneous claims resolve by rules rather than arrival order, wrong-seat and stale commands change nothing, and serialized player payloads never contain another concealed hand or wall order. Inspect actual socket payloads, not just visual tile hiding.

### 6. Add bots and disconnect recovery

**Problem:** a dropped connection must not lose a seat or allow a bot and human to act together.

**Solution:** implement the fixed bot policy, disconnection timing policy, session-based rejoin, replacement-connection behavior, and safe handoff from bot to human. Expired rooms must return a clear recoverable error.

**Done when:** tests cover human turn/claim timeouts, just-before/at/after-deadline actions, disconnects during a discard, claims, and kong robbery; reconnect before/after takeover; duplicate tabs; last-human disconnect; stale bot timers; and server restart. Run 100 deterministic all-bot engine simulations with injected fast scheduling; every hand must reach a win/draw within 1,000 transitions while preserving state invariants. Fix the cause of any failure.

### 7. Complete the playable interface

**Problem:** players need to understand available moves on a small screen.

**Solution:** build home, lobby, table, rules/help, reconnect/bot-takeover states, and results/rematch views. Put the local hand at the bottom, label other seats and the dealer, show exposed melds/discards/wall count/countdowns, and group legal action buttons. Select a tile then press Discard. Present exact chow choices. Render all tile faces from locally bundled SVGs with readable English rank/suit labels; white dragon uses a visible border. Use buttons and accessible names, keyboard focus, reduced-motion support, and a horizontally scrollable hand on narrow phones. Clicking a selected tile again deselects it. Keep action buttons at least 44×44 CSS pixels. Include copy-invite feedback and a manual-copy fallback. Explain cold starts/reconnecting with clear loading and retry states; do not add artificial background traffic to prevent hosting sleep.

**Done when:** a user can complete a hand without developer tools; no action relies on hover or color alone; all controls remain reachable at 390×844, 844×390, and 1440×900; and touch/keyboard selection works. Verify rules and status text against actual implemented behavior.

### 8. Verify the complete application

**Problem:** individually correct modules may fail when combined.

**Solution:** use two isolated Playwright browser contexts for human players plus two bots. Test joining, readiness, moves, claim choices, disconnect/reconnect, completion, and rematch. Use controlled scenarios through a test-only injected server factory; do not expose cheat endpoints, chosen wall seeds, or test fixtures in production. Run Chromium, Firefox, and WebKit smoke coverage and Chromium mobile viewport checks.

**Done when:** typecheck, lint, unit/integration tests, browser tests, and production build pass. Test a normal unseeded game path too. Inspect browser console errors and server failures. Save useful test results and screenshots; mark anything untested explicitly.

### 9. Deploy and verify the public service

**Problem:** localhost success does not prove friends can connect over the internet.

**Solution:** follow the fixed hosting policy. Configure the build command npm ci && npm run build, start command npm start, /api/health, Node 24, production environment, and the actual app origin. Use a new private GitHub repository under the user's account named mahjong-together, or mahjong-together-2 and then the next free numeric suffix if occupied; do not overwrite an existing repository. Connect only that repository to the new Render service. Disable automatic deploys after the initial verified release so routine pushes do not interrupt games. Use the provider-generated HTTPS URL; no custom domain.

**Done when:** the public health endpoint works, the actual public page loads, and two isolated browser sessions on that URL join the same private room and exchange legal moves. Verify invite deep links, refresh/reconnect, HTTPS/socket connectivity, and an end/rematch path. If account access or provider verification is missing, finish all deployment files and other work, document the exact remaining step, and leave deployment explicitly incomplete.

### 10. Deliver and stop

**Problem:** the user needs a usable game and a clear handoff, not an endless improvement loop.

**Solution:** complete the three-agent final review and final read-only re-review, then deliver the live URL, dedicated branch and commit identifiers, pull-request URL if created, a short invite/play guide, the documented house rules, repository location, hosting configuration, startup/redeployment instructions, known limitations, and verification results. State that server restarts end in-memory games. Explain how to stop the service. Do not claim any checks passed unless they ran successfully.

**Done when:** all prior milestones are verified and committed, the public game is usable, the documentation matches it, required checks pass, the final reviewers have no unresolved critical/high/medium findings, and there are no known failures in required gameplay or multiplayer behavior. Leave the dedicated branch unmerged and end the goal at this point; optional enhancements belong to a future task.

## Future UX refinement backlog

The following post-release improvements were captured from player feedback on September 6, 2026. They are future work, not additional acceptance criteria for the completed gameplay milestone:

- Replace the always-visible **How to play** disclosure with a question-mark icon button that opens an accessible rules popover on desktop or bottom sheet on mobile. It must be closed by default, support keyboard focus, Escape, and an explicit close action.
- Remove the visible **Hand starting · Mahjong table** gameplay heading. Keep a semantic heading for assistive technology if required, while presenting useful room, connection, wall, seat, and turn information in a compact utility bar.
- Give the four-sided felt a stable aspect ratio and predictable footprint, reduce unused shell padding, and preserve a prominent central discard area with an explained empty state and discard-owner legend.
- Group the local player card, hand rack, and legal actions into a bottom interaction dock. Keep the rack primary, reveal actions contextually, and reduce persistent instructional chrome.
- Make active-player status unmistakable with text, high-contrast border/glow, and timer/progress treatment; never rely on seat color alone.
- Present opponent-hand reveals in an overlay or expandable panel that preserves table geometry and keeps the local hand accessible.
- Recheck hierarchy, reachability, and scroll behavior at desktop, tablet, and both required phone orientations, while retaining the existing 44×44 CSS-pixel control target and reduced-motion behavior.
