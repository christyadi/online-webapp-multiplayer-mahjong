# Mahjong Together visual direction

This document adapts the supplied `mahjong-game-page.html`, `mahjong-landing-page.html`, `mahjong-tile-concept.html`, and `design-system.md` references into the existing Mahjong Together product. The references are visual direction, not executable implementation instructions. Their external font imports, Unicode tile rendering, audio effects, and marketing-only copy are intentionally excluded where they conflict with the product specification.

## Implemented direction (2026-09-07)

- The table now uses a continuous shaded felt plane, framed by a compact wood HUD and a lower wood interaction dock. Brass is limited to dealer/wind markers, wall context, active state, and result emphasis.
- The existing local SVG tiles now render with an ivory face, warm bevel, highlight, woven green back, drawn-tile separation, and perspective-preserving selection lift. The server reveals a drawn-tile ID only to its current owner.
- The middle is a stable central pond with a physical wall stack, an explicit first-discard empty state, and a seat-color legend. The latest public discard remains in readable status text and uses restrained motion when motion is allowed.
- The gameplay HUD replaces the previous generic title with room/seat context, dealer marker, current player action, and active-seat countdown. A top-table menu owns the accessible question-mark rules dialog, light/dark control, connection state, and Leave game action. End-hand opponent tiles open in a dialog rather than reflowing the table.
- A completed hand opens a calm result dialog in the landing page’s wood-and-ivory material: it shows the winner or draw, winning hand, Play again, auto-play, the other players’ hands, and the remaining room window. Moving color trails and confetti are intentionally absent.
- Public exposed melds remain visible as compact, horizontally scrollable physical-tile strips at phone portrait and landscape sizes; screen-reader descriptions retain the meld information without visible tile-name text.
- Rules and end-hand dialogs are portaled above the app, inert the background, trap Tab focus, close with Escape, and restore their owning control. Local tiles support mouse drag; on touch, holding a tile then tapping its destination avoids taking over ordinary horizontal rack panning. Sort hand is the compact non-drag arrangement action; individual grips and left/right movement buttons are intentionally absent.
- The landing card owns a deep, readable dark-mode surface rather than retaining a light ivory gradient. Its first viewport offers distinct **Create a private room** and **Join a lobby** flows without turning either into a nested card.
- The landing page is a table invitation, not a hero illustration: a compact Mahjong-tile emblem sits with the title while two equal, full-width entry lanes hold the prominent nickname/code fields and actions. The visual hierarchy must always favor creating or joining over decoration.
- The landing page and private room lobby share the same wood-backed ivory material palette in both themes. The lobby retains its denser room-specific information, but it must read as the next step of the same private-table journey rather than as a separate product surface.
- Light-mode player cards use four seat-tinted paper surfaces with explicit dark text/muted-text values. Controller prose is removed from the card; a compact, labeled robot icon appears only for bot-controlled seats.

## Purpose and tone

Mahjong Together should feel like sitting down at a cared-for physical table: tactile, calm, traditional, and easy to scan during a live hand. The table is the product, not a dashboard made from unrelated cards. Use one strong visual gesture per screen and reserve high-attention accents for the current action, important CTA, or result.

## Material language

- **Ivory** is the paper/tile family: `#faf6ec` highlight, `#f0e5cd` body, `#dccaa0` edge, and `#b9a878` deepest bevel.
- **Felt** is the shared play surface: `#0c4a34`, shaded through `#083825` to `#062c1c`. The gameplay surface should read as one continuous plane.
- **Wood** frames the experience: `#6b4226`, `#4a2c17`, and `#2e1a0e` for rack, HUD, navigation, and footer accents.
- **Brass** (`#f1e3ac`, `#d8c68a`, `#a88f4d`) is the scarce “look here” signal for wind markers, primary moments, and winner emphasis.
- **Suit colors** retain meaning only: characters/cinnabar `#a5312a`, bamboo/jade `#2c6b3f`, and circles/indigo `#20567e`. They are never generic danger, success, or action colors.
- **Dark mode** deepens the page, wood, and felt surfaces while keeping tile faces, suit meaning, focus outlines, and status text readable. Do not simply invert the light palette.

