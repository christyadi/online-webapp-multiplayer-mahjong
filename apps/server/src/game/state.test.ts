import { TILE_TYPES, type PhysicalTile, type TileType } from "@mahjong-together/shared";
import { describe, expect, it } from "vitest";

import type { DeclaredMeld } from "./hand.js";
import {
  rotateDealer,
  startHand,
  transition,
  type AwaitingDiscardClaimsState,
  type AwaitingDiscardState,
  type AwaitingKongRobberyState,
  type ClaimChoice,
  type HandAction,
  type HandState,
  type PlayerHandState,
} from "./state.js";
import { createTileSet, type SeatIndex } from "./wall.js";

type MeldSetup = Readonly<{
  concealed: boolean;
  kind: DeclaredMeld["kind"];
  types: readonly TileType[];
}>;

type PlayerSetup = Readonly<{
  concealed?: readonly TileType[];
  melds?: readonly MeldSetup[];
}>;

const WAITING_FOR_D3: readonly TileType[] = [
  "d1",
  "d2",
  "b1",
  "b2",
  "b3",
  "c1",
  "c2",
  "c3",
  "east",
  "east",
  "east",
  "red",
  "red",
];

const OTHER_WAITING_FOR_D3: readonly TileType[] = [
  "d1",
  "d2",
  "b4",
  "b5",
  "b6",
  "c4",
  "c5",
  "c6",
  "south",
  "south",
  "south",
  "green",
  "green",
];

const WINNING_HAND: readonly TileType[] = [...WAITING_FOR_D3, "d3"];

