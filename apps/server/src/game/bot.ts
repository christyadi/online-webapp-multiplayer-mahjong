import {
  suitedTileDetails,
  tileTypeIndex,
  type PhysicalTile,
  type TileType,
} from "@mahjong-together/shared";

import type { HandAction, LegalHandActions } from "./state.js";
import type { SeatIndex } from "./wall.js";

export type BotDecisionView = Readonly<{
  concealedTiles: readonly PhysicalTile[];
  decisionId: string;
  legalActions: LegalHandActions;
  seat: SeatIndex;
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
  const legalTileIds = new Set(legalActions.discardTileIds);
  const tile = [...view.concealedTiles]
    .filter((candidate) => legalTileIds.has(candidate.id))
    .sort((left, right) => {
      const scoreDifference =
        keepScore(left.type, view.concealedTiles) - keepScore(right.type, view.concealedTiles);
      if (scoreDifference !== 0) return scoreDifference;
      const typeDifference = tileTypeIndex(left.type) - tileTypeIndex(right.type);
      return typeDifference !== 0 ? typeDifference : left.id.localeCompare(right.id);
    })[0];
  return tile === undefined ? null : { decisionId, kind: "discard", tileId: tile.id };
}

export function keepScore(type: TileType, hand: readonly PhysicalTile[]): number {
  const copies = hand.filter((tile) => tile.type === type).length;
  let score = copies >= 3 ? 6 : copies === 2 ? 4 : 0;
  const details = suitedTileDetails(type);
  if (details === null) return score;
  const distinctTypes = new Set(hand.map((tile) => tile.type));
  for (const candidate of distinctTypes) {
    const candidateDetails = suitedTileDetails(candidate);
    if (candidateDetails?.suit !== details.suit) continue;
    const distance = Math.abs(candidateDetails.rank - details.rank);
    if (distance === 1) score += 2;
    else if (distance === 2) score += 1;
  }
  return score;
}
