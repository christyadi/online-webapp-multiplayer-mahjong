import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TILE_ARTWORK,
  parseTileArtworkPreference,
  persistTileArtworkPreference,
  readTileArtworkPreference,
  TILE_ARTWORK_STORAGE_KEY,
} from "./tile-art-preference.js";

describe("tile artwork preference", () => {
  it("uses Chinese Classical for missing or malformed values", () => {
    expect(parseTileArtworkPreference(null)).toBe(DEFAULT_TILE_ARTWORK);
    expect(parseTileArtworkPreference("unknown-style")).toBe(DEFAULT_TILE_ARTWORK);
  });

  it("accepts both shipped local preferences", () => {
    expect(parseTileArtworkPreference("chinese-classical")).toBe("chinese-classical");
    expect(parseTileArtworkPreference("classic")).toBe("classic");
  });

  it("reads and writes safely when browser storage is unavailable", () => {
    const storage = { getItem: vi.fn(() => "classic"), setItem: vi.fn() };
    expect(readTileArtworkPreference(storage)).toBe("classic");
    persistTileArtworkPreference(storage, "classic");
    expect(storage.setItem).toHaveBeenCalledWith(TILE_ARTWORK_STORAGE_KEY, "classic");

    const unavailable = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };
    expect(readTileArtworkPreference(unavailable)).toBe(DEFAULT_TILE_ARTWORK);
    expect(() => persistTileArtworkPreference(unavailable, "classic")).not.toThrow();
  });
});
