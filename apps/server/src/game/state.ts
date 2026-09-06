import {
  TILE_TYPES,
  suitedTileDetails,
  tileTypeIndex,
  type PhysicalTile,
  type TileType,
} from "@mahjong-together/shared";

import { findWinningDecomposition, type DeclaredMeld, type WinningDecomposition } from "./hand.js";
import { dealInitialTiles, type SeatIndex } from "./wall.js";

export type TurnOrigin = "dealer-initial" | "draw" | "replacement" | "claim";

export type PlayerHandState = {
  concealed: PhysicalTile[];
  discards: PhysicalTile[];
  melds: DeclaredMeld[];
};

type HandBase = {
  dealer: SeatIndex;
  decisionSequence: number;
  handId: string;
  players: [PlayerHandState, PlayerHandState, PlayerHandState, PlayerHandState];
  wall: PhysicalTile[];
};

export type AwaitingDiscardState = HandBase & {
  decisionId: string;
  drawnTileId?: string;
  phase: "awaiting-discard";
  turn: SeatIndex;
  turnOrigin: TurnOrigin;
};

export type ChowOption = Readonly<{ tileIds: readonly [string, string] }>;

export type LegalDiscardClaims = Readonly<{
  canKong: boolean;
  canPung: boolean;
  canWin: boolean;
  chows: readonly ChowOption[];
}>;

export type ClaimChoice =
  | Readonly<{ kind: "pass" }>
  | Readonly<{ kind: "win" }>
  | Readonly<{ kind: "pung" }>
  | Readonly<{ kind: "kong" }>
  | Readonly<{ kind: "chow"; tileIds: readonly [string, string] }>;

export type AwaitingDiscardClaimsState = HandBase & {
  decisionId: string;
  discard: Readonly<{ seat: SeatIndex; tileId: string }>;
  eligible: readonly Readonly<{ legal: LegalDiscardClaims; seat: SeatIndex }>[];
  phase: "awaiting-discard-claims";
  responses: Partial<Record<SeatIndex, ClaimChoice>>;
};

export type AwaitingKongRobberyState = HandBase & {
  decisionId: string;
  eligible: readonly SeatIndex[];
  phase: "awaiting-kong-robbery";
  proposal: Readonly<{ declarer: SeatIndex; meldIndex: number; tileId: string }>;
  responses: Partial<Record<SeatIndex, "pass" | "win">>;
};

export type WinSource = "self-draw" | "discard" | "robbed-added-kong";

export type HandEndedState = HandBase & {
  phase: "hand-ended";
  result:
    | Readonly<{ kind: "draw" }>
    | Readonly<{
        decomposition: WinningDecomposition;
        kind: "win";
        source: WinSource;
        tileId: string;
        winner: SeatIndex;
      }>;
};

export type HandState =
  AwaitingDiscardState | AwaitingDiscardClaimsState | AwaitingKongRobberyState | HandEndedState;

export type HandAction =
  | Readonly<{ decisionId: string; kind: "discard"; tileId: string }>
  | Readonly<{ decisionId: string; kind: "declare-self-win" }>
  | Readonly<{ decisionId: string; kind: "declare-concealed-kong"; tileType: TileType }>
  | Readonly<{
      decisionId: string;
      kind: "propose-added-kong";
      meldIndex: number;
      tileId: string;
    }>
  | Readonly<{ choice: ClaimChoice; decisionId: string; kind: "respond-to-discard" }>
  | Readonly<{
      choice: "pass" | "win";
      decisionId: string;
      kind: "respond-to-kong-robbery";
    }>;

export type HandEffect =
  | Readonly<{
      decisionId: string;
      phase: Exclude<HandState["phase"], "hand-ended">;
      type: "decision-started";
    }>
  | Readonly<{ result: HandEndedState["result"]; type: "hand-ended" }>;

export type TransitionResult =
  | Readonly<{ effects: readonly HandEffect[]; ok: true; state: HandState }>
  | Readonly<{ code: string; message: string; ok: false; state: HandState }>;