describe("pure hand state machine", () => {
  it("starts with the dealer's extra tile and first discard decision", () => {
    const state = startHand("opening", 2, createTileSet());

    expect(state).toMatchObject({
      dealer: 2,
      decisionId: "opening:1",
      decisionSequence: 1,
      phase: "awaiting-discard",
      turn: 2,
      turnOrigin: "dealer-initial",
    });
    expect(state.players.map((player) => player.concealed.length)).toEqual([13, 13, 14, 13]);
    expect(state.wall).toHaveLength(83);
    assertOwnership(state);
    assertPhaseSizes(state);
  });

  it("rejects stale, wrong-seat, and missing-tile discards without mutating input", () => {
    const state = makeDiscardState({}, 0);
    const before = structuredClone(state);

    expectRejected(
      transition(state, 1, discardAction(state, state.players[0].concealed[0]?.id ?? "")),
      "wrong-seat",
    );
    expectRejected(
      transition(state, 0, { ...discardAction(state, "missing"), decisionId: "old" }),
      "stale-decision",
    );
    expectRejected(transition(state, 0, discardAction(state, "missing")), "missing-tile");
    expect(state).toEqual(before);
    assertOwnership(state);
  });

  it("allows an optional self-draw win, including when the wall is empty", () => {
    const state = emptyWall(makeDiscardState({ 0: { concealed: WINNING_HAND } }, 0));

    const ended = accept(
      transition(state, 0, { decisionId: state.decisionId, kind: "declare-self-win" }),
    );

    expect(ended.phase).toBe("hand-ended");
    if (ended.phase !== "hand-ended") throw new Error("Expected hand end");
    expect(ended.result).toMatchObject({ kind: "win", source: "self-draw", winner: 0 });
  });

  it("waits for every eligible discard response and resolves wins before melds by seat distance", () => {
    const resolveInOrder = (order: readonly SeatIndex[]): HandState => {
      const state = makeDiscardState(
        {
          0: { concealed: ["d3"] },
          1: { concealed: WAITING_FOR_D3 },
          2: { concealed: ["d3", "d3"] },
          3: { concealed: OTHER_WAITING_FOR_D3 },
        },
        0,
      );
      const discarded = state.players[0].concealed.find((tile) => tile.type === "d3");
      if (discarded === undefined) throw new Error("Missing test discard");
      let current = accept(transition(state, 0, discardAction(state, discarded.id)));
      if (current.phase !== "awaiting-discard-claims") throw new Error("Expected claims");
      const decisionId = current.decisionId;

      for (const seat of order) {
        if (current.phase !== "awaiting-discard-claims") break;
        const offer = current.eligible.find((candidate) => candidate.seat === seat);
        if (offer === undefined || current.responses[seat] !== undefined) continue;
        const choice: ClaimChoice = offer.legal.canWin
          ? { kind: "win" }
          : offer.legal.canPung
            ? { kind: "pung" }
            : { kind: "pass" };
        const result = transition(current, seat, {
          choice,
          decisionId: current.decisionId,
          kind: "respond-to-discard",
        });
        const submittedResponses = current.responses;
        if (
          current.eligible.some(
            ({ seat: other }) => other !== seat && !Object.hasOwn(submittedResponses, other),
          )
        ) {
          expect(result.ok && result.effects).toEqual([]);
        }
        current = accept(result);
      }
      current = finishDiscardClaims(current);
      expect(current.phase).toBe("hand-ended");
      if (current.phase !== "hand-ended" || current.result.kind !== "win") {
        throw new Error("Expected a discard win");
      }
      expect(current.result.winner).toBe(1);
      expect(current.result.source).toBe("discard");
      expect(current.decisionSequence).toBe(2);
      expect(decisionId).toBe("test-hand:2");
      return current;
    };

    resolveInOrder([2, 3, 1]);
    resolveInOrder([1, 3, 2]);
  });

  it("accepts one immutable response per seat and rejects an illegal claim", () => {
    const state = makeDiscardState(
      {
        0: { concealed: ["d3"] },
        1: { concealed: WAITING_FOR_D3 },
        2: { concealed: ["d3", "d3"] },
        3: { concealed: OTHER_WAITING_FOR_D3 },
      },
      0,
    );
    const d3 = requireType(state.players[0], "d3");
    const claims = requireDiscardClaims(accept(transition(state, 0, discardAction(state, d3.id))));
    const passed = accept(
      transition(claims, 1, {
        choice: { kind: "pass" },
        decisionId: claims.decisionId,
        kind: "respond-to-discard",
      }),
    );
    if (passed.phase !== "awaiting-discard-claims") throw new Error("Expected pending claims");

    expectRejected(
      transition(passed, 1, {
        choice: { kind: "win" },
        decisionId: passed.decisionId,
        kind: "respond-to-discard",
      }),
      "already-responded",
    );
    expectRejected(
      transition(passed, 2, {
        choice: { kind: "chow", tileIds: ["missing-a", "missing-b"] },
        decisionId: passed.decisionId,
        kind: "respond-to-discard",
      }),
      "illegal-claim",
    );
  });

  it("copies an accepted claim so later caller mutation cannot alter its resolution", () => {
    const state = makeDiscardState(
      {
        0: { concealed: ["d3"] },
        1: { concealed: ["d1", "d2", "d4", "d5"] },
        2: { concealed: ["d3", "d3"] },
      },
      0,
    );
    const d3 = requireType(state.players[0], "d3");
    const claims = requireDiscardClaims(accept(transition(state, 0, discardAction(state, d3.id))));
    const option = claims.eligible.find(({ seat }) => seat === 1)?.legal.chows[0];
    if (option === undefined) throw new Error("Missing chow test option");
    const originalTileIds: [string, string] = [option.tileIds[0], option.tileIds[1]];
    const submitted = { kind: "chow" as const, tileIds: [...originalTileIds] as [string, string] };
    const pending = accept(
      transition(claims, 1, {
        choice: submitted,
        decisionId: claims.decisionId,
        kind: "respond-to-discard",
      }),
    );
    if (pending.phase !== "awaiting-discard-claims") throw new Error("Expected pending claims");

    submitted.tileIds[0] = "mutated-after-acceptance";
    expect(pending.responses[1]).toEqual({ kind: "chow", tileIds: originalTileIds });
    expect(pending.responses[1]).not.toBe(submitted);

    const resolved = finishDiscardClaims(pending);
    expect(resolved).toMatchObject({ phase: "awaiting-discard", turn: 1, turnOrigin: "claim" });
  });

  it("draws from the wall front for the next seat after every claim passes", () => {
    const state = makeDiscardState({}, 0);
    const wallFront = state.wall[0];
    const discard = state.players[0].concealed[0];
    const afterDiscard = accept(transition(state, 0, discardAction(state, discard.id)));
    const afterPasses = finishDiscardClaims(afterDiscard);

    expect(afterPasses).toMatchObject({
      drawnTileId: wallFront.id,
      phase: "awaiting-discard",
      turn: 1,
      turnOrigin: "draw",
    });
    if (afterPasses.phase !== "awaiting-discard") throw new Error("Expected next draw");
    expect(afterPasses.players[1].concealed.some((tile) => tile.id === wallFront.id)).toBe(true);
    assertPhaseSizes(afterPasses);
  });

  it("pung and chow claims transfer one pending discard and require a discard without a draw", () => {
    const pungState = makeDiscardState(
      { 0: { concealed: ["white"] }, 2: { concealed: ["white", "white"] } },
      0,
    );
    const white = requireType(pungState.players[0], "white");
    const pungClaims = requireDiscardClaims(
      accept(transition(pungState, 0, discardAction(pungState, white.id))),
    );
    expect("drawnTileId" in pungClaims).toBe(false);
    const afterPung = finishDiscardClaims(pungClaims, { 2: { kind: "pung" } });

    expect(afterPung).toMatchObject({ phase: "awaiting-discard", turn: 2, turnOrigin: "claim" });
    if (afterPung.phase !== "awaiting-discard") throw new Error("Expected pung discard");
    expect(afterPung.players[2].melds.at(-1)?.kind).toBe("pung");
    expect(afterPung.players[2].melds.at(-1)?.tiles).toHaveLength(3);
    expect(afterPung.players[0].discards.some((tile) => tile.id === white.id)).toBe(false);
    expectRejected(
      transition(afterPung, 2, { decisionId: afterPung.decisionId, kind: "declare-self-win" }),
      "wrong-action",
    );
    expectRejected(
      transition(afterPung, 2, {
        decisionId: afterPung.decisionId,
        kind: "declare-concealed-kong",
        tileType: "d1",
      }),
      "wrong-action",
    );
    expectRejected(
      transition(afterPung, 2, {
        decisionId: afterPung.decisionId,
        kind: "propose-added-kong",
        meldIndex: 0,
        tileId: afterPung.players[2].concealed[0]?.id ?? "",
      }),
      "wrong-action",
    );
    expect("drawnTileId" in afterPung).toBe(false);
    assertDiscardSize(afterPung);

    const chowState = makeDiscardState(
      { 0: { concealed: ["d3"] }, 1: { concealed: ["d1", "d2", "d4", "d5"] } },
      0,
    );
    const d3 = requireType(chowState.players[0], "d3");
    const chowClaims = requireDiscardClaims(
      accept(transition(chowState, 0, discardAction(chowState, d3.id))),
    );
    const offer = chowClaims.eligible.find(({ seat }) => seat === 1);
    expect(offer?.legal.chows).toHaveLength(3);
    const chosen = offer?.legal.chows[1];
    if (chosen === undefined) throw new Error("Missing middle chow choice");
    const afterChow = finishDiscardClaims(chowClaims, {
      1: { kind: "chow", tileIds: chosen.tileIds },
    });

    expect(afterChow).toMatchObject({ phase: "awaiting-discard", turn: 1, turnOrigin: "claim" });
    if (afterChow.phase !== "awaiting-discard") throw new Error("Expected chow discard");
    expect(afterChow.players[1].melds.at(-1)?.kind).toBe("chow");
    assertDiscardSize(afterChow);
  });

  it("commits exposed and concealed kongs atomically and draws replacements from the back", () => {
    const exposed = makeDiscardState(
      { 0: { concealed: ["green"] }, 1: { concealed: ["green", "green", "green"] } },
      0,
      ["red"],
    );
    const exposedReplacementId = exposed.wall.at(-1)?.id;
    const green = requireType(exposed.players[0], "green");
    const claims = requireDiscardClaims(
      accept(transition(exposed, 0, discardAction(exposed, green.id))),
    );
    const afterExposed = finishDiscardClaims(claims, { 1: { kind: "kong" } });

    expect(afterExposed).toMatchObject({
      phase: "awaiting-discard",
      turn: 1,
      turnOrigin: "replacement",
    });
    if (afterExposed.phase !== "awaiting-discard")
      throw new Error("Expected exposed kong replacement");
    expect(afterExposed.drawnTileId).toBe(exposedReplacementId);
    expect(afterExposed.players[1].melds.at(-1)?.tiles).toHaveLength(4);
    assertDiscardSize(afterExposed);

    const concealed = makeDiscardState({ 0: { concealed: ["d9", "d9", "d9", "d9"] } }, 0, [
      "white",
    ]);
    const concealedReplacementId = concealed.wall.at(-1)?.id;
    const afterConcealed = accept(
      transition(concealed, 0, {
        decisionId: concealed.decisionId,
        kind: "declare-concealed-kong",
        tileType: "d9",
      }),
    );

    expect(afterConcealed).toMatchObject({
      phase: "awaiting-discard",
      turn: 0,
      turnOrigin: "replacement",
    });
    if (afterConcealed.phase !== "awaiting-discard")
      throw new Error("Expected concealed kong replacement");
    expect(afterConcealed.drawnTileId).toBe(concealedReplacementId);
    expect(afterConcealed.players[0].melds.at(-1)).toMatchObject({ concealed: true, kind: "kong" });
    assertDiscardSize(afterConcealed);
  });

  it("rejects any kong when no replacement tile remains", () => {
    const state = emptyWall(makeDiscardState({ 0: { concealed: ["d9", "d9", "d9", "d9"] } }, 0));

    expectRejected(
      transition(state, 0, {
        decisionId: state.decisionId,
        kind: "declare-concealed-kong",
        tileType: "d9",
      }),
      "empty-wall",
    );
  });

  it("rejects actions that are illegal for the current phase", () => {
    const state = makeDiscardState(
      {
        0: {
          concealed: [
            "d1",
            "d3",
            "d5",
            "d7",
            "d9",
            "b1",
            "b3",
            "b5",
            "b7",
            "b9",
            "c1",
            "c4",
            "east",
            "white",
          ],
        },
      },
      0,
    );

    expectRejected(
      transition(state, 0, { decisionId: state.decisionId, kind: "declare-self-win" }),
      "not-winning",
    );
    expectRejected(
      transition(state, 0, {
        decisionId: state.decisionId,
        kind: "declare-concealed-kong",
        tileType: "white",
      }),
      "illegal-kong",
    );
    expectRejected(
      transition(state, 0, {
        decisionId: state.decisionId,
        kind: "propose-added-kong",
        meldIndex: 0,
        tileId: state.players[0].concealed[0].id,
      }),
      "illegal-kong",
    );
    expectRejected(
      transition(state, 0, {
        choice: { kind: "pass" },
        decisionId: state.decisionId,
        kind: "respond-to-discard",
      }),
      "wrong-action",
    );
  });

  it("commits an unrobbed added kong, then allows further actions after its replacement draw", () => {
    const state = makeDiscardState(
      {
        0: {
          concealed: ["d9"],
          melds: [{ concealed: false, kind: "pung", types: ["d9", "d9", "d9"] }],
        },
      },
      0,
      ["white"],
    );
    const fourth = requireType(state.players[0], "d9");
    const replacementId = state.wall.at(-1)?.id;
    let current = accept(
      transition(state, 0, {
        decisionId: state.decisionId,
        kind: "propose-added-kong",
        meldIndex: 0,
        tileId: fourth.id,
      }),
    );
    if (current.phase === "awaiting-kong-robbery") current = finishRobbery(current);

    expect(current).toMatchObject({
      phase: "awaiting-discard",
      turn: 0,
      turnOrigin: "replacement",
    });
    if (current.phase !== "awaiting-discard") throw new Error("Expected added kong replacement");
    expect(current.drawnTileId).toBe(replacementId);
    expect(current.players[0].melds[0]).toMatchObject({ concealed: false, kind: "kong" });
    expect(current.players[0].melds[0]?.tiles).toHaveLength(4);
    assertDiscardSize(current);
  });

  it("lets the closest winner rob an added kong while retaining the original pung", () => {
    const state = makeDiscardState(
      {
        0: {
          concealed: ["d3"],
          melds: [{ concealed: false, kind: "pung", types: ["d3", "d3", "d3"] }],
        },
        2: { concealed: WAITING_FOR_D3 },
      },
      0,
    );
    const proposed = requireType(state.players[0], "d3");
    const robbery = accept(
      transition(state, 0, {
        decisionId: state.decisionId,
        kind: "propose-added-kong",
        meldIndex: 0,
        tileId: proposed.id,
      }),
    );
    if (robbery.phase !== "awaiting-kong-robbery") throw new Error("Expected robbery window");
    expect("drawnTileId" in robbery).toBe(false);
    expect(robbery.eligible).toContain(2);
    const ended = finishRobbery(robbery, { 2: "win" });

    expect(ended.phase).toBe("hand-ended");
    if (ended.phase !== "hand-ended" || ended.result.kind !== "win")
      throw new Error("Expected robbed win");
    expect(ended.result).toMatchObject({ source: "robbed-added-kong", winner: 2 });
    expect(ended.players[0].melds[0]).toMatchObject({ kind: "pung" });
    expect(ended.players[0].melds[0]?.tiles).toHaveLength(3);
    expect(ended.players[2].concealed.some((tile) => tile.id === proposed.id)).toBe(true);
  });

  it("ends in a draw after an unclaimed final discard and suppresses meld claims", () => {
    const state = emptyWall(
      makeDiscardState(
        {
          0: { concealed: ["white"] },
          1: {
            concealed: [
              "d1",
              "d4",
              "d7",
              "b1",
              "b4",
              "b7",
              "c1",
              "c4",
              "c7",
              "east",
              "south",
              "west",
              "north",
            ],
          },
          2: {
            concealed: [
              "d2",
              "d5",
              "d8",
              "b2",
              "b5",
              "b8",
              "c2",
              "c5",
              "c8",
              "east",
              "south",
              "red",
              "green",
            ],
          },
          3: {
            concealed: [
              "d3",
              "d6",
              "d9",
              "b3",
              "b6",
              "b9",
              "c3",
              "c6",
              "c9",
              "west",
              "north",
              "red",
              "green",
            ],
          },
        },
        0,
      ),
    );
    const white = requireType(state.players[0], "white");
    const result = accept(transition(state, 0, discardAction(state, white.id)));

    expect(result.phase).toBe("hand-ended");
    if (result.phase !== "hand-ended") throw new Error("Expected draw");
    expect(result.result).toEqual({ kind: "draw" });
  });

  it("still permits a win claim on the final discard", () => {
    const state = emptyWall(
      makeDiscardState({ 0: { concealed: ["d3"] }, 1: { concealed: WAITING_FOR_D3 } }, 0),
    );
    const d3 = requireType(state.players[0], "d3");
    const claims = requireDiscardClaims(accept(transition(state, 0, discardAction(state, d3.id))));
    const offer = claims.eligible.find(({ seat }) => seat === 1);
    expect(offer).toMatchObject({
      legal: { canKong: false, canPung: false, canWin: true, chows: [] },
    });
    const ended = finishDiscardClaims(claims, { 1: { kind: "win" } });

    expect(ended.phase).toBe("hand-ended");
    if (ended.phase !== "hand-ended" || ended.result.kind !== "win")
      throw new Error("Expected win");
    expect(ended.result.winner).toBe(1);
  });

  it("rotates the dealer after every finished hand", () => {
    expect([0, 1, 2, 3].map((seat) => rotateDealer(seat as SeatIndex))).toEqual([1, 2, 3, 0]);
  });
});

