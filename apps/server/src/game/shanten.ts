import { TILE_TYPES, tileTypeIndex, type PhysicalTile } from "@mahjong-together/shared";
import type { DeclaredMeld } from "./hand.js";

type BlockSearchResult = Readonly<{ sets: number; partials: number }>;

function countTileTypes(tiles: readonly PhysicalTile[]): number[] {
  const counts = Array.from({ length: TILE_TYPES.length }, () => 0);
  for (const tile of tiles) {
    const index = tileTypeIndex(tile.type);
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
}

function blockScore(result: BlockSearchResult, needSets: number): number {
  const cappedPartials = Math.min(result.partials, Math.max(0, needSets - result.sets));
  return result.sets * 2 + cappedPartials;
}

function bestBlocks(
  counts: number[],
  needSets: number,
  memo: Map<string, BlockSearchResult>,
): BlockSearchResult {
  const key = counts.join(",");
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  const firstIndex = counts.findIndex((count) => count > 0);
  if (firstIndex === -1) return { sets: 0, partials: 0 };

  let best: BlockSearchResult = { sets: 0, partials: 0 };
  const consider = (candidate: BlockSearchResult): void => {
    if (blockScore(candidate, needSets) > blockScore(best, needSets)) best = candidate;
  };

  // Treat this type as unused (floater) and move on.
  {
    const skipped = counts.slice();
    skipped[firstIndex] = 0;
    consider(bestBlocks(skipped, needSets, memo));
  }

  const count = counts[firstIndex] ?? 0;

  if (count >= 3) {
    const next = counts.slice();
    next[firstIndex] = (next[firstIndex] ?? 0) - 3;
    const rest = bestBlocks(next, needSets, memo);
    consider({ sets: rest.sets + 1, partials: rest.partials });
  }
  if (count >= 2) {
    const next = counts.slice();
    next[firstIndex] = (next[firstIndex] ?? 0) - 2;
    const rest = bestBlocks(next, needSets, memo);
    consider({ sets: rest.sets, partials: rest.partials + 1 });
  }

  const rankOffset = firstIndex % 9;
  const isSuited = firstIndex < 27; // 27 suited + 7 honors, per confirmed TILE_TYPES layout
  if (
    isSuited &&
    rankOffset <= 6 &&
    (counts[firstIndex + 1] ?? 0) > 0 &&
    (counts[firstIndex + 2] ?? 0) > 0
  ) {
    const next = counts.slice();
    next[firstIndex] = (next[firstIndex] ?? 0) - 1;
    next[firstIndex + 1] = (next[firstIndex + 1] ?? 0) - 1;
    next[firstIndex + 2] = (next[firstIndex + 2] ?? 0) - 1;
    const rest = bestBlocks(next, needSets, memo);
    consider({ sets: rest.sets + 1, partials: rest.partials });
  }
  if (isSuited && rankOffset <= 6 && (counts[firstIndex + 2] ?? 0) > 0) {
    const next = counts.slice(); // kanchan: X _ X
    next[firstIndex] = (next[firstIndex] ?? 0) - 1;
    next[firstIndex + 2] = (next[firstIndex + 2] ?? 0) - 1;
    const rest = bestBlocks(next, needSets, memo);
    consider({ sets: rest.sets, partials: rest.partials + 1 });
  }
  if (isSuited && rankOffset <= 7 && (counts[firstIndex + 1] ?? 0) > 0) {
    const next = counts.slice(); // ryanmen/penchan: X X
    next[firstIndex] = (next[firstIndex] ?? 0) - 1;
    next[firstIndex + 1] = (next[firstIndex + 1] ?? 0) - 1;
    const rest = bestBlocks(next, needSets, memo);
    consider({ sets: rest.sets, partials: rest.partials + 1 });
  }

  memo.set(key, best);
  return best;
}

export function standardShanten(
  concealedTiles: readonly PhysicalTile[],
  declaredMelds: readonly DeclaredMeld[] = [],
): number {
  const needSets = 4 - declaredMelds.length;
  const counts = countTileTypes(concealedTiles);

  let best = Infinity;
  const evaluate = (working: number[], hasPair: boolean): void => {
    const { sets, partials } = bestBlocks(working, needSets, new Map());
    const capped = Math.min(partials, Math.max(0, needSets - sets));
    const value = needSets * 2 - sets * 2 - capped - (hasPair ? 1 : 0);
    best = Math.min(best, value);
  };

  evaluate(counts.slice(), false);
  for (let index = 0; index < counts.length; index += 1) {
    if ((counts[index] ?? 0) < 2) continue;
    const withoutPair = counts.slice();
    withoutPair[index] = (withoutPair[index] ?? 0) - 2;
    evaluate(withoutPair, true);
  }
  return best;
}

export function sevenPairsShanten(concealedTiles: readonly PhysicalTile[]): number {
  const counts = countTileTypes(concealedTiles);
  const pairTypes = counts.filter((count) => count >= 2).length;
  const distinctTypes = counts.filter((count) => count >= 1).length;
  return 6 - pairTypes + Math.max(0, 7 - distinctTypes);
}

export function overallShanten(
  concealedTiles: readonly PhysicalTile[],
  declaredMelds: readonly DeclaredMeld[] = [],
): number {
  const standard = standardShanten(concealedTiles, declaredMelds);
  if (declaredMelds.length > 0) return standard;
  return Math.min(standard, sevenPairsShanten(concealedTiles));
}

/** Tile types that would reduce shanten by 1 if drawn/called, with a live-count estimate. */
export function ukeire(
  concealedTiles: readonly PhysicalTile[],
  declaredMelds: readonly DeclaredMeld[],
  liveCount: (type: (typeof TILE_TYPES)[number]) => number,
): ReadonlyMap<(typeof TILE_TYPES)[number], number> {
  const current = overallShanten(concealedTiles, declaredMelds);
  const result = new Map<(typeof TILE_TYPES)[number], number>();
  for (const type of TILE_TYPES) {
    const remaining = liveCount(type);
    if (remaining <= 0) continue;
    const trial = overallShanten([...concealedTiles, { id: "@probe", type }], declaredMelds);
    if (trial < current) result.set(type, remaining);
  }
  return result;
}