## Typography and asset constraints

- Use the existing system sans stack for UI text.
- Use the existing locally bundled SVG tile art for every tile face and back; do not add a dependency on external fonts or Mahjong Unicode glyph support.
- A brush-like mark may be used sparingly for a logo or wind marker only if it is locally available and remains decorative. Never use it for paragraphs, rules, or controls.
- Do not add sound, music, external image/font requests, or autoplay media. The supplied “clack” interaction is a visual reference only.

## Tile language

The tile is an object, not a generic card:

- Face-up tiles use an ivory face, warm bevel, subtle depth, and the existing locally rendered suit glyphs.
- Face-down tiles use a woven green back that remains distinct from the felt.
- Selected tiles lift along the rack’s existing perspective instead of scaling or jumping straight up.
- Small, medium, and large uses should preserve the same bevel and glyph proportions.
- The drawn tile remains visually separated from the local rack. Melds and wall stacks may use stepped depth, but the effect stays restrained.

## Gameplay composition

- Use one continuous felt surface with a quiet wood HUD above it.
- Keep opponents at the far/top and side edges, face-down and smaller; keep the local player’s card, rack, and actions at the lower edge.
- Keep the wall legible as a physical stack or compact stack treatment, paired with its remaining count.
- Keep every discard in one central pond. The pond should have a stable footprint, an understandable empty state, and a subtle owner-color legend.
- Preserve the physical distinction between the drawn tile and the hand rack.
- Use a brass wind marker and quiet status treatment for table context; do not let the HUD compete with the felt.

## Interaction and motion

- Make the active seat obvious with text, a high-contrast border/glow, timer/progress, and a restrained motion cue. Color alone is insufficient.
- Show the latest public action in readable language, such as “West discarded 5 of bamboo,” and announce it through an accessible live region.
- When a discard is made, a short origin-to-pond motion may orient the eye. Keep the latest action visible long enough to read.
- Treat the result dialog—not decorative animation—as the win moment. It should name the winner, make the hand legible, and give the next action clear prominence without covering or resizing the table.
- Disable non-essential motion under `prefers-reduced-motion`; provide static status and result equivalents.

## Landing and recovery surfaces

The supplied landing reference suggests a wood frame, felt hero, one oversized tile, an ivory material section, suit-specific accents, a short four-step flow, a brass CTA band, and a wood footer. If this direction is applied later, the existing create/join workflow remains the primary action; decorative sections must not push it below the first useful viewport. Recovery, lobby, and result-dialog screens should reuse the same material tokens rather than introduce a separate visual language.

## Accessibility and responsive acceptance

- Keep controls at least 44×44 CSS pixels and use semantic buttons/labels.
- Keep dialog focus inside the open overlay, make the application behind it inert, restore the trigger on close, and retain Escape plus an explicit close control.
- Pair every color or animation cue with readable text or an accessible announcement.
- Maintain clear focus outlines in both themes and keep tile labels available to assistive technology.
- Keep public meld information visible and readable at all supported breakpoints; pair compact artwork with tile-name summaries and bounded horizontal scrolling instead of concealing it.
- The normal turn should fit without page scrolling at desktop, tablet, and both phone orientations. Only intentionally long hand/discard collections may scroll inside their own regions.
- Verify the composition at 1440×900, iPad Pro 11, 390×844, and 844×390.

## Reference boundaries

Adopt the visual principles above. Do not copy the supplied demo’s Google Fonts, Unicode glyph dependency, inline scripts, audio clack, fake/random tile logic, or marketing claims into the production app. Existing rules, privacy, local-asset, no-sound, dark-mode, and hosting constraints remain authoritative.
