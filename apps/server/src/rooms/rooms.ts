import { randomInt } from "node:crypto";

import type { RoomView } from "@mahjong-together/shared";

import type { GuestSession } from "../identity/sessions.js";
import type { SeatIndex } from "../game/wall.js";

const ROOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

type HumanSeat = {
  connected: boolean;
  guestId: string;
  host: boolean;
  joinedOrder: number;
  kind: "human";
  nickname: string;
  ready: boolean;
};

type BotSeat = Readonly<{ kind: "bot" }>;
type RoomSeat = HumanSeat | BotSeat | null;

type Room = {
  code: string;
  createdAt: number;
  lastActivityAt: number;
  noConnectedHumansSince: number | null;
  phase: "lobby" | "active";
  seats: [RoomSeat, RoomSeat, RoomSeat, RoomSeat];
};

export class RoomError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type RoomStoreOptions = Readonly<{
  clock?: () => number;
  codeFactory?: () => string;
  maxRooms?: number;
}>;

export class RoomStore {
  readonly #clock: () => number;
  readonly #codeFactory: () => string;
  readonly #guestRooms = new Map<string, string>();
  #joinSequence = 0;
  readonly #maxRooms: number;
  readonly #rooms = new Map<string, Room>();

  constructor(options: RoomStoreOptions = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#codeFactory = options.codeFactory ?? generateRoomCode;
    this.#maxRooms = options.maxRooms ?? 20;
  }

  create(session: GuestSession, nickname: string): RoomView {
    this.cleanupExpired();
    this.assertGuestIsFree(session.guestId);
    if (this.#rooms.size >= this.#maxRooms) {
      throw new RoomError("room-capacity", "All private rooms are currently in use");
    }

    const now = this.#clock();
    const code = this.createUniqueCode();
    const creator = this.createHumanSeat(session.guestId, nickname, true);
    const room: Room = {
      code,
      createdAt: now,
      lastActivityAt: now,
      noConnectedHumansSince: null,
      phase: "lobby",
      seats: [creator, null, null, null],
    };
    this.#rooms.set(code, room);
    this.#guestRooms.set(session.guestId, code);
    return viewFor(room, session.guestId);
  }

  join(session: GuestSession, code: string, nickname: string): RoomView {
    this.cleanupExpired();
    const currentCode = this.#guestRooms.get(session.guestId);
    if (currentCode === code) return this.getForGuest(session, code);
    this.assertGuestIsFree(session.guestId);

    const room = this.requireRoom(code);
    if (room.phase !== "lobby") {
      throw new RoomError("room-active", "This hand has already started");
    }
    const seat = room.seats.findIndex((occupant) => occupant === null);
    if (seat === -1) throw new RoomError("room-full", "This room already has four players");

    room.seats[seat as SeatIndex] = this.createHumanSeat(session.guestId, nickname, false);
    room.lastActivityAt = this.#clock();
    room.noConnectedHumansSince = null;
    this.#guestRooms.set(session.guestId, code);
    return viewFor(room, session.guestId);
  }

  getCurrent(session: GuestSession): RoomView | null {
    this.cleanupExpired();
    const code = this.#guestRooms.get(session.guestId);
    if (code === undefined) return null;
    const room = this.#rooms.get(code);
    if (room === undefined) {
      this.#guestRooms.delete(session.guestId);
      return null;
    }
    return viewFor(room, session.guestId);
  }

  getForGuest(session: GuestSession, code: string): RoomView {
    this.cleanupExpired();
    const room = this.requireRoom(code);
    if (this.#guestRooms.get(session.guestId) !== code) {
      throw new RoomError("not-in-room", "Join this room before viewing it");
    }
    return viewFor(room, session.guestId);
  }

  setReady(session: GuestSession, code: string, ready: boolean): RoomView {
    this.cleanupExpired();
    const { room, seat } = this.requireHumanMembership(session.guestId, code);
    if (room.phase !== "lobby") throw new RoomError("room-active", "The hand has started");
    seat.ready = ready;
    room.lastActivityAt = this.#clock();
    return viewFor(room, session.guestId);
  }

  start(session: GuestSession, code: string): RoomView {
    this.cleanupExpired();
    const { room, seat } = this.requireHumanMembership(session.guestId, code);
    if (room.phase !== "lobby") throw new RoomError("room-active", "The hand has started");
    if (!seat.host) throw new RoomError("host-only", "Only the host can start the hand");
    const humans = room.seats.filter(
      (occupant): occupant is HumanSeat => occupant?.kind === "human",
    );
    if (humans.some((human) => human.connected && !human.ready)) {
      throw new RoomError("players-not-ready", "Every connected player must be ready");
    }
    for (const seatIndex of [0, 1, 2, 3] as const) {
      room.seats[seatIndex] ??= { kind: "bot" };
    }
    room.phase = "active";
    room.lastActivityAt = this.#clock();
    return viewFor(room, session.guestId);
  }

  leave(session: GuestSession, code: string): void {
    this.cleanupExpired();
    const { room, seatIndex } = this.requireHumanMembership(session.guestId, code);
    room.seats[seatIndex] = room.phase === "active" ? { kind: "bot" } : null;
    this.#guestRooms.delete(session.guestId);
    room.lastActivityAt = this.#clock();
    this.ensureHost(room);
    this.updateConnectedState(room);
  }

