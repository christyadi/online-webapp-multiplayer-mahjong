import { TILE_TYPES } from "@mahjong-together/shared";
import { describe, expect, it } from "vitest";

import { TILE_ARTWORK_REGISTRY, tileFaceDefinition, tileLabel } from "./tile-art.js";

describe("tile artwork", () => {
  it("defines one face for every game tile type in every style", () => {
    for (const faces of Object.values(TILE_ARTWORK_REGISTRY)) {
      expect(Object.keys(faces).sort()).toEqual([...TILE_TYPES].sort());
      for (const type of TILE_TYPES) expect(faces[type]).toBeDefined();
    }
  });

  it("maps both styles to their expected tile groups and honor treatments", () => {
    expect(tileFaceDefinition("d9")).toEqual({ kind: "dots", rank: 9 });
    expect(tileFaceDefinition("b1")).toEqual({ kind: "bamboo", rank: 1 });
    expect(tileFaceDefinition("c5")).toEqual({ kind: "characters", rank: 5 });
    expect(tileFaceDefinition("east")).toEqual({ kind: "honor", mark: "east" });
    expect(tileFaceDefinition("red")).toEqual({ kind: "honor", mark: "red" });
    expect(tileFaceDefinition("white")).toEqual({ kind: "white-dragon" });
    expect(tileFaceDefinition("c5", "classic")).toEqual({ kind: "characters", rank: 5 });
    expect(tileFaceDefinition("north", "classic")).toEqual({ kind: "honor", mark: "north" });
    expect(tileFaceDefinition("white", "classic")).toEqual({ kind: "white-dragon" });
  });

  it("keeps the English accessible tile labels", () => {
    expect(tileLabel("b1")).toBe("1 of bamboo · value 1");
    expect(tileLabel("east")).toBe("east wind · value 0");
    expect(tileLabel("white")).toBe("white dragon · value 0");
  });
});
