import type { PhysicalTile } from "@mahjong-together/shared";
import { describe, expect, it } from "vitest";

import { chooseBotAction, keepScore } from "./bot.js";

const decisionId = "hand:decision:1";

describe("deterministic bot policy", () => {
  it("scores pairs, triples, and distinct suited neighbors exactly", () => {
    const hand = tiles("d3", "d4", "d4", "d4", "d5", "d6", "d6", "east");
    expect(keepScore("d4", hand)).toBe(11);
    expect(keepScore("d6", hand)).toBe(7);
    expect(keepScore("east", hand)).toBe(0);
  });

  it("takes every offered win and passes non-winning claims", () => {
    expect(
      chooseBotAction({
        concealedTiles: [],
        decisionId,
        legalActions: {
          kind: "discard-claim",
          legal: { canKong: true, canPung: true, canWin: false, chows: [] },
        },
        seat: 1,
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
        seat: 2,
      }),
    ).toEqual({ choice: { kind: "win" }, decisionId, kind: "respond-to-discard" });
    expect(
      chooseBotAction({
        concealedTiles: [],
        decisionId,
        legalActions: { kind: "kong-robbery" },
        seat: 3,
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
        seat: 0,
      }),
    ).toEqual({ decisionId, kind: "declare-self-win" });
  });

  it("discards the lowest score with type-order then physical-ID ties", () => {
    const concealedTiles = tiles("east", "white", "d1", "d1", "east");
    expect(
      chooseBotAction({
        concealedTiles,
        decisionId,
        legalActions: {
          addedKongs: [],
          canWin: false,
          concealedKongs: [],
          discardTileIds: concealedTiles.map((tile) => tile.id),
          kind: "discard",
        },
        seat: 0,
      }),
    ).toEqual({ decisionId, kind: "discard", tileId: "white-0" });
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