function makeDiscardState(
  setups: Partial<Record<SeatIndex, PlayerSetup>>,
  turn: SeatIndex,
  wallBack: readonly TileType[] = [],
): AwaitingDiscardState {
  const pool = createTileSet();
  const take = (type: TileType): PhysicalTile => {
    const index = pool.findIndex((tile) => tile.type === type);
    if (index === -1) throw new Error(`Test requested too many ${type} tiles`);
    const tile = pool.splice(index, 1)[0];
    return tile;
  };
  const allocatePlayer = (seat: SeatIndex): PlayerHandState => {
    const setup = setups[seat];
    return {
      concealed: (setup?.concealed ?? []).map(take),
      discards: [],
      melds: (setup?.melds ?? []).map((meld) => ({
        concealed: meld.concealed,
        kind: meld.kind,
        tiles: meld.types.map(take),
      })),
    };
  };
  const players: [PlayerHandState, PlayerHandState, PlayerHandState, PlayerHandState] = [
    allocatePlayer(0),
    allocatePlayer(1),
    allocatePlayer(2),
    allocatePlayer(3),
  ];
  const reservedBack = wallBack.map(take);
  for (const seat of [0, 1, 2, 3] as const) {
    const target = (seat === turn ? 14 : 13) - players[seat].melds.length * 3;
    if (players[seat].concealed.length > target) throw new Error("Test hand is oversized");
    while (players[seat].concealed.length < target) {
      const tile = pool.shift();
      if (tile === undefined) throw new Error("Test tile pool exhausted");
      players[seat].concealed.push(tile);
    }
  }
  const drawnTileId = players[turn].concealed.at(-1)?.id;
  if (drawnTileId === undefined) throw new Error("Test turn has no drawn tile");
  const state: AwaitingDiscardState = {
    dealer: 0,
    decisionId: "test-hand:1",
    decisionSequence: 1,
    drawnTileId,
    handId: "test-hand",
    phase: "awaiting-discard",
    players,
    turn,
    turnOrigin: "draw",
    wall: [...pool, ...reservedBack],
  };
  assertOwnership(state);
  assertDiscardSize(state);
  return state;
}

