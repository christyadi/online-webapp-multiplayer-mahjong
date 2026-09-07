import { afterEach, describe, expect, it, vi } from "vitest";

import { startHand, type HandEndedState } from "../game/state.js";
import { createTileSet } from "../game/wall.js";
import type { GuestSession } from "../identity/sessions.js";
import { RoomError, RoomStore } from "./rooms.js";

afterEach(() => vi.useRealTimers());

function guest(number: number): GuestSession {
  return { expiresAt: Number.MAX_SAFE_INTEGER, guestId: `guest-${String(number)}` };
}

describe("room lobby", () => {
  it("assigns E/S/W/N seats, allows duplicate labels, and rejects a fifth guest", () => {
    const store = new RoomStore({ codeFactory: () => "roomcode0001" });
    const room = store.create(guest(1), "Same Name");

    expect(room).toMatchObject({ code: "roomcode0001", viewerSeat: 0 });
    expect(room.seats[0]).toMatchObject({ host: true, nickname: "Same Name" });
    for (const number of [2, 3, 4]) {
      const joined = store.join(guest(number), room.code, "Same Name");
      expect(joined.viewerSeat).toBe(number - 1);
    }

    expect(() => store.join(guest(5), room.code, "Fifth")).toThrow(
      expect.objectContaining({ code: "room-full" }),
    );
    expect(store.getCurrent(guest(2))?.viewerSeat).toBe(1);
    expect(() => store.setReady(guest(5), room.code, true)).toThrow(
      expect.objectContaining({ code: "not-in-room" }),
    );
  });

  it("offers only open seats and rejects a claimed seat without joining the guest", () => {
    const store = new RoomStore({ codeFactory: () => "seatpicker01" });
    const room = store.create(guest(1), "Host");

    expect(store.getInvitation(room.code)).toEqual({
      availableSeats: [1, 2, 3],
      code: room.code,
    });
    expect(store.join(guest(2), room.code, "North", 3).viewerSeat).toBe(3);
    expect(store.getInvitation(room.code).availableSeats).toEqual([1, 2]);

    expect(() => store.join(guest(3), room.code, "Late North", 3)).toThrow(
      expect.objectContaining({ code: "seat-unavailable" }),
    );
    expect(store.getCurrent(guest(3))).toBeNull();
    expect(store.join(guest(3), room.code, "First free").viewerSeat).toBe(1);
  });

  it("moves a lobby member into an open seat and resets readiness", () => {
    const store = new RoomStore({ codeFactory: () => "seatmove0001" });
    const room = store.create(guest(1), "Host");
    store.setReady(guest(1), room.code, true);
    store.join(guest(2), room.code, "Friend", 1);

    const moved = store.moveSeat(guest(1), room.code, 2);
    expect(moved).toMatchObject({ viewerReady: false, viewerSeat: 2 });
    expect(moved.seats[0]).toBeNull();
    expect(moved.seats[2]).toMatchObject({ host: true, nickname: "Host" });

    expect(() => store.moveSeat(guest(1), room.code, 1)).toThrow(
      expect.objectContaining({ code: "seat-unavailable" }),
    );
    expect(store.getCurrent(guest(1))).toMatchObject({ viewerSeat: 2 });

    store.setReady(guest(1), room.code, true);
    store.setReady(guest(2), room.code, true);
    store.start(guest(1), room.code);
    expect(() => store.moveSeat(guest(1), room.code, 3)).toThrow(
      expect.objectContaining({ code: "room-active" }),
    );
  });

  it("requires the host and every connected human to be ready, then fills bots", () => {
    const store = new RoomStore({ codeFactory: () => "roomcode0002" });
    const room = store.create(guest(1), "Host");
    store.join(guest(2), room.code, "Friend");

    expect(() => store.start(guest(2), room.code)).toThrow(
      expect.objectContaining({ code: "host-only" }),
    );
    expect(() => store.start(guest(1), room.code)).toThrow(
      expect.objectContaining({ code: "players-not-ready" }),
    );
    store.setReady(guest(1), room.code, true);
    const ready = store.setReady(guest(2), room.code, true);
    expect(ready.canStart).toBe(false);
    expect(store.getForGuest(guest(1), room.code).canStart).toBe(true);

    const started = store.start(guest(1), room.code);
    expect(started.phase).toBe("active");
    expect(started.seats.slice(2)).toEqual([{ kind: "bot" }, { kind: "bot" }]);
    expect(() => store.join(guest(3), room.code, "Late")).toThrow(
      expect.objectContaining({ code: "room-active" }),
    );
  });

  it("lets the host start a rematch after the hand ends and rotates the dealer", () => {
    const ended: HandEndedState = {
      ...startHand("00000000-0000-4000-8000-000000000001", 0, createTileSet()),
      phase: "hand-ended",
      result: { kind: "draw" },
    };
    let handCount = 0;
    const store = new RoomStore({
      codeFactory: () => "rematch00001",
      handFactory: (dealer) => {
        handCount += 1;
        return handCount === 1
          ? structuredClone(ended)
          : startHand("00000000-0000-4000-8000-000000000002", dealer, createTileSet());
      },
    });
    const room = store.create(guest(1), "Host");
    store.setReady(guest(1), room.code, true);
    store.start(guest(1), room.code);
    const completed = store.getGameSnapshot(guest(1), room.code);
    expect(completed.phase).toBe("hand-ended");
    expect(completed.rematchDeadline).not.toBeNull();

    const rematch = store.start(guest(1), room.code);
    expect(rematch.phase).toBe("active");
    expect(store.getGameSnapshot(guest(1), room.code)).toMatchObject({
      activeSeat: 1,
      phase: "awaiting-discard",
      rematchDeadline: null,
    });
  });

  it("lets a guest join a completed hand in an available bot seat without revealing it", () => {
    const ended: HandEndedState = {
      ...startHand("00000000-0000-4000-8000-000000000007", 0, createTileSet()),
      phase: "hand-ended",
      result: { kind: "draw" },
    };
    const store = new RoomStore({
      codeFactory: () => "resultinvite",
      handFactory: () => structuredClone(ended),
    });
    const room = store.create(guest(1), "Host");
    store.setReady(guest(1), room.code, true);
    store.start(guest(1), room.code);

    expect(store.getInvitation(room.code).availableSeats).toEqual([1, 2, 3]);
    const joined = store.join(guest(2), room.code, "Guest", 2);
    expect(joined).toMatchObject({ viewerReady: false, viewerSeat: 2 });

    expect(
      store
        .getGameSnapshot(guest(1), room.code)
        .players.every((player) => player.concealedTiles !== null),
    ).toBe(true);
    expect(
      store
        .getGameSnapshot(guest(2), room.code)
        .players.every((player) => player.concealedTiles === null),
    ).toBe(true);
    expect(store.getGameSnapshot(guest(2), room.code).result).toBeNull();
  });

  it("keeps completed-hand participants stable when a released seat is refilled", async () => {
    const ended: HandEndedState = {
      ...startHand("00000000-0000-4000-8000-000000000008", 0, createTileSet()),
      phase: "hand-ended",
      result: { kind: "draw" },
    };
    const store = new RoomStore({
      codeFactory: () => "resultstable",
      handFactory: () => structuredClone(ended),
    });
    const room = store.create(guest(1), "Host");
    store.join(guest(2), room.code, "Friend");
    store.setReady(guest(1), room.code, true);
    store.setReady(guest(2), room.code, true);
    store.start(guest(1), room.code);

    await store.disconnect(guest(2).guestId);
    const hostResult = store.getGameSnapshot(guest(1), room.code);
    expect(hostResult.players[1]).toMatchObject({
      connected: false,
      controller: "bot",
      nickname: "Friend",
    });
    expect(hostResult.players.every((player) => player.concealedTiles !== null)).toBe(true);

    store.join(guest(3), room.code, "New guest", 1);
    const newGuestResult = store.getGameSnapshot(guest(3), room.code);
    expect(newGuestResult.players[1]).toMatchObject({
      connected: false,
      controller: "bot",
      nickname: "Friend",
    });
    expect(newGuestResult.players.every((player) => player.concealedTiles === null)).toBe(true);
    expect(newGuestResult.result).toBeNull();
  });

  it("returns a completed table to a ready-reset lobby and clears bot seats", () => {
    const ended: HandEndedState = {
      ...startHand("00000000-0000-4000-8000-000000000003", 0, createTileSet()),
      phase: "hand-ended",
      result: { kind: "draw" },
    };
    const store = new RoomStore({
      codeFactory: () => "lobbyreturn1",
      handFactory: () => structuredClone(ended),
    });
    const room = store.create(guest(1), "Host");
    store.join(guest(2), room.code, "Friend");
    store.setReady(guest(1), room.code, true);
    store.setReady(guest(2), room.code, true);
    store.start(guest(1), room.code);

    const lobby = store.returnToLobby(guest(1), room.code);
    expect(lobby).toMatchObject({ canStart: false, phase: "lobby", viewerReady: false });
    expect(lobby.seats).toEqual([
      expect.objectContaining({ host: true, kind: "human", ready: false }),
      expect.objectContaining({ kind: "human", ready: false }),
      null,
      null,
    ]);
    expect(() => store.getGameSnapshot(guest(1), room.code)).toThrow(
      expect.objectContaining({ code: "hand-not-active" }),
    );
    expect(() => store.returnToLobby(guest(2), room.code)).toThrow(
      expect.objectContaining({ code: "hand-active" }),
    );
  });

  it("keeps dealer rotation when the host returns a completed table to the lobby", () => {
    let handCount = 0;
    const dealers: number[] = [];
    const store = new RoomStore({
      codeFactory: () => "dealerlobby1",
      handFactory: (dealer) => {
        dealers.push(dealer);
        handCount += 1;
        const hand = startHand(
          `00000000-0000-4000-8000-${String(handCount).padStart(12, "0")}`,
          dealer,
          createTileSet(),
        );
        return handCount === 1 ? { ...hand, phase: "hand-ended", result: { kind: "draw" } } : hand;
      },
    });
    const room = store.create(guest(1), "Host");
    store.setReady(guest(1), room.code, true);
    store.start(guest(1), room.code);
    store.returnToLobby(guest(1), room.code);
    store.setReady(guest(1), room.code, true);
    store.start(guest(1), room.code);

    expect(dealers).toEqual([0, 1]);
    expect(store.getGameSnapshot(guest(1), room.code).dealer).toBe(1);
  });

  it("releases a host who disconnects after results and transfers result controls", async () => {
    const ended: HandEndedState = {
      ...startHand("00000000-0000-4000-8000-000000000004", 0, createTileSet()),
      phase: "hand-ended",
      result: { kind: "draw" },
    };
    const store = new RoomStore({
      codeFactory: () => "resultdrop01",
      handFactory: () => structuredClone(ended),
    });
    const room = store.create(guest(1), "Host");
    store.join(guest(2), room.code, "Friend");
    store.setReady(guest(1), room.code, true);
    store.setReady(guest(2), room.code, true);
    store.start(guest(1), room.code);

    await store.disconnect(guest(1).guestId);

    expect(store.getCurrent(guest(1))).toBeNull();
    const friend = store.getForGuest(guest(2), room.code);
    expect(friend.seats[0]).toBeNull();
    expect(friend.seats[1]).toMatchObject({ host: true, kind: "human" });
    expect(store.getGameSnapshot(guest(2), room.code).players[0]).toMatchObject({
      connected: false,
      controller: "bot",
      nickname: "Host",
    });
    expect(store.returnToLobby(guest(2), room.code)).toMatchObject({ phase: "lobby" });
  });

  it("transfers lobby hosting to the longest-present connected human", () => {
    const store = new RoomStore({ codeFactory: () => "roomcode0003" });
    const room = store.create(guest(1), "First");
    store.join(guest(2), room.code, "Second");
    store.join(guest(3), room.code, "Third");

    store.leave(guest(1), room.code);

    const secondView = store.getForGuest(guest(2), room.code);
    expect(secondView.seats[1]).toMatchObject({ host: true });
    expect(store.getCurrent(guest(1))).toBeNull();
  });

  it("releases a disconnected lobby seat and transfers its host controls", async () => {
    const store = new RoomStore({ codeFactory: () => "roomcode0004" });
    const room = store.create(guest(1), "First");
    store.join(guest(2), room.code, "Second");

    await store.disconnect(guest(1).guestId);

    expect(store.getCurrent(guest(1))).toBeNull();
    const second = store.getForGuest(guest(2), room.code);
    expect(second.seats[0]).toBeNull();
    expect(second.seats[1]).toMatchObject({ host: true });
    expect(store.join(guest(3), room.code, "Replacement").viewerSeat).toBe(0);
  });

  it("removes a room as soon as its final human player leaves or disconnects", async () => {
    const store = new RoomStore({ codeFactory: () => "emptyroom001" });
    const first = store.create(guest(1), "First");

    store.leave(guest(1), first.code);

    expect(store.size).toBe(0);
    expect(store.getCurrent(guest(1))).toBeNull();

    const second = store.create(guest(2), "Second");
    await store.disconnect(guest(2).guestId);

    expect(store.size).toBe(0);
    expect(store.getCurrent(guest(2))).toBeNull();
    expect(() => store.getForGuest(guest(2), second.code)).toThrow(
      expect.objectContaining({ code: "room-not-found" }),
    );
  });

  it("returns a capacity error without repurposing an existing room", () => {
    const store = new RoomStore({ codeFactory: () => "roomcode0005", maxRooms: 1 });
    store.create(guest(1), "One");

    expect(() => store.create(guest(2), "Two")).toThrow(
      expect.objectContaining({ code: "room-capacity" }),
    );
    expect(store.size).toBe(1);
  });

  it("enforces one room per guest and expires inactive and old rooms", () => {
    let now = 0;
    let codeNumber = 0;
    const store = new RoomStore({
      clock: () => now,
      codeFactory: () => `roomcode${String((codeNumber += 1)).padStart(4, "0")}`,
    });
    const first = store.create(guest(1), "One");
    expect(() => store.create(guest(1), "Again")).toThrow(
      expect.objectContaining({ code: "already-in-room" }),
    );

    store.leave(guest(1), first.code);
    expect(store.size).toBe(0);

    const inactive = store.create(guest(2), "Two");
    now += 2 * 60 * 60 * 1000;
    expect(store.getCurrent(guest(2))).toBeNull();
    expect(() => store.getForGuest(guest(2), inactive.code)).toThrow(RoomError);

    store.create(guest(3), "Three");
    now += 12 * 60 * 60 * 1000;
    store.cleanupExpired();
    expect(store.size).toBe(0);
  });

  it("removes a completed room at the three-minute deadline, including after a lobby return", () => {
    let now = 0;
    const ended: HandEndedState = {
      ...startHand("00000000-0000-4000-8000-000000000005", 0, createTileSet()),
      phase: "hand-ended",
      result: { kind: "draw" },
    };
    const store = new RoomStore({
      clock: () => now,
      codeFactory: () => "rematchexp01",
      handFactory: () => structuredClone(ended),
    });
    const room = store.create(guest(1), "Host");
    store.setReady(guest(1), room.code, true);
    store.start(guest(1), room.code);

    expect(store.getGameSnapshot(guest(1), room.code).rematchDeadline).toBe(180_000);
    store.returnToLobby(guest(1), room.code);
    now = 179_999;
    store.cleanupExpired();
    expect(store.size).toBe(1);

    now = 180_000;
    store.cleanupExpired();
    expect(store.size).toBe(0);
    expect(store.getCurrent(guest(1))).toBeNull();
  });

  it("uses the room scheduler to remove a completed room at the rematch deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ended: HandEndedState = {
      ...startHand("00000000-0000-4000-8000-000000000006", 0, createTileSet()),
      phase: "hand-ended",
      result: { kind: "draw" },
    };
    const store = new RoomStore({
      clock: Date.now,
      codeFactory: () => "rematchtime1",
      handFactory: () => structuredClone(ended),
    });
    const room = store.create(guest(1), "Host");
    store.setReady(guest(1), room.code, true);
    store.start(guest(1), room.code);

    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

    expect(store.size).toBe(0);
    expect(store.getCurrent(guest(1))).toBeNull();
  });

  it("checks expiry before mutations so an old lobby cannot be revived", () => {
    let now = 0;
    const store = new RoomStore({ clock: () => now, codeFactory: () => "roomcode0006" });
    const room = store.create(guest(1), "One");
    now += 2 * 60 * 60 * 1000;

    expect(() => store.setReady(guest(1), room.code, true)).toThrow(
      expect.objectContaining({ code: "room-not-found" }),
    );
    expect(() => store.start(guest(1), room.code)).toThrow(
      expect.objectContaining({ code: "room-not-found" }),
    );
    expect(() => store.leave(guest(1), room.code)).toThrow(
      expect.objectContaining({ code: "room-not-found" }),
    );
    expect(store.size).toBe(0);
  });

  it("runs scheduled cleanup and disposes its server-owned interval", () => {
    vi.useFakeTimers();
    let now = 0;
    const store = new RoomStore({ clock: () => now, codeFactory: () => "roomcode0007" });
    store.create(guest(1), "One");
    const stop = store.startCleanup(1_000);
    now += 2 * 60 * 60 * 1000;

    vi.advanceTimersByTime(1_000);
    expect(store.size).toBe(0);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
