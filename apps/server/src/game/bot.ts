import {
  TILE_TYPES,
  suitedTileDetails,
  tileTypeIndex,
  type PhysicalTile,
  type TileType,
} from "@mahjong-together/shared";

import type { DeclaredMeld } from "./hand.js";
import type { HandAction, LegalHandActions } from "./state.js";
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
    return {
      choice: legalActions.legal.canWin ? { kind: "win" } : { kind: "pass" },
      decisionId,
      kind: "respond-to-discard",
    };
  }
  if (legalActions.canWin) return { decisionId, kind: "declare-self-win" };

  const tile = chooseDiscard(view.concealedTiles, legalActions.discardTileIds);
  return tile === undefined ? null : { decisionId, kind: "discard", tileId: tile.id };
}

function chooseDiscard(
  concealedTiles: readonly PhysicalTile[],
  discardTileIds: readonly string[],
): PhysicalTile | undefined {
  const allowed = new Set(discardTileIds);
  const candidates = concealedTiles.filter((tile) => allowed.has(tile.id));
  if (candidates.length === 0) return undefined;

  const counts = countTypes(concealedTiles);
  return [...candidates].sort(
    (left, right) =>
      keepScore(left.type, counts) - keepScore(right.type, counts) ||
      tileTypeIndex(left.type) - tileTypeIndex(right.type) ||
      left.id.localeCompare(right.id),
  )[0];
}

function countTypes(tiles: readonly PhysicalTile[]): Map<TileType, number> {
  const counts = new Map<TileType, number>();
  for (const tile of tiles) counts.set(tile.type, (counts.get(tile.type) ?? 0) + 1);
  return counts;
}

function keepScore(type: TileType, counts: ReadonlyMap<TileType, number>): number {
  const copies = counts.get(type) ?? 0;
  let score = copies >= 3 ? 6 : copies === 2 ? 4 : 0;
  const details = suitedTileDetails(type);
  if (details === null) return score;

  const index = tileTypeIndex(type);
  for (const offset of [-2, -1, 1, 2]) {
    if (details.rank + offset < 1 || details.rank + offset > 9) continue;
    const neighbor = TILE_TYPES[index + offset];
    if (neighbor !== undefined && (counts.get(neighbor) ?? 0) > 0) {
      score += Math.abs(offset) === 1 ? 2 : 1;
    }
  }
  return score;
}
