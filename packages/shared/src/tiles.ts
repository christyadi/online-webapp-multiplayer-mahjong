import { z } from "zod";

export const TILE_TYPES = [
  "d1",
  "d2",
  "d3",
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
  "b6",
  "b7",
  "b8",
  "b9",
  "c1",
  "c2",
  "c3",
  "c4",
  "c5",
  "c6",
  "c7",
  "c8",
  "c9",
  "east",
  "south",
  "west",
  "north",
  "red",
  "green",
  "white",
] as const;

export type TileType = (typeof TILE_TYPES)[number];
export type TileSuit = "dots" | "bamboo" | "characters";
export type TileRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type PhysicalTile = Readonly<{
  id: string;
  type: TileType;
}>;

export const tileTypeSchema = z.enum(TILE_TYPES);
export const physicalTileSchema = z.object({
  id: z.string().min(1).max(64),
  type: tileTypeSchema,
});

const TILE_TYPE_INDEX = new Map(TILE_TYPES.map((type, index) => [type, index]));

export function tileTypeIndex(type: TileType): number {
  const index = TILE_TYPE_INDEX.get(type);
  if (index === undefined) throw new Error(`Unknown tile type: ${type}`);
  return index;
}

export function suitedTileDetails(
  type: TileType,
): Readonly<{ rank: TileRank; suit: TileSuit }> | null {
  const index = tileTypeIndex(type);
  if (index >= 27) return null;

  const suitIndex = Math.floor(index / 9);
  const suit: TileSuit = suitIndex === 0 ? "dots" : suitIndex === 1 ? "bamboo" : "characters";
  return { rank: ((index % 9) + 1) as TileRank, suit };
}