  disconnect(guestId: string): void {
    this.cleanupExpired();
    const code = this.#guestRooms.get(guestId);
    if (code === undefined) return;
    const room = this.#rooms.get(code);
    if (room === undefined) return;
    const seatIndex = findHumanSeat(room, guestId);
    if (seatIndex === null) return;
    const seat = room.seats[seatIndex];
    if (seat?.kind !== "human") return;

    if (room.phase === "lobby") {
      room.seats[seatIndex] = null;
      this.#guestRooms.delete(guestId);
      this.ensureHost(room);
    } else {
      seat.connected = false;
    }
    room.lastActivityAt = this.#clock();
    this.updateConnectedState(room);
  }

  cleanupExpired(): void {
    const now = this.#clock();
    for (const room of this.#rooms.values()) {
      const reachedLifetime = now - room.createdAt >= 12 * 60 * 60 * 1000;
      const inactiveLobby =
        room.phase === "lobby" && now - room.lastActivityAt >= 2 * 60 * 60 * 1000;
      const emptyTooLong =
        room.noConnectedHumansSince !== null && now - room.noConnectedHumansSince >= 30 * 60 * 1000;
      if (reachedLifetime || inactiveLobby || emptyTooLong) this.deleteRoom(room);
    }
  }

  startCleanup(intervalMs = 60_000): () => void {
    const timer = setInterval(() => this.cleanupExpired(), intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  get size(): number {
    return this.#rooms.size;
  }

  #assertCode(code: string): void {
    if (!/^[a-z0-9]{12}$/.test(code)) throw new RoomError("room-not-found", "Room not found");
  }

  assertGuestIsFree(guestId: string): void {
    if (this.#guestRooms.has(guestId)) {
      throw new RoomError("already-in-room", "Leave your current room before joining another");
    }
  }

  createHumanSeat(guestId: string, nickname: string, host: boolean): HumanSeat {
    this.#joinSequence += 1;
    return {
      connected: true,
      guestId,
      host,
      joinedOrder: this.#joinSequence,
      kind: "human",
      nickname,
      ready: false,
    };
  }

  createUniqueCode(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const code = this.#codeFactory();
      this.#assertCode(code);
      if (!this.#rooms.has(code)) return code;
    }
    throw new Error("Unable to allocate a unique room code");
  }

  deleteRoom(room: Room): void {
    this.#rooms.delete(room.code);
    for (const seat of room.seats) {
      if (seat?.kind === "human") this.#guestRooms.delete(seat.guestId);
    }
  }

  ensureHost(room: Room): void {
    const humans = room.seats
      .filter((seat): seat is HumanSeat => seat?.kind === "human" && seat.connected)
      .sort((left, right) => left.joinedOrder - right.joinedOrder);
    if (humans.some((human) => human.host)) return;
    const nextHost = humans[0];
    if (nextHost !== undefined) nextHost.host = true;
  }

  requireHumanMembership(
    guestId: string,
    code: string,
  ): Readonly<{ room: Room; seat: HumanSeat; seatIndex: SeatIndex }> {
    const room = this.requireRoom(code);
    if (this.#guestRooms.get(guestId) !== code) {
      throw new RoomError("not-in-room", "You do not control a seat in this room");
    }
    const seatIndex = findHumanSeat(room, guestId);
    if (seatIndex === null) throw new RoomError("not-in-room", "Your seat is no longer available");
    const seat = room.seats[seatIndex];
    if (seat?.kind !== "human") throw new Error("Human membership invariant failed");
    return { room, seat, seatIndex };
  }

  requireRoom(code: string): Room {
    this.#assertCode(code);
    const room = this.#rooms.get(code);
    if (room === undefined) throw new RoomError("room-not-found", "Room not found or expired");
    return room;
  }

  updateConnectedState(room: Room): void {
    const hasConnectedHuman = room.seats.some((seat) => seat?.kind === "human" && seat.connected);
    if (hasConnectedHuman) room.noConnectedHumansSince = null;
    else room.noConnectedHumansSince ??= this.#clock();
  }
}

function findHumanSeat(room: Room, guestId: string): SeatIndex | null {
  const index = room.seats.findIndex((seat) => seat?.kind === "human" && seat.guestId === guestId);
  return index === -1 ? null : (index as SeatIndex);
}

function generateRoomCode(): string {
  let code = "";
  for (let index = 0; index < 12; index += 1) {
    code += ROOM_ALPHABET.charAt(randomInt(ROOM_ALPHABET.length));
  }
  return code;
}

function viewFor(room: Room, guestId: string): RoomView {
  const viewerSeat = findHumanSeat(room, guestId);
  if (viewerSeat === null) throw new RoomError("not-in-room", "You do not control a room seat");
  const viewer = room.seats[viewerSeat];
  if (viewer?.kind !== "human") throw new Error("Viewer seat invariant failed");
  return {
    canStart:
      room.phase === "lobby" &&
      viewer.host &&
      room.seats.every(
        (seat) => seat === null || seat.kind === "bot" || !seat.connected || seat.ready,
      ),
    code: room.code,
    phase: room.phase,
    seats: room.seats.map((seat) => {
      if (seat === null || seat.kind === "bot") return seat;
      return {
        connected: seat.connected,
        host: seat.host,
        kind: "human" as const,
        nickname: seat.nickname,
        ready: seat.ready,
      };
    }),
    viewerReady: viewer.ready,
    viewerSeat,
  };
}
