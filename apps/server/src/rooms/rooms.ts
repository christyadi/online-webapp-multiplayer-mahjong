import { createHash, randomInt, randomUUID } from "node:crypto";

import {
  gameSnapshotSchema,
  tileTypeIndex,
  type CommandAcknowledgement,
  type GameCommand,
  type GameSnapshot,
  type RoomInvitation,
  type RoomView,
} from "@mahjong-together/shared";

import { chooseBotAction } from "../game/bot.js";
import {
  legalActionsForSeat,
  otherSeats,
  rotateDealer,
  startHand,
  transition,
  type HandAction,
  type HandState,
  type TransitionResult,
} from "../game/state.js";
import { createTileSet, shuffleTiles, type SeatIndex } from "../game/wall.js";
import type { GuestSession } from "../identity/sessions.js";

const ROOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const REMATCH_WINDOW_MS = 3 * 60 * 1000;

type HumanSeat = {
  connected: boolean;
  guestId: string;
  host: boolean;
  joinedHandId: string | null;
  joinedOrder: number;
  kind: "human";
  nickname: string;
  ready: boolean;
};

type BotSeat = Readonly<{ kind: "bot" }>;
type RoomSeat = HumanSeat | BotSeat | null;

type Room = {
  botTimerCancels: Map<SeatIndex, () => void>;
  code: string;
  commandCounts: Map<string, number>;
  commands: Map<string, Readonly<{ acknowledgement: CommandAcknowledgement; payloadHash: string }>>;
  createdAt: number;
  deadline: number | null;
  deadlineTimerCancel: (() => void) | null;
  hand: HandState | null;
  lastActivityAt: number;
  nextDealer: SeatIndex | null;
  noConnectedHumansSince: number | null;
  phase: "lobby" | "active";
  queue: Promise<void>;
  rematchDeadline: number | null;
  rematchTimerCancel: (() => void) | null;
  roomRevision: number;
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
  botDelayMs?: () => number;
  clock?: () => number;
  codeFactory?: () => string;
  handFactory?: (dealer: SeatIndex) => HandState;
  maxRooms?: number;
  scheduler?: RoomScheduler;
}>;

export type RoomScheduler = (delayMs: number, callback: () => void) => () => void;

export class RoomStore {
  readonly #botDelayMs: () => number;
  readonly #clock: () => number;
  readonly #codeFactory: () => string;
  readonly #guestRooms = new Map<string, string>();
  readonly #handFactory: (dealer: SeatIndex) => HandState;
  #joinSequence = 0;
  readonly #listeners = new Set<(code: string) => void>();
  readonly #maxRooms: number;
  readonly #rooms = new Map<string, Room>();
  readonly #scheduler: RoomScheduler;

