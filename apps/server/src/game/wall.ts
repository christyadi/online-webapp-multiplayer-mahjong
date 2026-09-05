import { randomInt } from "node:crypto";

import { TILE_TYPES, type PhysicalTile } from "@mahjong-together/shared";

export type SeatIndex = 0 | 1 | 2 | 3;
export type RandomIndex = (maxExclusive: number) => number;

export type InitialDeal = Readonly<{
  hands: readonly [PhysicalTile[], PhysicalTile[], PhysicalTile[], PhysicalTile[]];
  wall: PhysicalTile[];
}>;

export function createTileSet(): PhysicalTile[] {
  return TILE_TYPES.flatMap((type) =>
    Array.from({ length: 4 }, (_, copyIndex) => ({ id: `${type}-${String(copyIndex)}`, type })),
  );
}

export function shuffleTiles(
  tiles: readonly PhysicalTile[],
  randomIndex: RandomIndex = randomInt,
): PhysicalTile[] {
  const shuffled = [...tiles];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    if (!Number.isInteger(swapIndex) || swapIndex < 0 || swapIndex > index) {
      throw new RangeError(`Random index ${String(swapIndex)} is outside 0..${String(index)}`);
    }

    const current = shuffled[index];
    const swap = shuffled[swapIndex];
    if (current === undefined || swap === undefined)
      throw new Error("Shuffle index invariant failed");
    shuffled[index] = swap;
    shuffled[swapIndex] = current;
  }

  return shuffled;
}

export function dealInitialTiles(
  shuffledTiles: readonly PhysicalTile[],
  dealer: SeatIndex,
): InitialDeal {
  if (shuffledTiles.length < 53) throw new RangeError("At least 53 tiles are required to deal");

  const wall = [...shuffledTiles];
  const hands: [PhysicalTile[], PhysicalTile[], PhysicalTile[], PhysicalTile[]] = [[], [], [], []];

  for (let round = 0; round < 13; round += 1) {
    for (const hand of hands) hand.push(drawFront(wall));
  }
  hands[dealer].push(drawFront(wall));

  return { hands, wall };
}

function drawFront(wall: PhysicalTile[]): PhysicalTile {
  const tile = wall.shift();
  if (tile === undefined) throw new Error("Wall exhausted during initial deal");
  return tile;
}
