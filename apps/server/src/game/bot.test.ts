import type { PhysicalTile } from "@mahjong-together/shared";
import { describe, expect, it } from "vitest";

import { chooseBotAction } from "./bot.js";

const decisionId = "hand:decision:1";

describe("deterministic bot policy", () => {
  it("takes every offered win and passes non-winning claims", () => {
    expect(
      chooseBotAction({
        concealedTiles: [],
        decisionId,
        legalActions: {
          kind: "discard-claim",
          legal: { canKong: true, canPung: true, canWin: false, chows: [] },
        },
        opponents: [],
        ownDiscards: [],
        ownMelds: [],
        seat: 1,
        wallRemaining: 100,
      }),
    ).toEqual({ choice: { kind: "pass" }, decisionId, kind: "respond-to-discard" });
    expect(
      chooseBotAction({
        concealedTiles: [],
        decisionId,
        legalActions: {
          kind: "discard-claim",
          legal: { canKong: false, canPung: false, canWin: true, chows: [] },
        },
        opponents: [],
        ownDiscards: [],
        ownMelds: [],
        seat: 2,
        wallRemaining: 100,
      }),
    ).toEqual({ choice: { kind: "win" }, decisionId, kind: "respond-to-discard" });
    expect(
      chooseBotAction({
        concealedTiles: [],
        decisionId,
        legalActions: { kind: "kong-robbery" },
        opponents: [],
        ownDiscards: [],
        ownMelds: [],
        seat: 3,
        wallRemaining: 100,
      }),
    ).toEqual({ choice: "win", decisionId, kind: "respond-to-kong-robbery" });
  });

  it("declares a self-draw win and never initiates a kong", () => {
    expect(
      chooseBotAction({
        concealedTiles: tiles("d1"),
        decisionId,
        legalActions: {
          addedKongs: [{ meldIndex: 0, tileId: "d1-0" }],
          canWin: true,
          concealedKongs: ["d1"],
          discardTileIds: ["d1-0"],
          kind: "discard",
        },
        opponents: [],
        ownDiscards: [],
        ownMelds: [],
        seat: 0,
        wallRemaining: 100,
      }),
    ).toEqual({ decisionId, kind: "declare-self-win" });
  });

  it("discards based on shanten optimization", () => {
    const concealedTiles = tiles("east", "white", "d1", "d1", "east");
    const result = chooseBotAction({
      concealedTiles,
      decisionId,
      legalActions: {
        addedKongs: [],
        canWin: false,
        concealedKongs: [],
        discardTileIds: concealedTiles.map((tile) => tile.id),
        kind: "discard",
      },
      opponents: [],
      ownDiscards: [],
      ownMelds: [],
      seat: 0,
      wallRemaining: 100,
    });
    expect(result?.kind).toBe("discard");
    expect(result?.tileId).toBeDefined();
  });
});

function tiles(...types: PhysicalTile["type"][]): PhysicalTile[] {
  const copies = new Map<string, number>();
  return types.map((type) => {
    const copy = copies.get(type) ?? 0;
    copies.set(type, copy + 1);
    return { id: `${type}-${String(copy)}`, type };
  });
}
