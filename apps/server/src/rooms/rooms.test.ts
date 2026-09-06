import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("returns a capacity error without repurposing an existing room", () => {
    const store = new RoomStore({ codeFactory: () => "roomcode0005", maxRooms: 1 });
    store.create(guest(1), "One");

    expect(() => store.create(guest(2), "Two")).toThrow(
      expect.objectContaining({ code: "room-capacity" }),
    );
    expect(store.size).toBe(1);
  });

  it("enforces one room per guest and expires empty, inactive, and old rooms", () => {
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
    now += 30 * 60 * 1000;
    store.cleanupExpired();
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