export function startHand(
  handId: string,
  dealer: SeatIndex,
  shuffledTiles: readonly PhysicalTile[],
): AwaitingDiscardState {
  const deal = dealInitialTiles(shuffledTiles, dealer);
  const base: HandBase = {
    dealer,
    decisionSequence: 1,
    handId,
    players: [
      { concealed: deal.hands[0], discards: [], melds: [] },
      { concealed: deal.hands[1], discards: [], melds: [] },
      { concealed: deal.hands[2], discards: [], melds: [] },
      { concealed: deal.hands[3], discards: [], melds: [] },
    ],
    wall: deal.wall,
  };
  const dealerHand = base.players[dealer].concealed;
  const drawnTile = dealerHand.at(-1);
  if (drawnTile === undefined) throw new Error("Dealer hand invariant failed");
  return {
    ...base,
    decisionId: decisionId(base),
    drawnTileId: drawnTile.id,
    phase: "awaiting-discard",
    turn: dealer,
    turnOrigin: "dealer-initial",
  };
}

export function transition(
  state: HandState,
  actor: SeatIndex,
  action: HandAction,
): TransitionResult {
  if (state.phase === "hand-ended") return rejected(state, "hand-ended", "The hand has ended");
  if (action.decisionId !== state.decisionId) {
    return rejected(state, "stale-decision", "This decision is no longer available");
  }

  const next = structuredClone(state);
  if (next.phase === "awaiting-discard") return transitionDiscardTurn(next, actor, action);
  if (next.phase === "awaiting-discard-claims") return transitionDiscardClaims(next, actor, action);
  return transitionKongRobbery(next, actor, action);
}

export function rotateDealer(dealer: SeatIndex): SeatIndex {
  return nextSeat(dealer);
}

function transitionDiscardTurn(
  state: AwaitingDiscardState,
  actor: SeatIndex,
  action: HandAction,
): TransitionResult {
  if (actor !== state.turn) return rejected(state, "wrong-seat", "It is another seat's turn");
  if (state.turnOrigin === "claim" && action.kind !== "discard") {
    return rejected(state, "wrong-action", "A chow or pung must be followed by a discard");
  }

  if (action.kind === "discard") return discardTile(state, action.tileId);
  if (action.kind === "declare-self-win") return declareSelfWin(state);
  if (action.kind === "declare-concealed-kong") return declareConcealedKong(state, action.tileType);
  if (action.kind === "propose-added-kong") {
    return proposeAddedKong(state, action.meldIndex, action.tileId);
  }
  return rejected(state, "wrong-action", "This action is not available during a discard turn");
}

function discardTile(state: AwaitingDiscardState, tileId: string): TransitionResult {
  const tile = removeTileById(state.players[state.turn].concealed, tileId);
  if (tile === null) return rejected(state, "missing-tile", "That tile is not in your hand");
  state.players[state.turn].discards.push(tile);

  const eligible = discardClaimOptions(state, state.turn, tile);
  if (eligible.length === 0) return accepted(advanceAfterUnclaimedDiscard(state, state.turn));

  const claims = advanceDecision(state);
  return accepted({
    ...copyHandBase(claims),
    decisionId: decisionId(claims),
    discard: { seat: state.turn, tileId: tile.id },
    eligible,
    phase: "awaiting-discard-claims",
    responses: {},
  });
}

function declareSelfWin(state: AwaitingDiscardState): TransitionResult {
  const decomposition = findWinningDecomposition(
    state.players[state.turn].concealed,
    state.players[state.turn].melds,
  );
  if (decomposition === null) return rejected(state, "not-winning", "The hand is not complete");
  const winningTile = state.drawnTileId;
  if (winningTile === undefined) throw new Error("Drawn tile invariant failed");
  return accepted(endWithWin(state, state.turn, winningTile, "self-draw", decomposition));
}

function declareConcealedKong(state: AwaitingDiscardState, tileType: TileType): TransitionResult {
  if (state.wall.length === 0) return rejected(state, "empty-wall", "No replacement tile remains");
  const matching = state.players[state.turn].concealed.filter((tile) => tile.type === tileType);
  if (matching.length !== 4)
    return rejected(state, "illegal-kong", "Four matching tiles are required");

  const ids = new Set(matching.map((tile) => tile.id));
  state.players[state.turn].concealed = state.players[state.turn].concealed.filter(
    (tile) => !ids.has(tile.id),
  );
  state.players[state.turn].melds.push({ concealed: true, kind: "kong", tiles: matching });
  return accepted(drawReplacement(state, state.turn));
}

