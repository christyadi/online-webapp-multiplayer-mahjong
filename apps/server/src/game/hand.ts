import {
  TILE_TYPES,
  suitedTileDetails,
  tileTypeIndex,
  type PhysicalTile,
  type TileType,
} from "@mahjong-together/shared";

export type MeldKind = "chow" | "pung" | "kong";

export type DeclaredMeld = Readonly<{
  concealed: boolean;
  kind: MeldKind;
  tiles: readonly PhysicalTile[];
}>;

export type WinningSet = Readonly<{
  declared: boolean;
  kind: MeldKind;
  tiles: readonly PhysicalTile[];
}>;

export type WinningDecomposition =
  | Readonly<{
      kind: "normal";
      pair: readonly [PhysicalTile, PhysicalTile];
      sets: readonly WinningSet[];
    }>
  | Readonly<{
      kind: "seven-pairs";
      pairs: readonly (readonly [PhysicalTile, PhysicalTile])[];
    }>;

type ConcealedSet = Readonly<{
  kind: "chow" | "pung";
  types: readonly [TileType, TileType, TileType];
}>;

export function findWinningDecomposition(
  concealedTiles: readonly PhysicalTile[],
  declaredMelds: readonly DeclaredMeld[] = [],
): WinningDecomposition | null {
  if (!hasValidPhysicalTiles(concealedTiles, declaredMelds)) return null;

  if (declaredMelds.length === 0) {
    const sevenPairs = findSevenPairs(concealedTiles);
    if (sevenPairs !== null) return sevenPairs;
  }

  if (declaredMelds.length > 4 || declaredMelds.some((meld) => !isLegalMeld(meld))) return null;
  const concealedSetCount = 4 - declaredMelds.length;
  if (concealedTiles.length !== concealedSetCount * 3 + 2) return null;

  const counts = countTileTypes(concealedTiles);
  for (let pairIndex = 0; pairIndex < counts.length; pairIndex += 1) {
    const count = counts[pairIndex];
    const pairType = TILE_TYPES[pairIndex];
    if (count === undefined || count < 2 || pairType === undefined) continue;

    adjustCount(counts, pairIndex, -2);
    const concealedSets = findSets(counts, concealedSetCount, new Map());
    adjustCount(counts, pairIndex, 2);
    if (concealedSets !== null) {
      return materializeNormalHand(concealedTiles, pairType, concealedSets, declaredMelds);
    }
  }

  return null;
}

export function isLegalMeld(meld: DeclaredMeld): boolean {
  if (new Set(meld.tiles.map((tile) => tile.id)).size !== meld.tiles.length) return false;
  if (meld.concealed && meld.kind !== "kong") return false;
  if (meld.kind === "kong") return isIdenticalSet(meld.tiles, 4);
  if (meld.kind === "pung") return isIdenticalSet(meld.tiles, 3);
  if (meld.tiles.length !== 3) return false;

  const details = meld.tiles.map((tile) => suitedTileDetails(tile.type));
  if (details.some((detail) => detail === null)) return false;
  const suited = details.filter((detail) => detail !== null);
  return (
    suited.length === 3 &&
    suited.every((detail) => detail.suit === suited[0]?.suit) &&
    suited
      .map((detail) => detail.rank)
      .sort((left, right) => left - right)
      .every((rank, index, ranks) => index === 0 || rank === (ranks[index - 1] ?? 0) + 1)
  );
}

function findSevenPairs(concealedTiles: readonly PhysicalTile[]): WinningDecomposition | null {
  if (concealedTiles.length !== 14) return null;

  const groups = groupTiles(concealedTiles);
  if (groups.size !== 7 || [...groups.values()].some((tiles) => tiles.length !== 2)) return null;

  const pairs = [...groups.entries()]
    .sort(([left], [right]) => tileTypeIndex(left) - tileTypeIndex(right))
    .map(([, tiles]) => {
      const first = tiles[0];
      const second = tiles[1];
      if (first === undefined || second === undefined)
        throw new Error("Seven-pairs invariant failed");
      return [first, second] as const;
    });
  return { kind: "seven-pairs", pairs };
}

