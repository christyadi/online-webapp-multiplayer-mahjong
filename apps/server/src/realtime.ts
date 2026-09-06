import {
  gameCommandSchema,
  roomMutationSchema,
  type CommandAcknowledgement,
  type GameSnapshot,
} from "@mahjong-together/shared";
import type { Server, Socket } from "socket.io";

import {
  guestTokenFromCookieHeader,
  type GuestSession,
  type SessionStore,
} from "./identity/sessions.js";
import { RoomError, type RoomStore } from "./rooms/rooms.js";

export type ClientEvents = {
  "game:command": (
    command: unknown,
    acknowledge: (acknowledgement: CommandAcknowledgement) => void,
  ) => void;
  "room:watch": (acknowledge: (result: WatchResult) => void) => void;
};

export type ServerEvents = {
  "game:snapshot": (snapshot: GameSnapshot) => void;
  "room:changed": () => void;
  "session:replaced": () => void;
};

type WatchResult = Readonly<{ ok: true }> | Readonly<{ code: string; message: string; ok: false }>;

type RealtimeServer = Server<ClientEvents, ServerEvents>;
type RealtimeSocket = Socket<ClientEvents, ServerEvents>;
type RealtimeOptions = Readonly<{
  appOrigin?: string;
  disconnectGraceMs?: number;
  roomStore: RoomStore;
  sessionStore: SessionStore;
}>;