function proposeAddedKong(
  state: AwaitingDiscardState,
  meldIndex: number,
  tileId: string,
): TransitionResult {
  if (state.wall.length === 0) return rejected(state, "empty-wall", "No replacement tile remains");
  const player = state.players[state.turn];
  const meld = player.melds[meldIndex];
  const tile = player.concealed.find((candidate) => candidate.id === tileId);
  if (
    meld?.kind !== "pung" ||
    meld.concealed ||
    tile === undefined ||
    meld.tiles[0]?.type !== tile.type
  ) {
    return rejected(state, "illegal-kong", "That exposed pung cannot be upgraded with this tile");
  }

  const eligible = otherSeats(state.turn).filter((seat) => canWinWith(state.players[seat], tile));
  if (eligible.length === 0) return accepted(commitAddedKong(state, state.turn, meldIndex, tileId));

  const robbery = advanceDecision(state);
  return accepted({
    ...copyHandBase(robbery),
    decisionId: decisionId(robbery),
    eligible,
    phase: "awaiting-kong-robbery",
    proposal: { declarer: state.turn, meldIndex, tileId },
    responses: {},
  });
}

function transitionDiscardClaims(
  state: AwaitingDiscardClaimsState,
  actor: SeatIndex,
  action: HandAction,
): TransitionResult {
  if (action.kind !== "respond-to-discard") {
    return rejected(state, "wrong-action", "Only a claim or pass is available");
  }
  const offer = state.eligible.find((candidate) => candidate.seat === actor);
  if (offer === undefined) return rejected(state, "not-eligible", "This seat has no legal claim");
  if (state.responses[actor] !== undefined) {
    return rejected(state, "already-responded", "This seat already responded");
  }
  if (!isLegalClaimChoice(action.choice, offer.legal)) {
    return rejected(state, "illegal-claim", "That claim is not available");
  }

  state.responses[actor] = copyClaimChoice(action.choice);
  if (!state.eligible.every(({ seat }) => state.responses[seat] !== undefined))
    return acceptedWithoutEffect(state);
  return accepted(resolveDiscardClaims(state));
}

function transitionKongRobbery(
  state: AwaitingKongRobberyState,
  actor: SeatIndex,
  action: HandAction,
): TransitionResult {
  if (action.kind !== "respond-to-kong-robbery") {
    return rejected(state, "wrong-action", "Only win or pass is available");
  }
  if (!state.eligible.includes(actor))
    return rejected(state, "not-eligible", "This seat cannot rob the kong");
  if (state.responses[actor] !== undefined) {
    return rejected(state, "already-responded", "This seat already responded");
  }

  state.responses[actor] = action.choice;
  if (!state.eligible.every((seat) => state.responses[seat] !== undefined)) {
    return acceptedWithoutEffect(state);
  }
  return accepted(resolveKongRobbery(state));
}

function resolveDiscardClaims(state: AwaitingDiscardClaimsState): HandState {
  const responses = state.eligible
    .map(({ seat }) => ({ choice: state.responses[seat], seat }))
    .filter(
      (response): response is { choice: Exclude<ClaimChoice, { kind: "pass" }>; seat: SeatIndex } =>
        response.choice !== undefined && response.choice.kind !== "pass",
    )
    .sort((left, right) => {
      const priority = claimPriority(right.choice) - claimPriority(left.choice);
      return priority !== 0
        ? priority
        : seatDistance(state.discard.seat, left.seat) -
            seatDistance(state.discard.seat, right.seat);
    });
  const selected = responses[0];
  if (selected === undefined) return advanceAfterUnclaimedDiscard(state, state.discard.seat);

  const tile = transferDiscard(state, state.discard.seat, state.discard.tileId);
  const claimant = state.players[selected.seat];
  if (selected.choice.kind === "win") {
    claimant.concealed.push(tile);
    const decomposition = findWinningDecomposition(claimant.concealed, claimant.melds);
    if (decomposition === null) throw new Error("Winning claim invariant failed");
    return endWithWin(state, selected.seat, tile.id, "discard", decomposition);
  }
  if (selected.choice.kind === "pung") {
    claimant.melds.push({
      concealed: false,
      kind: "pung",
      tiles: [...takeType(claimant, tile.type, 2), tile],
    });
    return beginDiscard(state, selected.seat, "claim");
  }
  if (selected.choice.kind === "kong") {
    claimant.melds.push({
      concealed: false,
      kind: "kong",
      tiles: [...takeType(claimant, tile.type, 3), tile],
    });
    return drawReplacement(state, selected.seat);
  }

  const ownTiles = selected.choice.tileIds.map((tileId) => removeRequiredTile(claimant, tileId));
  claimant.melds.push({ concealed: false, kind: "chow", tiles: [...ownTiles, tile] });
  return beginDiscard(state, selected.seat, "claim");
}