function findSets(
  counts: number[],
  setsRemaining: number,
  memo: Map<string, ConcealedSet[] | null>,
): ConcealedSet[] | null {
  const key = `${String(setsRemaining)}:${counts.join(",")}`;
  if (memo.has(key)) return memo.get(key) ?? null;

  const firstIndex = counts.findIndex((count) => count > 0);
  if (setsRemaining === 0 || firstIndex === -1) {
    const result = setsRemaining === 0 && firstIndex === -1 ? [] : null;
    memo.set(key, result);
    return result;
  }

  const firstType = TILE_TYPES[firstIndex];
  if (firstType === undefined) throw new Error("Tile count index invariant failed");

  if ((counts[firstIndex] ?? 0) >= 3) {
    adjustCount(counts, firstIndex, -3);
    const rest = findSets(counts, setsRemaining - 1, memo);
    adjustCount(counts, firstIndex, 3);
    if (rest !== null) {
      const result: ConcealedSet[] = [
        { kind: "pung", types: [firstType, firstType, firstType] },
        ...rest,
      ];
      memo.set(key, result);
      return result;
    }
  }

  const rankOffset = firstIndex % 9;
  if (firstIndex < 27 && rankOffset <= 6) {
    const secondIndex = firstIndex + 1;
    const thirdIndex = firstIndex + 2;
    if ((counts[secondIndex] ?? 0) > 0 && (counts[thirdIndex] ?? 0) > 0) {
      const secondType = TILE_TYPES[secondIndex];
      const thirdType = TILE_TYPES[thirdIndex];
      if (secondType === undefined || thirdType === undefined) {
        throw new Error("Sequence index invariant failed");
      }

      adjustCount(counts, firstIndex, -1);
      adjustCount(counts, secondIndex, -1);
      adjustCount(counts, thirdIndex, -1);
      const rest = findSets(counts, setsRemaining - 1, memo);
      adjustCount(counts, firstIndex, 1);
      adjustCount(counts, secondIndex, 1);
      adjustCount(counts, thirdIndex, 1);
      if (rest !== null) {
        const result: ConcealedSet[] = [
          { kind: "chow", types: [firstType, secondType, thirdType] },
          ...rest,
        ];
        memo.set(key, result);
        return result;
      }
    }
  }

  memo.set(key, null);
  return null;
}

function materializeNormalHand(
  concealedTiles: readonly PhysicalTile[],
  pairType: TileType,
  concealedSets: readonly ConcealedSet[],
  declaredMelds: readonly DeclaredMeld[],
): WinningDecomposition {
  const groups = groupTiles(concealedTiles);
  const take = (type: TileType, count: number): PhysicalTile[] => {
    const group = groups.get(type);
    if (group === undefined || group.length < count)
      throw new Error("Decomposition invariant failed");
    return group.splice(0, count);
  };

  const pairTiles = take(pairType, 2);
  const pairFirst = pairTiles[0];
  const pairSecond = pairTiles[1];
  if (pairFirst === undefined || pairSecond === undefined) throw new Error("Pair invariant failed");

  const declaredSets: WinningSet[] = declaredMelds.map((meld) => ({
    declared: true,
    kind: meld.kind,
    tiles: [...meld.tiles],
  }));
  const privateSets: WinningSet[] = concealedSets.map((set) => ({
    declared: false,
    kind: set.kind,
    tiles: set.types.flatMap((type) => take(type, 1)),
  }));

  return { kind: "normal", pair: [pairFirst, pairSecond], sets: [...declaredSets, ...privateSets] };
}

function hasValidPhysicalTiles(
  concealedTiles: readonly PhysicalTile[],
  declaredMelds: readonly DeclaredMeld[],
): boolean {
  const allTiles = [...concealedTiles, ...declaredMelds.flatMap((meld) => meld.tiles)];
  if (new Set(allTiles.map((tile) => tile.id)).size !== allTiles.length) return false;

  const counts = countTileTypes(allTiles);
  return counts.every((count) => count <= 4);
}

function countTileTypes(tiles: readonly PhysicalTile[]): number[] {
  const counts = Array.from({ length: TILE_TYPES.length }, () => 0);
  for (const tile of tiles) adjustCount(counts, tileTypeIndex(tile.type), 1);
  return counts;
}

function adjustCount(counts: number[], index: number, change: number): void {
  const count = counts[index];
  if (count === undefined) throw new Error("Tile count index invariant failed");
  counts[index] = count + change;
}

function groupTiles(tiles: readonly PhysicalTile[]): Map<TileType, PhysicalTile[]> {
  const groups = new Map<TileType, PhysicalTile[]>();
  for (const tile of tiles) {
    const group = groups.get(tile.type) ?? [];
    group.push(tile);
    group.sort((left, right) => left.id.localeCompare(right.id));
    groups.set(tile.type, group);
  }
  return groups;
}

function isIdenticalSet(tiles: readonly PhysicalTile[], length: number): boolean {
  const first = tiles[0];
  return (
    tiles.length === length &&
    first !== undefined &&
    tiles.every((tile) => tile.type === first.type)
  );
}