  constructor(options: RoomStoreOptions = {}) {
    this.#botDelayMs = options.botDelayMs ?? (() => randomInt(2_000, 8_001));
    this.#clock = options.clock ?? Date.now;
    this.#codeFactory = options.codeFactory ?? generateRoomCode;
    this.#handFactory =
      options.handFactory ??
      ((dealer) => startHand(randomUUID(), dealer, shuffleTiles(createTileSet())));
    this.#maxRooms = options.maxRooms ?? 20;
    this.#scheduler = options.scheduler ?? defaultScheduler;
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
      botTimerCancels: new Map(),
      code,
      commandCounts: new Map(),
      commands: new Map(),
      createdAt: now,
      deadline: null,
      deadlineTimerCancel: null,
      hand: null,
      lastActivityAt: now,
      nextDealer: null,
      noConnectedHumansSince: null,
      phase: "lobby",
      queue: Promise.resolve(),
      rematchDeadline: null,
      rematchTimerCancel: null,
      roomRevision: 1,
      seats: [creator, null, null, null],
    };
    this.#rooms.set(code, room);
    this.#guestRooms.set(session.guestId, code);
    this.notify(code);
    return viewFor(room, session.guestId);
  }

  join(session: GuestSession, code: string, nickname: string, preferredSeat?: number): RoomView {
    this.cleanupExpired();
    const currentCode = this.#guestRooms.get(session.guestId);
    if (currentCode === code) return this.getForGuest(session, code);
    this.assertGuestIsFree(session.guestId);

    const room = this.requireRoom(code);
    if (!isJoinable(room)) {
      throw new RoomError("room-active", "This hand has already started");
    }
    const availableSeats = availableJoinSeats(room);
    if (availableSeats.length === 0)
      throw new RoomError("room-full", "This room already has four players");
    const seat = (preferredSeat as SeatIndex | undefined) ?? availableSeats[0];
    if (seat === undefined || !availableSeats.includes(seat)) {
      throw new RoomError("seat-unavailable", "That seat is no longer available");
    }

    room.seats[seat] = this.createHumanSeat(session.guestId, nickname, false);
    room.lastActivityAt = this.#clock();
    room.noConnectedHumansSince = null;
    room.roomRevision += 1;
    this.#guestRooms.set(session.guestId, code);
    this.notify(code);
    return viewFor(room, session.guestId);
  }

  getInvitation(code: string): RoomInvitation {
    this.cleanupExpired();
    const room = this.requireRoom(code);
    if (!isJoinable(room)) throw new RoomError("room-active", "This hand has already started");
    return { availableSeats: availableJoinSeats(room), code: room.code };
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
    room.roomRevision += 1;
    this.notify(code);
    return viewFor(room, session.guestId);
  }

  start(session: GuestSession, code: string): RoomView {
    this.cleanupExpired();
    const { room, seat } = this.requireHumanMembership(session.guestId, code);
    const previousHand = room.hand;
    const rematch = room.phase === "active" && previousHand?.phase === "hand-ended";
    if (room.phase !== "lobby" && !rematch)
      throw new RoomError("room-active", "The hand has started");
    if (!seat.host) throw new RoomError("host-only", "Only the host can start the hand");
    const humans = room.seats.filter(
      (occupant): occupant is HumanSeat => occupant?.kind === "human",
    );
    if (!rematch && humans.some((human) => human.connected && !human.ready)) {
      throw new RoomError("players-not-ready", "Every connected player must be ready");
    }
    this.cancelRematchExpiry(room);
    for (const seatIndex of [0, 1, 2, 3] as const) {
      room.seats[seatIndex] ??= { kind: "bot" };
    }
    const dealer =
      room.nextDealer ??
      (() => {
        const dealerIndex = room.seats.findIndex(
          (occupant) => occupant?.kind === "human" && occupant.host,
        );
        if (dealerIndex === -1) throw new Error("Lobby host invariant failed");
        return dealerIndex as SeatIndex;
      })();
    room.hand = this.#handFactory(dealer);
    for (const occupant of room.seats) {
      if (occupant?.kind === "human") occupant.joinedHandId = room.hand.handId;
    }
    room.nextDealer = rotateDealer(room.hand.dealer);
    room.phase = "active";
    if (room.hand.phase === "hand-ended") this.scheduleRematchExpiry(room);
    room.lastActivityAt = this.#clock();
    room.roomRevision += 1;
    this.refreshAutomation(room, true);
    this.notify(code);
    return viewFor(room, session.guestId);
  }

  returnToLobby(session: GuestSession, code: string): RoomView {
    this.cleanupExpired();
    const { room, seat } = this.requireHumanMembership(session.guestId, code);
    if (room.phase !== "active" || room.hand?.phase !== "hand-ended") {
      throw new RoomError("hand-active", "Finish the hand before returning to the lobby");
    }
    if (!seat.host)
      throw new RoomError("host-only", "Only the host can return the table to the lobby");
    this.cancelAutomation(room);
    room.hand = null;
    room.phase = "lobby";
    this.resetLobbySeats(room);
    room.lastActivityAt = this.#clock();
    room.roomRevision += 1;
    this.notify(code);
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
    if (!this.hasHumanSeat(room)) {
      this.deleteRoom(room);
      return;
    }
    room.roomRevision += 1;
    this.refreshAutomation(room, false);
    this.notify(code);
  }

  connect(guestId: string): Promise<void> {
    const code = this.#guestRooms.get(guestId);
    const room = code === undefined ? undefined : this.#rooms.get(code);
    if (room?.phase !== "active") return Promise.resolve();
    return this.enqueue(room, () => {
      this.resolveExpiredDecision(room);
      const seatIndex = findHumanSeat(room, guestId);
      if (seatIndex === null) return;
      const seat = room.seats[seatIndex];
      if (seat?.kind !== "human" || seat.connected) return;
      seat.connected = true;
      room.noConnectedHumansSince = null;
      room.lastActivityAt = this.#clock();
      room.roomRevision += 1;
      this.refreshAutomation(room, false);
      this.notify(room.code);
    });
  }

  disconnect(guestId: string): Promise<void> {
    this.cleanupExpired();
    const code = this.#guestRooms.get(guestId);
    if (code === undefined) return Promise.resolve();
    const room = this.#rooms.get(code);
    if (room === undefined) return Promise.resolve();
    return this.enqueue(room, () => {
      const seatIndex = findHumanSeat(room, guestId);
      if (seatIndex === null) return;
      const seat = room.seats[seatIndex];
      if (seat?.kind !== "human") return;

      if (room.phase === "lobby" || room.hand?.phase === "hand-ended") {
        room.seats[seatIndex] = null;
        this.#guestRooms.delete(guestId);
        this.ensureHost(room);
      } else {
        seat.connected = false;
        this.resolveExpiredDecision(room);
      }
      room.lastActivityAt = this.#clock();
      this.updateConnectedState(room);
      if (!this.hasHumanSeat(room)) {
        this.deleteRoom(room);
        return;
      }
      room.roomRevision += 1;
      this.refreshAutomation(room, false);
      this.notify(code);
    });
  }

  cleanupExpired(): void {
    const now = this.#clock();
    for (const room of this.#rooms.values()) {
      const reachedLifetime = now - room.createdAt >= 12 * 60 * 60 * 1000;
      const inactiveLobby =
        room.phase === "lobby" && now - room.lastActivityAt >= 2 * 60 * 60 * 1000;
      const emptyTooLong =
        room.noConnectedHumansSince !== null && now - room.noConnectedHumansSince >= 30 * 60 * 1000;
      const resultExpired = room.rematchDeadline !== null && now >= room.rematchDeadline;
      if (
        !this.hasHumanSeat(room) ||
        reachedLifetime ||
        inactiveLobby ||
        emptyTooLong ||
        resultExpired
      ) {
        this.deleteRoom(room);
      }
    }
  }

  startCleanup(intervalMs = 60_000): () => void {
    const timer = setInterval(() => this.cleanupExpired(), intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  subscribe(listener: (code: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getGameSnapshot(session: GuestSession, code: string): GameSnapshot {
    this.cleanupExpired();
    const { room, seatIndex } = this.requireHumanMembership(session.guestId, code);
    if (room.phase !== "active" || room.hand === null) {
      throw new RoomError("hand-not-active", "No hand is currently active");
    }
    return snapshotFor(room, seatIndex, this.#clock());
  }

  isExactCachedGameCommand(session: GuestSession, command: GameCommand): boolean {
    const room = this.#rooms.get(command.roomId);
    if (room === undefined || this.#guestRooms.get(session.guestId) !== room.code) return false;
    const cached = room.commands.get(`${session.guestId}:${command.commandId}`);
    return cached?.payloadHash === hashCommand(command);
  }

  executeGameCommand(session: GuestSession, command: GameCommand): Promise<CommandAcknowledgement> {
    return Promise.resolve().then(() => {
      this.cleanupExpired();
      const room = this.requireRoom(command.roomId);
      return this.enqueue(room, () => this.executeGameCommandNow(room, session, command));
    });
  }

  get size(): number {
    return this.#rooms.size;
  }

  enqueue<T>(room: Room, action: () => T | Promise<T>): Promise<T> {
    const result = room.queue.then(action, action);
    room.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  executeGameCommandNow(
    room: Room,
    session: GuestSession,
    command: GameCommand,
  ): CommandAcknowledgement {
    const membership = this.requireHumanMembership(session.guestId, room.code);
    const cacheKey = `${session.guestId}:${command.commandId}`;
    const payloadHash = hashCommand(command);
    const cached = room.commands.get(cacheKey);
    if (cached !== undefined) {
      return cached.payloadHash === payloadHash
        ? cached.acknowledgement
        : {
            code: "command-id-reused",
            commandId: command.commandId,
            message: "This command ID was already used for a different request",
            ok: false,
            roomRevision: room.roomRevision,
          };
    }

    const commandCount = room.commandCounts.get(session.guestId) ?? 0;
    if (commandCount >= 10_000) {
      return {
        code: "command-limit",
        commandId: command.commandId,
        message: "This guest has reached the room command limit",
        ok: false,
        roomRevision: room.roomRevision,
      };
    }
    room.commandCounts.set(session.guestId, commandCount + 1);
    this.resolveExpiredDecision(room);

    let acknowledgement: CommandAcknowledgement;
    if (room.phase !== "active" || room.hand === null) {
      acknowledgement = rejectedCommand(command, "hand-not-active", "No hand is active", room);
    } else if (command.handId !== room.hand.handId) {
      acknowledgement = rejectedCommand(command, "stale-hand", "This hand has ended", room);
    } else {
      const result = transition(room.hand, membership.seatIndex, {
        ...command.action,
        decisionId: command.decisionId,
      });
      if (result.ok) {
        this.commitTransition(room, result);
        acknowledgement = {
          commandId: command.commandId,
          ok: true,
          roomRevision: room.roomRevision,
        };
      } else {
        acknowledgement = rejectedCommand(command, result.code, result.message, room);
      }
    }
    room.commands.set(cacheKey, { acknowledgement, payloadHash });
    return acknowledgement;
  }

  commitTransition(
    room: Room,
    result: Extract<TransitionResult, { ok: true }>,
    deferAutomation = false,
  ): void {
    const previousDecision = room.hand?.phase === "hand-ended" ? null : room.hand?.decisionId;
    room.hand = result.state;
    if (result.state.phase === "hand-ended") {
      room.nextDealer = rotateDealer(result.state.dealer);
      this.resetReadyAfterHand(room);
    }
    room.roomRevision += 1;
    room.lastActivityAt = this.#clock();
    if (result.state.phase === "hand-ended") {
      if (!this.hasHumanSeat(room)) {
        this.deleteRoom(room);
        return;
      }
      this.scheduleRematchExpiry(room);
    }
    if (!deferAutomation) {
      const nextDecision = result.state.phase === "hand-ended" ? null : result.state.decisionId;
      this.refreshAutomation(room, previousDecision !== nextDecision);
    }
    this.notify(room.code);
  }

  resolveExpiredDecision(room: Room): void {
    const hand = room.hand;
    if (
      hand === null ||
      hand.phase === "hand-ended" ||
      room.deadline === null ||
      this.#clock() < room.deadline
    ) {
      return;
    }

    const expiredDecisionId = hand.decisionId;
    this.cancelAutomation(room);
    if (hand.phase === "awaiting-discard") {
      const action = this.isBotControlled(room, hand.turn)
        ? this.botAction(hand, hand.turn)
        : timeoutDiscardAction(hand);
      if (action === null) throw new Error("Expired discard decision has no legal action");
      const result = transition(hand, hand.turn, action);
      if (!result.ok) throw new Error(`Expired discard transition failed: ${result.code}`);
      this.commitTransition(room, result);
      return;
    }

    const unanswered =
      hand.phase === "awaiting-discard-claims"
        ? hand.eligible
            .filter(({ seat }) => hand.responses[seat] === undefined)
            .map(({ seat }) => seat)
        : hand.eligible.filter((seat) => hand.responses[seat] === undefined);
    for (const seat of unanswered) {
      const current = room.hand;
      if (
        current === null ||
        current.phase === "hand-ended" ||
        current.decisionId !== expiredDecisionId
      ) {
        break;
      }
      const action: HandAction =
        current.phase === "awaiting-discard-claims"
          ? {
              choice: { kind: "pass" },
              decisionId: current.decisionId,
              kind: "respond-to-discard",
            }
          : {
              choice: "pass",
              decisionId: current.decisionId,
              kind: "respond-to-kong-robbery",
            };
      const result = transition(current, seat, action);
      if (!result.ok) throw new Error(`Expired claim transition failed: ${result.code}`);
      this.commitTransition(room, result, true);
    }
    const current = room.hand;
    this.refreshAutomation(
      room,
      current === null ||
        current.phase === "hand-ended" ||
        current.decisionId !== expiredDecisionId,
    );
  }

  refreshAutomation(room: Room, resetDeadline: boolean): void {
    const hand = room.hand;
    if (hand === null || hand.phase === "hand-ended") {
      this.cancelAutomation(room);
      return;
    }
    if (resetDeadline || room.deadline === null) {
      this.cancelAutomation(room);
      room.deadline = this.#clock() + (hand.phase === "awaiting-discard" ? 30_000 : 10_000);
      const capturedHandId = hand.handId;
      const capturedDecisionId = hand.decisionId;
      room.deadlineTimerCancel = this.#scheduler(Math.max(0, room.deadline - this.#clock()), () => {
        room.deadlineTimerCancel = null;
        void this.enqueue(room, () => {
          const current = room.hand;
          if (
            this.#rooms.get(room.code) !== room ||
            current === null ||
            current.phase === "hand-ended" ||
            current.handId !== capturedHandId ||
            current.decisionId !== capturedDecisionId
          ) {
            return;
          }
          this.resolveExpiredDecision(room);
        });
      });
    }
    this.reconcileBotTimers(room);
  }

  reconcileBotTimers(room: Room): void {
    const hand = room.hand;
    if (hand === null || hand.phase === "hand-ended" || room.deadline === null) return;
    for (const [seat, cancel] of room.botTimerCancels) {
      if (this.isBotControlled(room, seat) && legalActionsForSeat(hand, seat).kind !== "none") {
        continue;
      }
      cancel();
      room.botTimerCancels.delete(seat);
    }
    for (const seat of [0, 1, 2, 3] as const) {
      if (
        room.botTimerCancels.has(seat) ||
        !this.isBotControlled(room, seat) ||
        legalActionsForSeat(hand, seat).kind === "none"
      ) {
        continue;
      }
      const capturedHandId = hand.handId;
      const capturedDecisionId = hand.decisionId;
      const remaining = room.deadline - this.#clock();
      const cooldown = boundedBotDelay(this.#botDelayMs());
      const delay = Math.max(0, Math.min(cooldown, remaining > 0 ? remaining - 1 : 0));
      const cancel = this.#scheduler(delay, () => {
        room.botTimerCancels.delete(seat);
        void this.enqueue(room, () => {
          const current = room.hand;
          if (
            this.#rooms.get(room.code) !== room ||
            current === null ||
            current.phase === "hand-ended" ||
            current.handId !== capturedHandId ||
            current.decisionId !== capturedDecisionId
          ) {
            return;
          }
          this.resolveExpiredDecision(room);
          const afterExpiry = room.hand;
          if (
            afterExpiry === null ||
            afterExpiry.phase === "hand-ended" ||
            afterExpiry.decisionId !== capturedDecisionId ||
            !this.isBotControlled(room, seat)
          ) {
            return;
          }
          const action = this.botAction(afterExpiry, seat);
          if (action === null) return;
          const result = transition(afterExpiry, seat, action);
          if (!result.ok) throw new Error(`Bot transition failed: ${result.code}`);
          this.commitTransition(room, result);
        });
      });
      room.botTimerCancels.set(seat, cancel);
    }
  }

  botAction(hand: HandState, seat: SeatIndex): HandAction | null {
    const claimedTile =
      hand.phase === "awaiting-discard-claims"
        ? hand.players[hand.discard.seat].discards.find((tile) => tile.id === hand.discard.tileId)
        : undefined;

    const baseView = {
      concealedTiles: hand.players[seat].concealed,
      decisionId: hand.phase === "hand-ended" ? "" : hand.decisionId,
      legalActions: legalActionsForSeat(hand, seat),
      opponents: otherSeats(seat).map((opponentSeat) => ({
        discards: hand.players[opponentSeat].discards,
        melds: hand.players[opponentSeat].melds,
        seat: opponentSeat,
      })),
      ownDiscards: hand.players[seat].discards,
      ownMelds: hand.players[seat].melds,
      seat,
      wallRemaining: hand.wall.length,
    };

    return chooseBotAction(claimedTile !== undefined ? { ...baseView, claimedTile } : baseView);
  }

  isBotControlled(room: Room, seat: SeatIndex): boolean {
    const occupant = room.seats[seat];
    return occupant?.kind === "bot" || (occupant?.kind === "human" && !occupant.connected);
  }

  cancelAutomation(room: Room): void {
    room.deadlineTimerCancel?.();
    room.deadlineTimerCancel = null;
    for (const cancel of room.botTimerCancels.values()) cancel();
    room.botTimerCancels.clear();
    room.deadline = null;
  }

  cancelRematchExpiry(room: Room): void {
    room.rematchTimerCancel?.();
    room.rematchTimerCancel = null;
    room.rematchDeadline = null;
  }

  scheduleRematchExpiry(room: Room): void {
    this.cancelRematchExpiry(room);
    const deadline = this.#clock() + REMATCH_WINDOW_MS;
    room.rematchDeadline = deadline;
    this.scheduleRematchExpiryTimer(room, deadline);
  }

  scheduleRematchExpiryTimer(room: Room, deadline: number): void {
    room.rematchTimerCancel = this.#scheduler(Math.max(0, deadline - this.#clock()), () => {
      room.rematchTimerCancel = null;
      void this.enqueue(room, () => {
        if (this.#rooms.get(room.code) !== room || room.rematchDeadline !== deadline) return;
        const remaining = deadline - this.#clock();
        if (remaining > 0) {
          this.scheduleRematchExpiryTimer(room, deadline);
          return;
        }
        this.deleteRoom(room);
      });
    });
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
      joinedHandId: null,
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
    this.cancelAutomation(room);
    this.cancelRematchExpiry(room);
    this.#rooms.delete(room.code);
    for (const seat of room.seats) {
      if (seat?.kind === "human") this.#guestRooms.delete(seat.guestId);
    }
    this.notify(room.code);
  }

  ensureHost(room: Room): void {
    const humans = room.seats
      .filter((seat): seat is HumanSeat => seat?.kind === "human" && seat.connected)
      .sort((left, right) => left.joinedOrder - right.joinedOrder);
    if (humans.some((human) => human.host)) return;
    const nextHost = humans[0];
    if (nextHost !== undefined) nextHost.host = true;
  }

  resetReadyAfterHand(room: Room): void {
    for (const [seatIndex, seat] of room.seats.entries()) {
      if (seat?.kind !== "human") continue;
      if (!seat.connected) {
        this.#guestRooms.delete(seat.guestId);
        room.seats[seatIndex as SeatIndex] = null;
      } else {
        seat.ready = false;
      }
    }
    this.ensureHost(room);
    this.updateConnectedState(room);
  }

  resetLobbySeats(room: Room): void {
    for (const [seatIndex, seat] of room.seats.entries()) {
      if (seat?.kind === "bot") {
        room.seats[seatIndex as SeatIndex] = null;
      } else if (seat?.kind === "human" && !seat.connected) {
        this.#guestRooms.delete(seat.guestId);
        room.seats[seatIndex as SeatIndex] = null;
      } else if (seat?.kind === "human") {
        seat.ready = false;
      }
    }
    this.ensureHost(room);
    this.updateConnectedState(room);
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

  notify(code: string): void {
    for (const listener of this.#listeners) listener(code);
  }

  updateConnectedState(room: Room): void {
    const hasConnectedHuman = room.seats.some((seat) => seat?.kind === "human" && seat.connected);
    if (hasConnectedHuman) room.noConnectedHumansSince = null;
    else room.noConnectedHumansSince ??= this.#clock();
  }

  hasHumanSeat(room: Room): boolean {
    return room.seats.some((seat) => seat?.kind === "human");
  }
}

function snapshotFor(room: Room, viewerSeat: SeatIndex, now: number): GameSnapshot {
  const hand = room.hand;
  if (hand === null) throw new Error("Active hand invariant failed");
  const viewer = room.seats[viewerSeat];
  const viewerPlayedHand = viewer?.kind === "human" && viewer.joinedHandId === hand.handId;
  const revealAll = hand.phase === "hand-ended" && viewerPlayedHand;
  const pendingDiscard =
    hand.phase === "awaiting-discard-claims"
      ? {
          seat: hand.discard.seat,
          tile: requirePublicDiscard(hand, hand.discard.seat, hand.discard.tileId),
        }
      : null;
  const pendingAddedKong =
    hand.phase === "awaiting-kong-robbery"
      ? {
          seat: hand.proposal.declarer,
          tile: requireConcealedTile(hand, hand.proposal.declarer, hand.proposal.tileId),
        }
      : null;

  // Runtime validation at this private-state/public-DTO boundary prevents an
  // accidental wall or opposing concealed hand from entering a socket payload.
  return gameSnapshotSchema.parse({
    activeSeat: hand.phase === "awaiting-discard" ? hand.turn : null,
    deadline: room.deadline,
    rematchDeadline: hand.phase === "hand-ended" ? room.rematchDeadline : null,
    decisionId: hand.phase === "hand-ended" ? null : hand.decisionId,
    dealer: hand.dealer,
    drawnTileId:
      hand.phase === "awaiting-discard" && hand.turn === viewerSeat
        ? (hand.drawnTileId ?? null)
        : null,
    handId: hand.handId,
    legalActions: legalActionsForSeat(hand, viewerSeat),
    pendingAddedKong,
    pendingDiscard,
    phase: hand.phase,
    players: hand.players.map((player, seat) => {
      const occupant = room.seats[seat];
      if (occupant === null || occupant === undefined) {
        throw new Error("Active seat invariant failed");
      }
      return {
        concealedCount: player.concealed.length,
        concealedTiles:
          revealAll || (viewerPlayedHand && seat === viewerSeat) ? player.concealed : null,
        connected: occupant.kind === "human" && occupant.connected,
        controller: occupant.kind === "bot" || !occupant.connected ? "bot" : "human",
        discards: player.discards,
        melds: player.melds.map((meld) => ({
          concealed: meld.concealed,
          kind: meld.kind,
          tileCount: meld.tiles.length,
          tiles:
            !revealAll && meld.concealed && (seat !== viewerSeat || !viewerPlayedHand)
              ? null
              : meld.tiles,
        })),
        nickname: occupant.kind === "human" ? occupant.nickname : null,
        seat,
      };
    }),
    result: hand.phase === "hand-ended" && viewerPlayedHand ? hand.result : null,
    roomId: room.code,
    roomRevision: room.roomRevision,
    serverTime: now,
    viewerSeat,
    waitingSeats: waitingSeatsFor(hand),
    wallCount: hand.wall.length,
  });
}

function waitingSeatsFor(hand: HandState): SeatIndex[] {
  const seats = [0, 1, 2, 3] as const;
  if (hand.phase === "awaiting-discard") {
    return seats.filter((seat) => seat !== hand.turn);
  }
  if (hand.phase === "awaiting-discard-claims") return hand.eligible.map(({ seat }) => seat);
  if (hand.phase === "awaiting-kong-robbery") return [...hand.eligible];
  return [];
}

function requirePublicDiscard(hand: HandState, seat: SeatIndex, tileId: string) {
  const tile = hand.players[seat].discards.find((candidate) => candidate.id === tileId);
  if (tile === undefined) throw new Error("Pending discard snapshot invariant failed");
  return tile;
}

function requireConcealedTile(hand: HandState, seat: SeatIndex, tileId: string) {
  const tile = hand.players[seat].concealed.find((candidate) => candidate.id === tileId);
  if (tile === undefined) throw new Error("Pending added kong snapshot invariant failed");
  return tile;
}

function hashCommand(command: GameCommand): string {
  return createHash("sha256").update(JSON.stringify(command)).digest("base64url");
}

function timeoutDiscardAction(hand: Extract<HandState, { phase: "awaiting-discard" }>): HandAction {
  const concealed = hand.players[hand.turn].concealed;
  const drawnTile =
    hand.drawnTileId === undefined
      ? undefined
      : concealed.find((tile) => tile.id === hand.drawnTileId);
  const tile =
    drawnTile ??
    [...concealed].sort((left, right) => {
      const typeDifference = tileTypeIndex(right.type) - tileTypeIndex(left.type);
      return typeDifference !== 0 ? typeDifference : right.id.localeCompare(left.id);
    })[0];
  if (tile === undefined) throw new Error("Discard timeout has no concealed tile");
  return { decisionId: hand.decisionId, kind: "discard", tileId: tile.id };
}

function boundedBotDelay(delayMs: number): number {
  if (!Number.isFinite(delayMs)) return 1_000;
  return Math.max(1_000, Math.min(5_000, Math.floor(delayMs)));
}

function defaultScheduler(delayMs: number, callback: () => void): () => void {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return () => clearTimeout(timer);
}

function rejectedCommand(
  command: GameCommand,
  code: string,
  message: string,
  room: Room,
): CommandAcknowledgement {
  return {
    code,
    commandId: command.commandId,
    message,
    ok: false,
    roomRevision: room.roomRevision,
  };
}

function findHumanSeat(room: Room, guestId: string): SeatIndex | null {
  const index = room.seats.findIndex((seat) => seat?.kind === "human" && seat.guestId === guestId);
  return index === -1 ? null : (index as SeatIndex);
}

function isJoinable(room: Room): boolean {
  return room.phase === "lobby" || room.hand?.phase === "hand-ended";
}

function availableJoinSeats(room: Room): SeatIndex[] {
  return room.seats.flatMap((occupant, index) =>
    occupant === null || (room.hand?.phase === "hand-ended" && occupant.kind === "bot")
      ? [index as SeatIndex]
      : [],
  );
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
    roomRevision: room.roomRevision,
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