export function configureRealtime(server: RealtimeServer, options: RealtimeOptions): () => void {
  const activeSockets = new Map<string, RealtimeSocket>();
  const commandTimes = new Map<string, number[]>();
  const disconnectTimers = new Map<string, NodeJS.Timeout>();
  const socketControllers = new Map<string, string>();
  const socketSessions = new Map<string, GuestSession>();
  const disconnectGraceMs = options.disconnectGraceMs ?? 250;
  const appHost = options.appOrigin === undefined ? undefined : new URL(options.appOrigin).host;

  server.use((socket, next) => {
    const requestOrigin = socket.handshake.headers.origin;
    const sameOriginPollingRequest =
      requestOrigin === undefined &&
      appHost !== undefined &&
      socket.handshake.headers.host === appHost &&
      socket.handshake.headers["sec-fetch-site"] === "same-origin";
    if (
      options.appOrigin !== undefined &&
      requestOrigin !== options.appOrigin &&
      !sameOriginPollingRequest
    ) {
      next(new Error("origin-rejected"));
      return;
    }
    const session = options.sessionStore.find(
      guestTokenFromCookieHeader(socket.handshake.headers.cookie),
    );
    if (session === null) {
      next(new Error("session-required"));
      return;
    }
    const controllerId = roomMutationSchema.shape.commandId.safeParse(
      socket.handshake.auth.controllerId,
    );
    if (!controllerId.success) {
      next(new Error("controller-required"));
      return;
    }
    socketSessions.set(socket.id, session);
    socketControllers.set(socket.id, controllerId.data);
    next();
  });

  const broadcast = async (code: string) => {
    const sockets = await server.in(code).fetchSockets();
    for (const socket of sockets) {
      const session = socketSessions.get(socket.id);
      if (session === undefined) continue;
      socket.emit("room:changed");
      try {
        socket.emit("game:snapshot", options.roomStore.getGameSnapshot(session, code));
      } catch (error) {
        if (!(error instanceof RoomError)) throw error;
      }
    }
  };
  const unsubscribe = options.roomStore.subscribe((code) => {
    void broadcast(code).catch(() => {
      process.stderr.write("Room snapshot broadcast failed\n");
    });
  });

  server.on("connection", (socket) => {
    const session = socketSessions.get(socket.id);
    const controllerId = socketControllers.get(socket.id);
    if (session === undefined || controllerId === undefined) {
      socket.disconnect(true);
      return;
    }
    const pendingDisconnect = disconnectTimers.get(session.guestId);
    if (pendingDisconnect !== undefined) {
      clearTimeout(pendingDisconnect);
      disconnectTimers.delete(session.guestId);
    }

    const previous = activeSockets.get(session.guestId);
    activeSockets.set(session.guestId, socket);
    options.sessionStore.claimController(session.guestId, controllerId);
    if (previous !== undefined && previous.id !== socket.id) {
      previous.emit("session:replaced");
      previous.disconnect(true);
    }

    const watchCurrentRoom = () => {
      const room = options.roomStore.getCurrent(session);
      if (room === null) return false;
      void socket.join(room.code);
      if (room.phase === "active") {
        socket.emit("game:snapshot", options.roomStore.getGameSnapshot(session, room.code));
      }
      return true;
    };
    watchCurrentRoom();

    socket.on("room:watch", (acknowledge) => {
      if (typeof acknowledge !== "function") return;
      try {
        acknowledge(
          watchCurrentRoom()
            ? { ok: true }
            : { code: "not-in-room", message: "Join a room first", ok: false },
        );
      } catch (error) {
        acknowledge({
          code: error instanceof RoomError ? error.code : "room-error",
          message: error instanceof Error ? error.message : "Unable to watch this room",
          ok: false,
        });
      }
    });

    socket.on("game:command", (input, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      const command = gameCommandSchema.safeParse(input);
      const exactCachedRetry =
        command.success && options.roomStore.isExactCachedGameCommand(session, command.data);
      if (!consumeCommandRate(commandTimes, session.guestId, exactCachedRetry, Date.now())) {
        acknowledge({
          code: "rate-limit",
          commandId: commandIdFrom(input),
          message: "Too many game commands; try again in a moment",
          ok: false,
        });
        return;
      }
      if (!command.success) {
        acknowledge({
          code: "invalid-command",
          commandId: commandIdFrom(input),
          message: "Game command was not understood",
          ok: false,
        });
        return;
      }
      void options.roomStore
        .executeGameCommand(session, command.data)
        .then((acknowledgement) => {
          acknowledge(acknowledgement);
          if (
            !acknowledgement.ok &&
            (acknowledgement.code === "stale-decision" || acknowledgement.code === "stale-hand")
          ) {
            try {
              socket.emit(
                "game:snapshot",
                options.roomStore.getGameSnapshot(session, command.data.roomId),
              );
            } catch (error) {
              if (!(error instanceof RoomError)) {
                process.stderr.write("Stale-command snapshot failed\n");
              }
            }
          }
        })
        .catch((error: unknown) => {
          acknowledge({
            code: error instanceof RoomError ? error.code : "command-failed",
            commandId: command.data.commandId,
            message: error instanceof Error ? error.message : "Game command failed",
            ok: false,
          });
        });
    });

    socket.on("disconnect", () => {
      socketSessions.delete(socket.id);
      socketControllers.delete(socket.id);
      if (activeSockets.get(session.guestId)?.id !== socket.id) return;
      const timer = setTimeout(() => {
        disconnectTimers.delete(session.guestId);
        if (activeSockets.get(session.guestId)?.id !== socket.id) return;
        activeSockets.delete(session.guestId);
        options.sessionStore.releaseController(session.guestId, controllerId);
        options.roomStore.disconnect(session.guestId);
      }, disconnectGraceMs);
      timer.unref();
      disconnectTimers.set(session.guestId, timer);
    });
  });

  return () => {
    unsubscribe();
    for (const timer of disconnectTimers.values()) clearTimeout(timer);
    disconnectTimers.clear();
  };
}

function consumeCommandRate(
  timesByGuest: Map<string, number[]>,
  guestId: string,
  exactCachedRetry: boolean,
  now: number,
): boolean {
  const cutoff = now - 1_000;
  const recent = (timesByGuest.get(guestId) ?? []).filter((time) => time > cutoff);
  if (exactCachedRetry) return true;
  if (recent.length >= 10) {
    timesByGuest.set(guestId, recent);
    return false;
  }
  recent.push(now);
  timesByGuest.set(guestId, recent);
  return true;
}

function commandIdFrom(input: unknown): string {
  return validCommandIdFrom(input) ?? "00000000-0000-4000-8000-000000000000";
}

function validCommandIdFrom(input: unknown): string | null {
  if (typeof input === "object" && input !== null && "commandId" in input) {
    const parsed = gameCommandSchema.shape.commandId.safeParse(input.commandId);
    if (parsed.success) return parsed.data;
  }
  return null;
}