function resolveKongRobbery(state: AwaitingKongRobberyState): HandState {
  const winners = state.eligible
    .filter((seat) => state.responses[seat] === "win")
    .sort(
      (left, right) =>
        seatDistance(state.proposal.declarer, left) - seatDistance(state.proposal.declarer, right),
    );
  const winner = winners[0];
  if (winner === undefined) {
    return commitAddedKong(
      state,
      state.proposal.declarer,
      state.proposal.meldIndex,
      state.proposal.tileId,
    );
  }

  const tile = removeRequiredTile(state.players[state.proposal.declarer], state.proposal.tileId);
  state.players[winner].concealed.push(tile);
  const decomposition = findWinningDecomposition(
    state.players[winner].concealed,
    state.players[winner].melds,
  );
  if (decomposition === null) throw new Error("Robbed-kong win invariant failed");
  return endWithWin(state, winner, tile.id, "robbed-added-kong", decomposition);
}

function commitAddedKong(
  state: HandBase,
  declarer: SeatIndex,
  meldIndex: number,
  tileId: string,
): AwaitingDiscardState {
  const player = state.players[declarer];
  const meld = player.melds[meldIndex];
  if (meld?.kind !== "pung") throw new Error("Added-kong meld invariant failed");
  const tile = removeRequiredTile(player, tileId);
  player.melds[meldIndex] = { concealed: false, kind: "kong", tiles: [...meld.tiles, tile] };
  return drawReplacement(state, declarer);
}

function drawReplacement(state: HandBase, seat: SeatIndex): AwaitingDiscardState {
  const tile = state.wall.pop();
  if (tile === undefined) throw new Error("Replacement wall invariant failed");
  state.players[seat].concealed.push(tile);
  return beginDiscard(state, seat, "replacement", tile.id);
}

function advanceAfterUnclaimedDiscard(state: HandBase, discarder: SeatIndex): HandState {
  if (state.wall.length === 0) return endWithDraw(state);
  const seat = nextSeat(discarder);
  const tile = state.wall.shift();
  if (tile === undefined) throw new Error("Wall draw invariant failed");
  state.players[seat].concealed.push(tile);
  return beginDiscard(state, seat, "draw", tile.id);
}

function beginDiscard(
  state: HandBase,
  turn: SeatIndex,
  turnOrigin: TurnOrigin,
  drawnTileId?: string,
): AwaitingDiscardState {
  const next = advanceDecision(state);
  return {
    ...copyHandBase(next),
    decisionId: decisionId(next),
    ...(drawnTileId === undefined ? {} : { drawnTileId }),
    phase: "awaiting-discard",
    turn,
    turnOrigin,
  };
}

function endWithWin(
  state: HandBase,
  winner: SeatIndex,
  tileId: string,
  source: WinSource,
  decomposition: WinningDecomposition,
): HandEndedState {
  return {
    ...copyHandBase(state),
    phase: "hand-ended",
    result: { decomposition, kind: "win", source, tileId, winner },
  };
}

function endWithDraw(state: HandBase): HandEndedState {
  return { ...copyHandBase(state), phase: "hand-ended", result: { kind: "draw" } };
}

function copyHandBase(state: HandBase): HandBase {
  return {
    dealer: state.dealer,
    decisionSequence: state.decisionSequence,
    handId: state.handId,
    players: state.players,
    wall: state.wall,
  };
}

function discardClaimOptions(
  state: HandBase,
  discarder: SeatIndex,
  tile: PhysicalTile,
): AwaitingDiscardClaimsState["eligible"] {
  return otherSeats(discarder).flatMap((seat) => {
    const player = state.players[seat];
    const sameTypeCount = player.concealed.filter(
      (candidate) => candidate.type === tile.type,
    ).length;
    const legal: LegalDiscardClaims = {
      canKong: state.wall.length > 0 && sameTypeCount >= 3,
      canPung: state.wall.length > 0 && sameTypeCount >= 2,
      canWin: canWinWith(player, tile),
      chows: state.wall.length > 0 && seat === nextSeat(discarder) ? chowOptions(player, tile) : [],
    };
    return legal.canKong || legal.canPung || legal.canWin || legal.chows.length > 0
      ? [{ legal, seat }]
      : [];
  });
}

