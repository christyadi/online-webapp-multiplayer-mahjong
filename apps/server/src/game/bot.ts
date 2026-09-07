import type { PhysicalTile, TileType } from "@mahjong-together/shared";

import type { DeclaredMeld } from "./hand.js";
import { overallShanten, ukeire } from "./shanten.js";
import type { ClaimChoice, HandAction, LegalDiscardClaims, LegalHandActions } from "./state.js";
import type { SeatIndex } from "./wall.js";

export type BotDecisionView = Readonly<{
  concealedTiles: readonly PhysicalTile[];
  decisionId: string;
  legalActions: LegalHandActions;
  ownDiscards: readonly PhysicalTile[];
  ownMelds: readonly DeclaredMeld[];
  opponents: readonly Readonly<{
    seat: SeatIndex;
    discards: readonly PhysicalTile[];
    melds: readonly DeclaredMeld[];
  }>[];
  seat: SeatIndex;
  wallRemaining: number;
  /** Present only when legalActions.kind === "discard-claim". */
  claimedTile?: PhysicalTile;
}>;

export function chooseBotAction(view: BotDecisionView): HandAction | null {
  const { decisionId, legalActions } = view;

  if (legalActions.kind === "none") return null;

  if (legalActions.kind === "kong-robbery") {
    return { choice: "win", decisionId, kind: "respond-to-kong-robbery" };
  }

  if (legalActions.kind === "discard-claim") {
    const choice = chooseClaimResponse(view, legalActions.legal);
    return { choice, decisionId, kind: "respond-to-discard" };
  }

  if (legalActions.canWin) return { decisionId, kind: "declare-self-win" };

  const tile = chooseDiscard(view, legalActions.discardTileIds);
  return tile === undefined ? null : { decisionId, kind: "discard", tileId: tile.id };
}

// ---------- live-tile counting ----------

function makeLiveCounter(view: BotDecisionView): (type: TileType) => number {
  const seen = new Map<TileType, number>();
  const bump = (type: TileType, amount = 1): void => {
    seen.set(type, (seen.get(type) ?? 0) + amount);
  };

  for (const tile of view.concealedTiles) bump(tile.type);
  for (const tile of view.ownDiscards) bump(tile.type);
  for (const meld of view.ownMelds) for (const tile of meld.tiles) bump(tile.type);
  for (const opponent of view.opponents) {
    for (const tile of opponent.discards) bump(tile.type);
    for (const meld of opponent.melds) for (const tile of meld.tiles) bump(tile.type);
  }

  return (type) => Math.max(0, 4 - (seen.get(type) ?? 0));
}

// ---------- discard selection ----------

function chooseDiscard(
  view: BotDecisionView,
  discardTileIds: readonly string[],
): PhysicalTile | undefined {
  const legalIds = new Set(discardTileIds);
  const candidates = view.concealedTiles.filter((tile) => legalIds.has(tile.id));
  if (candidates.length === 0) return undefined;

  const threatLevel = assessThreat(view);
  const liveCount = makeLiveCounter(view);

  // Under real pressure, restrict to tiles we know are safe against a threatening
  // opponent (genbutsu: already discarded by them, or already called by anyone).
  const pool =
    threatLevel === "high" ? (preferSafeTiles(candidates, view) ?? candidates) : candidates;

  let best: { tile: PhysicalTile; shanten: number; ukeireCount: number } | null = null;
  for (const tile of pool) {
    const remaining = view.concealedTiles.filter((candidate) => candidate.id !== tile.id);
    const shanten = overallShanten(remaining, view.ownMelds);
    const gains = ukeire(remaining, view.ownMelds, liveCount);
    const ukeireCount = [...gains.values()].reduce((sum, count) => sum + count, 0);

    if (
      best === null ||
      shanten < best.shanten ||
      (shanten === best.shanten && ukeireCount > best.ukeireCount)
    ) {
      best = { shanten, tile, ukeireCount };
    }
  }
  return best?.tile;
}

type ThreatLevel = "low" | "high";

function assessThreat(view: BotDecisionView): ThreatLevel {
  // No riichi mechanic in this ruleset, so the only visible signal is calls.
  // Treat any opponent with 2+ melds, or any meld built from a value tile
  // (round/seat wind, dragon), as a live threat worth playing around.
  // TUNABLE: this threshold is a guess, not derived from rules - adjust freely.
  const dangerous = view.opponents.some((opponent) => {
    if (opponent.melds.length >= 2) return true;
    return opponent.melds.some((meld) => meld.tiles.some((tile) => isHonor(tile.type)));
  });
  return dangerous ? "high" : "low";
}

