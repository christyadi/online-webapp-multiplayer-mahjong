import type { TileArtworkTheme } from "./tile-art.js";

export const TILE_ARTWORK_STORAGE_KEY = "mahjong-together:tile-artwork";
export const DEFAULT_TILE_ARTWORK: TileArtworkTheme = "chinese-classical";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function parseTileArtworkPreference(value: string | null): TileArtworkTheme {
  return value === "classic" || value === "chinese-classical" ? value : DEFAULT_TILE_ARTWORK;
}

export function readTileArtworkPreference(storage: PreferenceStorage | null): TileArtworkTheme {
  try {
    return parseTileArtworkPreference(storage?.getItem(TILE_ARTWORK_STORAGE_KEY) ?? null);
  } catch {
    return DEFAULT_TILE_ARTWORK;
  }
}

export function persistTileArtworkPreference(
  storage: PreferenceStorage | null,
  artwork: TileArtworkTheme,
): void {
  try {
    storage?.setItem(TILE_ARTWORK_STORAGE_KEY, artwork);
  } catch {
    // The selected style still applies during this session when storage is unavailable.
  }
}
