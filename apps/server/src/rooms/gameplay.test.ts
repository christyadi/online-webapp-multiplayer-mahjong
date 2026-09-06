import { type GameCommand, type PhysicalTile, type TileType } from "@mahjong-together/shared";
import { describe, expect, it } from "vitest";

import { startHand, type AwaitingDiscardState, type PlayerHandState } from "../game/state.js";
import { createTileSet, type SeatIndex } from "../game/wall.js";
import type { GuestSession } from "../identity/sessions.js";
import { RoomStore } from "./rooms.js";

let uuidSequence = 0;

function guest(seat: SeatIndex): GuestSession {
  return { expiresAt: Number.MAX_SAFE_INTEGER, guestId: `guest-${String(seat)}` };
}

describe("queued room gameplay", () => {
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

function uuid(): `${string}-${string}-${string}-${string}-${string}` {
  uuidSequence += 1;
  return `00000000-0000-4000-8000-${String(uuidSequence).padStart(12, "0")}`;
}