function chowOptions(player: PlayerHandState, discard: PhysicalTile): ChowOption[] {
  const details = suitedTileDetails(discard.type);
  if (details === null) return [];
  const discardIndex = tileTypeIndex(discard.type);
  const suitStart = discardIndex - (details.rank - 1);
  const options: ChowOption[] = [];

  for (
    let startRank = Math.max(1, details.rank - 2);
    startRank <= Math.min(7, details.rank);
    startRank += 1
  ) {
    const sequence = [startRank, startRank + 1, startRank + 2]
      .filter((rank) => rank !== details.rank)
      .map((rank) => TILE_TYPES[suitStart + rank - 1]);
    const firstType = sequence[0];
    const secondType = sequence[1];
    if (firstType === undefined || secondType === undefined)
      throw new Error("Chow type invariant failed");
    const first = player.concealed.find((tile) => tile.type === firstType);
    const second = player.concealed.find((tile) => tile.type === secondType);
    if (first !== undefined && second !== undefined)
      options.push({ tileIds: [first.id, second.id] });
  }
  return options;
}

function canWinWith(player: PlayerHandState, tile: PhysicalTile): boolean {
  return findWinningDecomposition([...player.concealed, tile], player.melds) !== null;
}

function isLegalClaimChoice(choice: ClaimChoice, legal: LegalDiscardClaims): boolean {
  if (choice.kind === "pass") return true;
  if (choice.kind === "win") return legal.canWin;
  if (choice.kind === "pung") return legal.canPung;
  if (choice.kind === "kong") return legal.canKong;
  return legal.chows.some((option) =>
    option.tileIds.every((tileId) => choice.tileIds.includes(tileId)),
  );
}

function copyClaimChoice(choice: ClaimChoice): ClaimChoice {
  if (choice.kind === "chow") {
    return { kind: "chow", tileIds: [choice.tileIds[0], choice.tileIds[1]] };
  }
  return { kind: choice.kind };
}

function claimPriority(choice: Exclude<ClaimChoice, { kind: "pass" }>): number {
  if (choice.kind === "win") return 3;
  if (choice.kind === "chow") return 1;
  return 2;
}

function transferDiscard(state: HandBase, seat: SeatIndex, tileId: string): PhysicalTile {
  const tile = removeTileById(state.players[seat].discards, tileId);
  if (tile === null) throw new Error("Pending discard invariant failed");
  return tile;
}

function takeType(player: PlayerHandState, type: TileType, count: number): PhysicalTile[] {
  const matching = player.concealed
    .filter((tile) => tile.type === type)
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, count);
  if (matching.length !== count) throw new Error("Claim tile invariant failed");
  const ids = new Set(matching.map((tile) => tile.id));
  player.concealed = player.concealed.filter((tile) => !ids.has(tile.id));
  return matching;
}

function removeRequiredTile(player: PlayerHandState, tileId: string): PhysicalTile {
  const tile = removeTileById(player.concealed, tileId);
  if (tile === null) throw new Error("Required tile invariant failed");
  return tile;
}

function removeTileById(tiles: PhysicalTile[], tileId: string): PhysicalTile | null {
  const index = tiles.findIndex((tile) => tile.id === tileId);
  if (index === -1) return null;
  const removed = tiles.splice(index, 1)[0];
  if (removed === undefined) throw new Error("Tile removal invariant failed");
  return removed;
}

function accepted(state: HandState): TransitionResult {
  const effects: HandEffect[] =
    state.phase === "hand-ended"
      ? [{ result: state.result, type: "hand-ended" }]
      : [{ decisionId: state.decisionId, phase: state.phase, type: "decision-started" }];
  return { effects, ok: true, state };
}

function acceptedWithoutEffect(state: HandState): TransitionResult {
  return { effects: [], ok: true, state };
}

function rejected(state: HandState, code: string, message: string): TransitionResult {
  return { code, message, ok: false, state };
}

function advanceDecision<T extends HandBase>(state: T): T {
  state.decisionSequence += 1;
  return state;
}

function decisionId(state: HandBase): string {
  return `${state.handId}:${String(state.decisionSequence)}`;
}

function nextSeat(seat: SeatIndex): SeatIndex {
  return ((seat + 1) % 4) as SeatIndex;
}

function otherSeats(seat: SeatIndex): SeatIndex[] {
  return [nextSeat(seat), nextSeat(nextSeat(seat)), nextSeat(nextSeat(nextSeat(seat)))];
}

function seatDistance(from: SeatIndex, to: SeatIndex): number {
  return (to - from + 4) % 4;
}