function emptyWall(state: AwaitingDiscardState): AwaitingDiscardState {
  const empty = structuredClone(state);
  empty.players[3].discards.push(...empty.wall.splice(0));
  assertOwnership(empty);
  return empty;
}

function discardAction(state: AwaitingDiscardState, tileId: string): HandAction {
  return { decisionId: state.decisionId, kind: "discard", tileId };
}

function requireType(player: PlayerHandState, type: TileType): PhysicalTile {
  const tile = player.concealed.find((candidate) => candidate.type === type);
  if (tile === undefined) throw new Error(`Missing ${type} test tile`);
  return tile;
}

function requireDiscardClaims(state: HandState): AwaitingDiscardClaimsState {
  if (state.phase !== "awaiting-discard-claims") throw new Error("Expected discard claims");
  return state;
}

function finishDiscardClaims(
  initial: HandState,
  choices: Partial<Record<SeatIndex, ClaimChoice>> = {},
): HandState {
  let state = initial;
  if (state.phase !== "awaiting-discard-claims") return state;
  for (const { seat } of state.eligible) {
    if (state.phase !== "awaiting-discard-claims") break;
    if (state.responses[seat] !== undefined) continue;
    const result = transition(state, seat, {
      choice: choices[seat] ?? { kind: "pass" },
      decisionId: state.decisionId,
      kind: "respond-to-discard",
    });
    state = accept(result);
  }
  return state;
}

