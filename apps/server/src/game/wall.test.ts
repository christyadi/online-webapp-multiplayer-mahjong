import { TILE_TYPES } from "@mahjong-together/shared";
import { describe, expect, it } from "vitest";

import { createTileSet, dealInitialTiles, shuffleTiles } from "./wall.js";

describe("tile set and wall", () => {
  it("creates 136 unique physical tiles with four of every type", () => {
    const tiles = createTileSet();

    expect(tiles).toHaveLength(136);
    expect(new Set(tiles.map((tile) => tile.id)).size).toBe(136);
    for (const type of TILE_TYPES) {
      expect(tiles.filter((tile) => tile.type === type)).toHaveLength(4);
    }
  });

  it("uses injected Fisher-Yates indexes without mutating the source", () => {
    const tiles = createTileSet().slice(0, 5);
    const sourceIds = tiles.map((tile) => tile.id);
    const shuffled = shuffleTiles(tiles, () => 0);

    expect(tiles.map((tile) => tile.id)).toEqual(sourceIds);
    expect(shuffled.map((tile) => tile.id)).toEqual([
      sourceIds[1],
      sourceIds[2],
      sourceIds[3],
      sourceIds[4],
      sourceIds[0],
    ]);
  });

  it("rejects an invalid injected random index", () => {
    expect(() => shuffleTiles(createTileSet().slice(0, 2), (maximum) => maximum)).toThrow(
      RangeError,
    );
  });

  it("deals 13 tiles to each seat, an extra dealer tile, and leaves 83", () => {
    const deal = dealInitialTiles(createTileSet(), 2);

    expect(deal.hands.map((hand) => hand.length)).toEqual([13, 13, 14, 13]);
    expect(deal.wall).toHaveLength(83);
    const allIds = [...deal.hands.flat(), ...deal.wall].map((tile) => tile.id);
    expect(new Set(allIds).size).toBe(136);
  });
});
