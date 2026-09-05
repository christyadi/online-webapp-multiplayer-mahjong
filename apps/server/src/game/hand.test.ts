import type { PhysicalTile, TileType } from "@mahjong-together/shared";
import { describe, expect, it } from "vitest";

import { findWinningDecomposition, isLegalMeld, type DeclaredMeld } from "./hand.js";

function tiles(...types: TileType[]): PhysicalTile[] {
  return types.map((type, index) => ({ id: `test-${String(index)}-${type}`, type }));
}

describe("winning hand validation", () => {
  it("finds a normal hand with suited sequences, an honor pung, and a pair", () => {
    const hand = tiles(
      "d1",
      "d2",
      "d3",
      "d1",
      "d2",
      "d3",
      "b4",
      "b5",
      "b6",
      "east",
      "east",
      "east",
      "red",
      "red",
    );

    const result = findWinningDecomposition(hand);

    expect(result?.kind).toBe("normal");
    if (result?.kind !== "normal") throw new Error("Expected a normal decomposition");
    expect(result.sets).toHaveLength(4);
    expect(result.pair.map((tile) => tile.type)).toEqual(["red", "red"]);
    expect(
      new Set([...result.pair, ...result.sets.flatMap((set) => set.tiles)].map((tile) => tile.id))
        .size,
    ).toBe(14);
  });

  it("does not treat winds as a sequence", () => {
    const hand = tiles(
      "east",
      "south",
      "west",
      "d1",
      "d2",
      "d3",
      "b1",
      "b2",
      "b3",
      "c1",
      "c2",
      "c3",
      "white",
      "white",
    );

    expect(findWinningDecomposition(hand)).toBeNull();
  });

  it("accepts only consecutive, same-suit declared chows", () => {
    const chow = (types: readonly [TileType, TileType, TileType]): DeclaredMeld => ({
      concealed: false,
      kind: "chow",
      tiles: tiles(...types),
    });

    expect(isLegalMeld(chow(["d1", "d2", "d3"]))).toBe(true);
    expect(isLegalMeld(chow(["d1", "d2", "d4"]))).toBe(false);
    expect(isLegalMeld(chow(["d8", "d9", "b1"]))).toBe(false);
  });

  it("allows only kongs to be declared concealed", () => {
    const concealedMeld = (
      kind: DeclaredMeld["kind"],
      types: readonly TileType[],
    ): DeclaredMeld => ({ concealed: true, kind, tiles: tiles(...types) });

    expect(isLegalMeld(concealedMeld("chow", ["d1", "d2", "d3"]))).toBe(false);
    expect(isLegalMeld(concealedMeld("pung", ["d9", "d9", "d9"]))).toBe(false);
    expect(isLegalMeld(concealedMeld("kong", ["d9", "d9", "d9", "d9"]))).toBe(true);
    expect(
      isLegalMeld({
        concealed: false,
        kind: "kong",
        tiles: tiles("d9", "d9", "d9", "d9"),
      }),
    ).toBe(true);
  });

  it("requires each physical tile in a meld to be distinct", () => {
    const repeated = { id: "same", type: "d9" } as const;

    expect(
      isLegalMeld({ concealed: false, kind: "pung", tiles: [repeated, repeated, repeated] }),
    ).toBe(false);
    expect(
      isLegalMeld({
        concealed: true,
        kind: "kong",
        tiles: [repeated, repeated, repeated, repeated],
      }),
    ).toBe(false);
  });

  it("resolves an ambiguous hand by trying alternate set decompositions", () => {
    const hand = tiles(
      "d1",
      "d1",
      "d1",
      "d2",
      "d2",
      "d2",
      "d3",
      "d3",
      "d3",
      "d4",
      "d4",
      "d4",
      "d5",
      "d5",
    );

    expect(findWinningDecomposition(hand)?.kind).toBe("normal");
  });

  it.each(["pung", "kong"] as const)("counts a declared %s as one set", (kind) => {
    const count = kind === "pung" ? 3 : 4;
    const meld: DeclaredMeld = {
      concealed: kind === "kong",
      kind,
      tiles: tiles(...Array.from({ length: count }, () => "d9" as const)),
    };
    const concealed = tiles(
      "d1",
      "d2",
      "d3",
      "b1",
      "b2",
      "b3",
      "c1",
      "c2",
      "c3",
      "white",
      "white",
    ).map((tile) => ({ ...tile, id: `concealed-${tile.id}` }));

    const result = findWinningDecomposition(concealed, [meld]);

    expect(result?.kind).toBe("normal");
    if (result?.kind !== "normal") throw new Error("Expected a normal decomposition");
    expect(result.sets).toHaveLength(4);
    expect(result.sets[0]?.kind).toBe(kind);
    expect(
      new Set([...result.pair, ...result.sets.flatMap((set) => set.tiles)].map((tile) => tile.id))
        .size,
    ).toBe(concealed.length + meld.tiles.length);
  });

  it("accepts exactly seven distinct concealed pairs", () => {
    const hand = tiles(
      "d1",
      "d1",
      "d9",
      "d9",
      "b2",
      "b2",
      "c3",
      "c3",
      "east",
      "east",
      "north",
      "north",
      "white",
      "white",
    );

    const result = findWinningDecomposition(hand);

    expect(result?.kind).toBe("seven-pairs");
    if (result?.kind !== "seven-pairs") throw new Error("Expected seven pairs");
    expect(result.pairs).toHaveLength(7);
  });

  it("does not count a quad as two pairs", () => {
    const hand = tiles(
      "d1",
      "d1",
      "d1",
      "d1",
      "east",
      "east",
      "south",
      "south",
      "west",
      "west",
      "north",
      "north",
      "red",
      "red",
    );

    expect(findWinningDecomposition(hand)).toBeNull();
  });

  it("rejects invalid melds, duplicate physical IDs, and invalid hand sizes", () => {
    const windChow: DeclaredMeld = {
      concealed: false,
      kind: "chow",
      tiles: tiles("east", "south", "west"),
    };
    const duplicate = { id: "same", type: "d1" } as const;

    expect(isLegalMeld(windChow)).toBe(false);
    expect(findWinningDecomposition([duplicate, duplicate])).toBeNull();
    expect(findWinningDecomposition(tiles("d1", "d1", "d2"))).toBeNull();
  });
});