function isHonor(type: TileType): boolean {
  return !type.startsWith("d") && !type.startsWith("b") && !type.startsWith("c");
}

function preferSafeTiles(
  candidates: readonly PhysicalTile[],
  view: BotDecisionView,
): PhysicalTile[] | null {
  const threateningOpponents = view.opponents.filter(
    (opponent) =>
      opponent.melds.length >= 2 ||
      opponent.melds.some((meld) => meld.tiles.some((tile) => isHonor(tile.type))),
  );
  const safeTypes = new Set<TileType>();
  for (const opponent of threateningOpponents) {
    for (const tile of opponent.discards) safeTypes.add(tile.type);
  }
  const safe = candidates.filter((tile) => safeTypes.has(tile.type));
  return safe.length > 0 ? safe : null;
}

// ---------- discard-claim response ----------

function chooseClaimResponse(view: BotDecisionView, legal: LegalDiscardClaims): ClaimChoice {
  if (legal.canWin) return { kind: "win" };

  const claimedTile = view.claimedTile;
  if (claimedTile === undefined) return { kind: "pass" };

  const currentShanten = overallShanten(view.concealedTiles, view.ownMelds);

  // Late game (little wall left), be more willing to call on equal shanten to
  // lock in tempo. Early game, require a strict improvement to preserve
  // hand flexibility and avoid committing to a cheap open hand too soon.
  // TUNABLE: 30 is an arbitrary threshold - tune against real games.
  const lateGame = view.wallRemaining < 30;

  const candidates: { choice: ClaimChoice; resultShanten: number }[] = [];

  if (legal.canKong) {
    const resultShanten = simulateCallShanten(view, claimedTile, "kong", []);
    candidates.push({ choice: { kind: "kong" }, resultShanten });
  }
  if (legal.canPung) {
    const resultShanten = simulateCallShanten(view, claimedTile, "pung", []);
    candidates.push({ choice: { kind: "pung" }, resultShanten });
  }
  for (const option of legal.chows) {
    const resultShanten = simulateCallShanten(view, claimedTile, "chow", option.tileIds);
    candidates.push({ choice: { kind: "chow", tileIds: option.tileIds }, resultShanten });
  }

  let best: { choice: ClaimChoice; resultShanten: number } | null = null;
  for (const candidate of candidates) {
    if (best === null || candidate.resultShanten < best.resultShanten) best = candidate;
  }
  if (best === null) return { kind: "pass" };

  const strictlyBetter = best.resultShanten < currentShanten;
  const goodEnoughLate = lateGame && best.resultShanten <= currentShanten;
  return strictlyBetter || goodEnoughLate ? best.choice : { kind: "pass" };
}

function simulateCallShanten(
  view: BotDecisionView,
  claimedTile: PhysicalTile,
  kind: "pung" | "kong" | "chow",
  chowTileIds: readonly string[],
): number {
  const usedIds =
    kind === "chow"
      ? new Set(chowTileIds)
      : new Set(
          view.concealedTiles
            .filter((tile) => tile.type === claimedTile.type)
            .slice(0, kind === "kong" ? 3 : 2)
            .map((tile) => tile.id),
        );

  const remainingConcealed = view.concealedTiles.filter((tile) => !usedIds.has(tile.id));
  const usedTiles = view.concealedTiles.filter((tile) => usedIds.has(tile.id));
  const newMeld: DeclaredMeld = {
    concealed: false,
    kind,
    tiles: [...usedTiles, claimedTile],
  };
  const meldsAfterCall = [...view.ownMelds, newMeld];

  // After calling, we must discard - so best-case shanten is the minimum
  // over discarding any one of the remaining concealed tiles.
  if (remainingConcealed.length === 0) return overallShanten(remainingConcealed, meldsAfterCall);
  let best = Infinity;
  for (let index = 0; index < remainingConcealed.length; index += 1) {
    const afterDiscard = remainingConcealed.filter((_, i) => i !== index);
    best = Math.min(best, overallShanten(afterDiscard, meldsAfterCall));
  }
  return best;
}
