import { type GameCommand, type PhysicalTile, type TileType } from "@mahjong-together/shared";
import { describe, expect, it } from "vitest";

import {
  startHand,
  type AwaitingDiscardState,
  type HandEndedState,
  type PlayerHandState,
} from "../game/state.js";
import { createTileSet, type SeatIndex } from "../game/wall.js";
import type { GuestSession } from "../identity/sessions.js";
import { RoomStore, type RoomScheduler } from "./rooms.js";

let uuidSequence = 0;

function guest(seat: SeatIndex): GuestSession {
  return { expiresAt: Number.MAX_SAFE_INTEGER, guestId: `guest-${String(seat)}` };
}

describe("queued room gameplay", () => {
  it.each([30_000, 30_001])(
    "rejects a human discard dequeued at or after the %i ms deadline",
    async (now) => {
      const initial = startHand(uuid(), 0, createTileSet());
      const time = new FakeTime();
      const store = new RoomStore({
        clock: () => time.now,
        codeFactory: () => "timeoutcode1",
        handFactory: () => structuredClone(initial),
        scheduler: time.schedule,
      });
      const room = startRoom(store, 4);
      const opening = store.getGameSnapshot(guest(0), room.code);
      expect(opening.activeSeat).toBe(0);
      expect(opening.waitingSeats).toEqual([1, 2, 3]);
      const drawnTileId = initial.drawnTileId;
      time.now = now;

      const late = await store.executeGameCommand(
        guest(0),
        gameCommand(opening, { kind: "discard", tileId: drawnTileId }),
      );

      expect(late).toMatchObject({ code: "stale-decision", ok: false });
      const current = store.getGameSnapshot(guest(0), room.code);
      expect(current.players[0].discards).toContainEqual(
        expect.objectContaining({ id: drawnTileId }),
      );
      expect(current.deadline).toBeGreaterThan(now);
    },
  );

  it("accepts a human action just before its deadline without resetting on rejection", async () => {
    const initial = startHand(uuid(), 0, createTileSet());
    const time = new FakeTime();
    const store = new RoomStore({
      clock: () => time.now,
      codeFactory: () => "timeoutcode2",
      handFactory: () => structuredClone(initial),
      scheduler: time.schedule,
    });
    const room = startRoom(store, 4);
    const opening = store.getGameSnapshot(guest(0), room.code);
    time.now = 1_000;
    const rejected = await store.executeGameCommand(
      guest(1),
      gameCommand(opening, { kind: "discard", tileId: initial.players[1].concealed[0].id }),
    );
    expect(rejected).toMatchObject({ code: "wrong-seat", ok: false });
    expect(store.getGameSnapshot(guest(0), room.code).deadline).toBe(opening.deadline);

    time.now = 29_999;
    await expect(
      store.executeGameCommand(
        guest(0),
        gameCommand(opening, { kind: "discard", tileId: initial.drawnTileId }),
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it("passes unanswered discard claims when the claim window expires", async () => {
    const controlled = competingClaimState();
    const time = new FakeTime();
    const store = new RoomStore({
      clock: () => time.now,
      codeFactory: () => "claimtime001",
      handFactory: () => structuredClone(controlled),
      scheduler: time.schedule,
    });
    const room = startRoom(store, 4);
    const opening = store.getGameSnapshot(guest(0), room.code);
    const discard = controlled.players[0].concealed.find((tile) => tile.type === "d3");
    if (discard === undefined) throw new Error("Missing opening discard");
    await expect(
      store.executeGameCommand(
        guest(0),
        gameCommand(opening, { kind: "discard", tileId: discard.id }),
      ),
    ).resolves.toMatchObject({ ok: true });
    const claims = store.getGameSnapshot(guest(1), room.code);
    expect(claims.phase).toBe("awaiting-discard-claims");
    expect(claims.activeSeat).toBeNull();
    expect(claims.waitingSeats.length).toBeGreaterThan(0);
    const claimDecision = claims.decisionId;
    await time.advanceTo(10_000);
    const after = store.getGameSnapshot(guest(1), room.code);
    expect(after.decisionId).not.toBe(claimDecision);
    expect(after.phase).not.toBe("awaiting-discard-claims");
  });

  it("restores a human without changing an open discard-claim decision", async () => {
    const controlled = competingClaimState();
    const time = new FakeTime();
    const store = new RoomStore({
      botDelayMs: () => 1_000,
      clock: () => time.now,
      codeFactory: () => "claimreturn1",
      handFactory: () => structuredClone(controlled),
      scheduler: time.schedule,
    });
    const room = startRoom(store, 4);
    const opening = store.getGameSnapshot(guest(0), room.code);
    const discard = controlled.players[0].concealed.find((tile) => tile.type === "d3");
    if (discard === undefined) throw new Error("Missing opening discard");
    await store.executeGameCommand(
      guest(0),
      gameCommand(opening, { kind: "discard", tileId: discard.id }),
    );

    const claims = store.getGameSnapshot(guest(1), room.code);
    expect(claims.phase).toBe("awaiting-discard-claims");
    const deadline = claims.deadline;
    await store.disconnect(guest(1).guestId);
    expect(store.getGameSnapshot(guest(1), room.code).players[1]).toMatchObject({
      connected: false,
      controller: "bot",
    });

    await store.connect(guest(1).guestId);
    const restored = store.getGameSnapshot(guest(1), room.code);
    expect(restored).toMatchObject({
      decisionId: claims.decisionId,
      deadline,
      phase: "awaiting-discard-claims",
    });
    expect(restored.players[1]).toMatchObject({ connected: true, controller: "human" });
    expect(restored.legalActions.kind).toBe("discard-claim");
  });

  it("restores a human without changing an open added-kong robbery decision", async () => {
    const controlled = addedKongRobberyState();
    const time = new FakeTime();
    const store = new RoomStore({
      botDelayMs: () => 1_000,
      clock: () => time.now,
      codeFactory: () => "kongreturn01",
      handFactory: () => structuredClone(controlled),
      scheduler: time.schedule,
    });
    const room = startRoom(store, 2);
    const opening = store.getGameSnapshot(guest(0), room.code);
    const pungIndex = controlled.players[0].melds.findIndex((meld) => meld.kind === "pung");
    const upgrade = controlled.players[0].concealed.find((tile) => tile.type === "d3");
    if (pungIndex === -1 || upgrade === undefined) throw new Error("Missing added-kong fixture");
    await store.executeGameCommand(
      guest(0),
      gameCommand(opening, {
        kind: "propose-added-kong",
        meldIndex: pungIndex,
        tileId: upgrade.id,
      }),
    );

    const robbery = store.getGameSnapshot(guest(1), room.code);
    expect(robbery.phase).toBe("awaiting-kong-robbery");
    const deadline = robbery.deadline;
    await store.disconnect(guest(1).guestId);
    expect(store.getGameSnapshot(guest(1), room.code).players[1]).toMatchObject({
      connected: false,
      controller: "bot",
    });

    await store.connect(guest(1).guestId);
    const restored = store.getGameSnapshot(guest(1), room.code);
    expect(restored).toMatchObject({
      decisionId: robbery.decisionId,
      deadline,
      phase: "awaiting-kong-robbery",
    });
    expect(restored.players[1]).toMatchObject({ connected: true, controller: "human" });
    expect(restored.legalActions).toEqual({ kind: "kong-robbery" });
  });

  it("hands a disconnected turn to a bot and cancels it when the human returns", async () => {
    const initial = startHand(uuid(), 0, createTileSet());
    const time = new FakeTime();
    const store = new RoomStore({
      clock: () => time.now,
      codeFactory: () => "takeovercode",
      handFactory: () => structuredClone(initial),
      scheduler: time.schedule,
      botDelayMs: () => 1_000,
    });
    const room = startRoom(store, 4);
    const opening = store.getGameSnapshot(guest(0), room.code);

    await store.disconnect(guest(0).guestId);
    const disconnected = store.getGameSnapshot(guest(0), room.code);
    expect(disconnected.deadline).toBe(opening.deadline);
    expect(disconnected.players[0]).toMatchObject({ connected: false, controller: "bot" });
    await store.connect(guest(0).guestId);
    await time.advanceTo(1_000);

    const reconnected = store.getGameSnapshot(guest(0), room.code);
    expect(reconnected.decisionId).toBe(opening.decisionId);
    expect(reconnected.players[0]).toMatchObject({ connected: true, controller: "human" });
    expect(reconnected.players[0].discards).toHaveLength(0);

    await store.disconnect(guest(0).guestId);
    await time.advanceTo(2_000);
    const takenOver = store.getGameSnapshot(guest(0), room.code);
    expect(takenOver.decisionId).not.toBe(opening.decisionId);
    expect(takenOver.players[0].discards).toHaveLength(1);
    await store.connect(guest(0).guestId);
    expect(store.getGameSnapshot(guest(0), room.code).players[0].controller).toBe("human");
  });

  it("waits for the configured bot cooldown and clamps it to one through five seconds", async () => {
    const initial = startHand(uuid(), 0, createTileSet());
    const delays: number[] = [];
    const store = new RoomStore({
      botDelayMs: () => 4_321,
      codeFactory: () => "botdelay0012",
      handFactory: () => structuredClone(initial),
      scheduler: (delayMs) => {
        delays.push(delayMs);
        return () => undefined;
      },
    });
    const room = startRoom(store, 2);
    await store.disconnect(guest(0).guestId);
    expect(delays).toContain(4_321);
    expect(delays.every((delay) => delay >= 1_000 || delay === 30_000)).toBe(true);
    expect(delays.every((delay) => delay <= 30_000)).toBe(true);
    expect(room.code).toBe("botdelay0012");
  });

  it("finishes the hand through scheduled bots after the last human disconnects", async () => {
    const time = new FakeTime();
    const store = new RoomStore({
      clock: () => time.now,
      codeFactory: () => "allbotcode01",
      handFactory: () => startHand(uuid(), 0, createTileSet()),
      scheduler: time.schedule,
      botDelayMs: () => 1_000,
    });
    startRoom(store, 2);
    await store.disconnect(guest(0).guestId);
    await store.disconnect(guest(1).guestId);

    let scheduledActions = 0;
    while (store.getCurrent(guest(0)) !== null) {
      if (scheduledActions >= 1_000 || !(await time.advanceNext())) {
        throw new Error("All-bot room failed to finish within 1,000 scheduled actions");
      }
      scheduledActions += 1;
    }

    expect(scheduledActions).toBeLessThan(1_000);
    expect(await time.advanceNext()).toBe(false);
  });

  it("deduplicates commands, binds their payload, rejects wrong seats, and hides private tiles", async () => {
    const initial = startHand(uuid(), 0, createTileSet());
    const store = new RoomStore({
      codeFactory: () => "gamecode0001",
      handFactory: () => structuredClone(initial),
    });
    const room = startRoom(store, 2);
    const hostView = store.getGameSnapshot(guest(0), room.code);
    const friendView = store.getGameSnapshot(guest(1), room.code);
    if (hostView.legalActions.kind !== "discard") throw new Error("Expected host discard");
    expect(hostView.drawnTileId).toBe(initial.drawnTileId);
    expect(friendView.drawnTileId).toBeNull();
    const hostTileId = hostView.legalActions.discardTileIds[0];
    const command = gameCommand(hostView, { kind: "discard", tileId: hostTileId });

    const wrongSeatCommand: GameCommand = {
      ...command,
      commandId: uuid(),
    };
    const wrongSeat = await store.executeGameCommand(guest(1), wrongSeatCommand);
    expect(wrongSeat).toMatchObject({ code: "wrong-seat", ok: false });
    expect(wrongSeat.roomRevision).toBe(hostView.roomRevision);
    const accepted = await store.executeGameCommand(guest(0), command);
    expect(accepted.ok).toBe(true);
    const duplicate = await store.executeGameCommand(guest(0), command);
    expect(duplicate).toEqual(accepted);
    expect(await store.executeGameCommand(guest(1), wrongSeatCommand)).toEqual(wrongSeat);

    const changedPayload = await store.executeGameCommand(guest(0), {
      ...command,
      action: { kind: "discard", tileId: "different-tile" },
    });
    expect(changedPayload).toMatchObject({ code: "command-id-reused", ok: false });
    const stale = await store.executeGameCommand(guest(0), {
      ...command,
      commandId: uuid(),
    });
    expect(stale).toMatchObject({ code: "stale-decision", ok: false });
    const afterRejections = store.getGameSnapshot(guest(0), room.code);
    expect(afterRejections.roomRevision).toBe(accepted.roomRevision);
    const staleHand = await store.executeGameCommand(guest(0), {
      ...command,
      commandId: uuid(),
      decisionId: afterRejections.decisionId ?? "ended",
      handId: uuid(),
    });
    expect(staleHand).toMatchObject({ code: "stale-hand", ok: false });

    const serializedHost = JSON.stringify(hostView);
    const friendTiles = friendView.players[1].concealedTiles;
    if (friendTiles === null) throw new Error("Expected own tiles");
    for (const tile of friendTiles) expect(serializedHost).not.toContain(tile.id);
    for (const tile of initial.wall) expect(serializedHost).not.toContain(tile.id);
    expect(hostView.players[1].concealedTiles).toBeNull();
    expect(hostView).not.toHaveProperty("wall");
  });

  it("resolves simultaneous claim commands by rules in either arrival order", async () => {
    await expectClaimWinner([2, 3, 1]);
    await expectClaimWinner([1, 3, 2]);
  });

  it("hides an opponent's concealed kong while revealing it to its owner", () => {
    const initial = startHand(uuid(), 0, createTileSet());
    const controlled = structuredClone(initial);
    const kongTiles = controlled.wall.filter((tile) => tile.type === "white");
    controlled.wall = controlled.wall.filter((tile) => tile.type !== "white");
    if (kongTiles.length !== 4) throw new Error("Expected four white dragons in the wall");
    const owner = controlled.players[1];
    while (owner.concealed.length > 10) {
      const moved = owner.concealed.pop();
      if (moved === undefined) throw new Error("Expected owner tile");
      controlled.wall.unshift(moved);
    }
    owner.melds.push({ concealed: true, kind: "kong", tiles: kongTiles });
    const store = new RoomStore({
      codeFactory: () => "gamecode0003",
      handFactory: () => structuredClone(controlled),
    });
    const room = startRoom(store, 2);

    const opponentView = store.getGameSnapshot(guest(0), room.code);
    const ownerView = store.getGameSnapshot(guest(1), room.code);
    expect(opponentView.players[1].melds[0]).toMatchObject({ tileCount: 4, tiles: null });
    expect(ownerView.players[1].melds[0]?.tiles).toHaveLength(4);
    const opponentPayload = JSON.stringify(opponentView);
    for (const tile of kongTiles) expect(opponentPayload).not.toContain(tile.id);
  });

  it("makes every concealed hand available to the results view after the hand ends", () => {
    const initial = startHand(uuid(), 0, createTileSet());
    const ended: HandEndedState = {
      ...structuredClone(initial),
      phase: "hand-ended",
      result: { kind: "draw" },
    };
    const store = new RoomStore({
      codeFactory: () => "resultview01",
      handFactory: () => structuredClone(ended),
    });
    const room = startRoom(store, 2);
    const snapshot = store.getGameSnapshot(guest(0), room.code);
    expect(snapshot.phase).toBe("hand-ended");
    expect(snapshot.result).toEqual({ kind: "draw" });
    expect(snapshot.players.every((player) => player.concealedTiles !== null)).toBe(true);
  });
});

async function expectClaimWinner(order: readonly SeatIndex[]): Promise<void> {
  const controlled = competingClaimState();
  const store = new RoomStore({
    codeFactory: () => "gamecode0002",
    handFactory: () => structuredClone(controlled),
  });
  const room = startRoom(store, 4);
  const opening = store.getGameSnapshot(guest(0), room.code);
  const discard = controlled.players[0].concealed.find((tile) => tile.type === "d3");
  if (discard === undefined || opening.decisionId === null)
    throw new Error("Missing opening discard");
  const discarded = await store.executeGameCommand(
    guest(0),
    gameCommand(opening, { kind: "discard", tileId: discard.id }),
  );
  expect(discarded.ok).toBe(true);
  const claims = store.getGameSnapshot(guest(1), room.code);
  if (claims.decisionId === null) throw new Error("Missing claim decision");

  const acknowledgements = await Promise.all(
    order.map(async (seat) =>
      store.executeGameCommand(
        guest(seat),
        gameCommand(claims, {
          choice: seat === 3 ? { kind: "pung" } : { kind: "win" },
          kind: "respond-to-discard",
        }),
      ),
    ),
  );
  expect(acknowledgements.every((acknowledgement) => acknowledgement.ok)).toBe(true);
  const ended = store.getGameSnapshot(guest(0), room.code);
  expect(ended).toMatchObject({ phase: "hand-ended", result: { kind: "win", winner: 1 } });
}

function startRoom(store: RoomStore, humanCount: 2 | 4) {
  const room = store.create(guest(0), "East");
  for (let seat = 1; seat < humanCount; seat += 1) {
    store.join(guest(seat as SeatIndex), room.code, `Player ${String(seat + 1)}`);
  }
  for (let seat = 0; seat < humanCount; seat += 1) {
    store.setReady(guest(seat as SeatIndex), room.code, true);
  }
  return store.start(guest(0), room.code);
}

function gameCommand(
  snapshot: Readonly<{ decisionId: string | null; handId: string; roomId: string }>,
  action: GameCommand["action"],
): GameCommand {
  if (snapshot.decisionId === null) throw new Error("Expected active decision");
  return {
    action,
    commandId: uuid(),
    decisionId: snapshot.decisionId,
    handId: snapshot.handId,
    roomId: snapshot.roomId,
  };
}

function competingClaimState(): AwaitingDiscardState {
  const pool = createTileSet();
  const take = (type: TileType): PhysicalTile => {
    const index = pool.findIndex((tile) => tile.type === type);
    if (index === -1) throw new Error(`Missing ${type}`);
    const tile = pool.splice(index, 1)[0];
    return tile;
  };
  const players: [PlayerHandState, PlayerHandState, PlayerHandState, PlayerHandState] = [
    player(["d3"]),
    player(["d1", "d2", "b1", "b2", "b3", "c1", "c2", "c3", "east", "east", "east", "red", "red"]),
    player([
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
    ]),
    player(["d3", "d3"]),
  ];
  const reservedD3 = take("d3");
  for (const [seat, current] of players.entries()) {
    const target = seat === 0 ? 14 : 13;
    while (current.concealed.length < target) {
      const tile = pool.shift();
      if (tile === undefined) throw new Error("Tile pool exhausted");
      current.concealed.push(tile);
    }
  }
  const handId = uuid();
  const drawnTile = players[0].concealed.at(-1);
  if (drawnTile === undefined) throw new Error("Missing dealer tile");
  return {
    dealer: 0,
    decisionId: `${handId}:1`,
    decisionSequence: 1,
    drawnTileId: drawnTile.id,
    handId,
    phase: "awaiting-discard",
    players,
    turn: 0,
    turnOrigin: "dealer-initial",
    wall: [...pool, reservedD3],
  };

  function player(types: readonly TileType[]): PlayerHandState {
    return { concealed: types.map(take), discards: [], melds: [] };
  }
}

function addedKongRobberyState(): AwaitingDiscardState {
  const pool = createTileSet();
  const take = (type: TileType): PhysicalTile => {
    const index = pool.findIndex((tile) => tile.type === type);
    if (index === -1) throw new Error(`Missing ${type}`);
    const tile = pool.splice(index, 1)[0];
    return tile;
  };
  const player = (types: readonly TileType[]): PlayerHandState => ({
    concealed: types.map(take),
    discards: [],
    melds: [],
  });
  const pungTiles = [take("d3"), take("d3"), take("d3")] as [
    PhysicalTile,
    PhysicalTile,
    PhysicalTile,
  ];
  const players: [PlayerHandState, PlayerHandState, PlayerHandState, PlayerHandState] = [
    {
      concealed: [take("d3")],
      discards: [],
      melds: [{ concealed: false, kind: "pung", tiles: pungTiles }],
    },
    player(["d1", "d2", "b1", "b2", "b3", "c1", "c2", "c3", "east", "east", "east", "red", "red"]),
    player([]),
    player([]),
  ];
  for (const [seat, current] of players.entries()) {
    const concealedTarget = seat === 0 ? 11 : 13;
    while (current.concealed.length < concealedTarget) {
      const tile = pool.shift();
      if (tile === undefined) throw new Error("Tile pool exhausted");
      current.concealed.push(tile);
    }
  }
  const handId = uuid();
  const drawnTile = players[0].concealed.at(-1);
  if (drawnTile === undefined) throw new Error("Missing added-kong turn tile");
  return {
    dealer: 0,
    decisionId: `${handId}:1`,
    decisionSequence: 1,
    drawnTileId: drawnTile.id,
    handId,
    phase: "awaiting-discard",
    players,
    turn: 0,
    turnOrigin: "draw",
    wall: pool,
  };
}

function uuid(): `${string}-${string}-${string}-${string}-${string}` {
  uuidSequence += 1;
  return `00000000-0000-4000-8000-${String(uuidSequence).padStart(12, "0")}`;
}

type FakeTask = {
  active: boolean;
  callback: () => void;
  due: number;
  sequence: number;
};

class FakeTime {
  now = 0;
  #sequence = 0;
  readonly #tasks: FakeTask[] = [];

  readonly schedule: RoomScheduler = (delayMs, callback) => {
    const task = {
      active: true,
      callback,
      due: this.now + delayMs,
      sequence: (this.#sequence += 1),
    };
    this.#tasks.push(task);
    return () => {
      task.active = false;
    };
  };

  async advanceTo(target: number): Promise<void> {
    for (;;) {
      const next = this.nextTask(target);
      if (next === undefined) break;
      this.now = next.due;
      next.active = false;
      next.callback();
      await flushQueuedRoomWork();
    }
    this.now = target;
    await flushQueuedRoomWork();
  }

  async advanceNext(): Promise<boolean> {
    const next = this.nextTask(Number.POSITIVE_INFINITY);
    if (next === undefined) return false;
    await this.advanceTo(next.due);
    return true;
  }

  private nextTask(maximumDue: number): FakeTask | undefined {
    return this.#tasks
      .filter((task) => task.active && task.due <= maximumDue)
      .sort((left, right) => left.due - right.due || left.sequence - right.sequence)[0];
  }
}

async function flushQueuedRoomWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
