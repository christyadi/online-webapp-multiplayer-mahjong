import type { PhysicalTile } from "@mahjong-together/shared";
import { describe, expect, it } from "vitest";

import { chooseBotAction } from "./bot.js";

const decisionId = "hand:decision:1";

describe("deterministic bot policy", () => {
  it("takes every offered win and passes non-winning claims", () => {
    expect(
      chooseBotAction({
        claimedTile: { id: "d3-0", type: "d3" },
        concealedTiles: tiles(
          "d1",
          "d2",
          "d4",
          "d5",
          "d6",
          "d7",
          "d8",
          "d9",
          "b1",
          "b2",
          "b3",
          "b4",
          "b5",
        ),
        decisionId,
        legalActions: {
          kind: "discard-claim",
          legal: {
            canKong: true,
            canPung: true,
            canWin: false,
            chows: [{ tileIds: ["d1-0", "d2-0"] }],
          },
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

  it("discards the lowest keep score, then tile type and physical ID", () => {
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
    expect(result).toEqual({ decisionId, kind: "discard", tileId: "white-0" });

    const tiedTiles = tiles("white", "east");
    expect(
      chooseBotAction({
        concealedTiles: tiedTiles,
        decisionId,
        legalActions: {
          addedKongs: [],
          canWin: false,
          concealedKongs: [],
          discardTileIds: tiedTiles.map((tile) => tile.id),
          kind: "discard",
        },
        opponents: [],
        ownDiscards: [],
        ownMelds: [],
        seat: 0,
        wallRemaining: 100,
      }),
    ).toEqual({ decisionId, kind: "discard", tileId: "east-0" });
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
