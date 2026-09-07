import { TILE_TYPES, type PhysicalTile } from "@mahjong-together/shared";
import { describe, expect, it } from "vitest";

import { chooseBotAction } from "./bot.js";
import {
  legalActionsForSeat,
  otherSeats,
  startHand,
  transition,
  type AwaitingDiscardClaimsState,
  type HandState,
} from "./state.js";
import { createTileSet, shuffleTiles, type SeatIndex } from "./wall.js";

describe("all-bot engine simulations", () => {
  it(
    "finishes 100 deterministic hands within 1,000 legal transitions",
    { timeout: 120_000 },
    () => {
      for (let seed = 1; seed <= 100; seed += 1) {
        let state: HandState = startHand(
          `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`,
          (seed % 4) as SeatIndex,
          shuffleTiles(createTileSet(), seededRandom(seed)),
        );
        let transitions = 0;
        assertOwnership(state);

        while (state.phase !== "hand-ended" && transitions < 1_000) {
          let acted = false;
          for (const seat of [0, 1, 2, 3] as const) {
            const legalActions = legalActionsForSeat(state, seat);
            const claimedTile = latestDiscard(state);
            const baseView = {
              concealedTiles: state.players[seat].concealed,
              decisionId: state.decisionId,
              legalActions,
              opponents: otherSeats(seat).map((opponentSeat) => ({
                discards: state.players[opponentSeat].discards,
                melds: state.players[opponentSeat].melds,
                seat: opponentSeat,
              })),
              ownDiscards: state.players[seat].discards,
              ownMelds: state.players[seat].melds,
              seat,
              wallRemaining: state.wall.length,
            };
            const action = chooseBotAction(
              claimedTile !== undefined ? { ...baseView, claimedTile } : baseView,
            );
            if (action === null) continue;
            const result = transition(state, seat, action);
            if (!result.ok) {
              throw new Error(`Seed ${String(seed)} bot action failed: ${result.code}`);
            }
            state = result.state;
            transitions += 1;
            acted = true;
            assertOwnership(state);
            break;
          }
          if (!acted) throw new Error(`Seed ${String(seed)} has no available bot action`);
        }

        expect(state.phase, `seed ${String(seed)} after ${String(transitions)} transitions`).toBe(
          "hand-ended",
        );
        expect(transitions).toBeLessThan(1_000);
      }
    },
  );
});

function latestDiscard(state: HandState): PhysicalTile | undefined {
  if (state.phase !== "awaiting-discard-claims") return undefined;
  return discardTile(state);
}

function discardTile(state: AwaitingDiscardClaimsState): PhysicalTile | undefined {
  const { seat, tileId } = state.discard;
  return state.players[seat].discards.find((tile) => tile.id === tileId);
}

function seededRandom(seed: number): (maximum: number) => number {
  let state = seed >>> 0;
  return (maximum) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % maximum;
  };
}

function assertOwnership(state: HandState): void {
  const tiles = [
    ...state.wall,
    ...state.players.flatMap((player) => [
      ...player.concealed,
      ...player.discards,
      ...player.melds.flatMap((meld) => meld.tiles),
    ]),
  ];
  if (tiles.length !== 136 || new Set(tiles.map((tile) => tile.id)).size !== 136) {
    throw new Error("Physical tile ownership invariant failed");
  }
  const counts = new Map(TILE_TYPES.map((type) => [type, 0]));
  for (const tile of tiles) counts.set(tile.type, (counts.get(tile.type) ?? 0) + 1);
  if (TILE_TYPES.some((type) => counts.get(type) !== 4)) {
    throw new Error("Tile-type copy invariant failed");
  }
}