function finishRobbery(
  initial: AwaitingKongRobberyState,
  choices: Partial<Record<SeatIndex, "pass" | "win">> = {},
): HandState {
  let state: HandState = initial;
  for (const seat of initial.eligible) {
    if (state.phase !== "awaiting-kong-robbery") break;
    state = accept(
      transition(state, seat, {
        choice: choices[seat] ?? "pass",
        decisionId: state.decisionId,
        kind: "respond-to-kong-robbery",
      }),
    );
  }
  return state;
}

function accept(result: ReturnType<typeof transition>): HandState {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  assertOwnership(result.state);
  assertPhaseSizes(result.state);
  return result.state;
}

function expectRejected(result: ReturnType<typeof transition>, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected transition rejection");
  expect(result.code).toBe(code);
  assertOwnership(result.state);
  assertPhaseSizes(result.state);
}

function assertOwnership(state: HandState): void {
  const tiles = [
    ...state.wall,
    ...state.players.flatMap((player) => [
      ...player.concealed,
      ...player.discards,
      ...player.melds.flatMap((meld) => meld.tiles),
    ]),
  ];
  expect(tiles).toHaveLength(136);
  expect(new Set(tiles.map((tile) => tile.id)).size).toBe(136);
  for (const type of TILE_TYPES) expect(tiles.filter((tile) => tile.type === type)).toHaveLength(4);
}

function assertDiscardSize(state: AwaitingDiscardState): void {
  const player = state.players[state.turn];
  expect(player.concealed).toHaveLength(14 - player.melds.length * 3);
}

function assertPhaseSizes(state: HandState): void {
  if (state.phase === "awaiting-discard") {
    assertDiscardSize(state);
    return;
  }
  if (state.phase === "awaiting-discard-claims") {
    for (const player of state.players) {
      expect(player.concealed).toHaveLength(13 - player.melds.length * 3);
    }
    return;
  }
  if (state.phase === "awaiting-kong-robbery") {
    for (const [seat, player] of state.players.entries()) {
      const baseSize = seat === state.proposal.declarer ? 14 : 13;
      expect(player.concealed).toHaveLength(baseSize - player.melds.length * 3);
    }
  }
}
