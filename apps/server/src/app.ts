import {
  createRoomRequestSchema,
  joinRoomRequestSchema,
  roomMutationSchema,
  setReadyRequestSchema,
  type ApiError,
  type HealthResponse,
  type SessionView,
} from "@mahjong-together/shared";
import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GUEST_COOKIE_NAME,
  guestTokenFromCookieHeader,
  SessionCapacityError,
  SessionStore,
  type GuestSession,
} from "./identity/sessions.js";
import {
  CommandReplayError,
  SessionCommandReplay,
  SlidingWindowRateLimiter,
} from "./protocol/replay.js";
import { RoomError, RoomStore } from "./rooms/rooms.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export type AppOptions = Readonly<{
  appOrigin?: string;
  roomStore?: RoomStore;
  secureCookies?: boolean;
  sessionStore?: SessionStore;
}>;

export function createApp(options: AppOptions = {}) {
  const app = express();
  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  const roomStore = options.roomStore ?? new RoomStore();
  const secureCookies = options.secureCookies ?? appOrigin?.startsWith("https://") === true;
  const sessionStore = options.sessionStore ?? new SessionStore();
  const lobbyCommands = new SessionCommandReplay<HttpOutcome>();
  const roomAttemptLimiter = new SlidingWindowRateLimiter();
  const sessionCreationLimiter = new SlidingWindowRateLimiter();

  app.disable("x-powered-by");
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
  app.use((_request, response, next) => {
    response.set({
      "Content-Security-Policy":
        "default-src 'self'; base-uri 'none'; connect-src 'self' ws: wss:; font-src 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow",
    });
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET" || request.method === "HEAD" || appOrigin === undefined) {
      next();
      return;
    }
    if (request.get("origin") !== appOrigin) {
      sendError(response, 403, "origin-rejected", "Request origin is not allowed");
      return;
    }
    next();
  });
  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" } satisfies HealthResponse);
  });
  app.post("/api/session", (request, response) => {
    try {
      const presentedToken = readGuestToken(request);
      if (
        sessionStore.find(presentedToken) === null &&
        !sessionCreationLimiter.consume(clientAddress(request), 30, 60_000)
      ) {
        sendError(response, 429, "rate-limit", "Too many guest sessions from this address");
        return;
      }
      const established = sessionStore.establish(presentedToken);
      if (established.token !== undefined) {
        response.setHeader("set-cookie", serializeGuestCookie(established.token, secureCookies));
      }
      response.status(established.created ? 201 : 200).json({
        expiresAt: established.session.expiresAt,
      } satisfies SessionView);
    } catch (error) {
      if (error instanceof SessionCapacityError) {
        sendError(response, 503, "guest-capacity", error.message);
        return;
      }
      throw error;
    }
  });
  app.get("/api/rooms/current", (request, response) => {
    const session = requireSession(request, response, sessionStore);
    if (session === null) return;
    response.json({ room: roomStore.getCurrent(session) });
  });
  app.get("/api/rooms/:code", (request, response) => {
    const session = requireSession(request, response, sessionStore);
    if (session === null) return;
    runRoomAction(response, () => roomStore.getForGuest(session, request.params.code));
  });
  app.post("/api/rooms", (request, response) => {
    const session = requireSession(request, response, sessionStore);
    if (session === null) return;
    if (!requireActiveController(request, response, sessionStore, session)) return;
    const input = createRoomRequestSchema.safeParse(request.body);
    if (!input.success) {
      if (!consumeInvalidRoomAttempt(response, roomAttemptLimiter, session.guestId)) return;
      sendError(response, 400, "invalid-request", "Enter a nickname from 1 to 20 characters");
      return;
    }
    runRoomMutation(
      response,
      lobbyCommands,
      session,
      input.data.commandId,
      { input: input.data, operation: "create-room" },
      () => requireRoomAttempt(roomAttemptLimiter, session.guestId),
      () => {
        const room = roomStore.create(session, input.data.nickname);
        return { commandId: input.data.commandId, ok: true as const, roomCode: room.code };
      },
      201,
    );
  });
  app.post("/api/rooms/:code/join", (request, response) => {
    const session = requireSession(request, response, sessionStore);
    if (session === null) return;
    if (!requireActiveController(request, response, sessionStore, session)) return;
    const input = joinRoomRequestSchema.safeParse(request.body);
    if (!input.success) {
      if (!consumeInvalidRoomAttempt(response, roomAttemptLimiter, session.guestId)) return;
      sendError(response, 400, "invalid-request", "Enter a nickname from 1 to 20 characters");
      return;
    }
    runRoomMutation(
      response,
      lobbyCommands,
      session,
      input.data.commandId,
      { code: request.params.code, input: input.data, operation: "join-room" },
      () => requireRoomAttempt(roomAttemptLimiter, session.guestId),
      () => {
        const room = roomStore.join(session, request.params.code, input.data.nickname);
        return { commandId: input.data.commandId, ok: true as const, roomCode: room.code };
      },
    );
  });
  app.post("/api/rooms/:code/ready", (request, response) => {
    const session = requireSession(request, response, sessionStore);
    if (session === null) return;
    if (!requireActiveController(request, response, sessionStore, session)) return;
    const input = setReadyRequestSchema.safeParse(request.body);
    if (!input.success) {
      sendError(response, 400, "invalid-request", "Ready status was not understood");
      return;
    }
    runRoomMutation(
      response,
      lobbyCommands,
      session,
      input.data.commandId,
      { code: request.params.code, input: input.data, operation: "set-ready" },
      () => undefined,
      () => {
        const room = roomStore.setReady(session, request.params.code, input.data.ready);
        return { commandId: input.data.commandId, ok: true as const, roomCode: room.code };
      },
    );
  });
  app.post("/api/rooms/:code/start", (request, response) => {
    const session = requireSession(request, response, sessionStore);
    if (session === null) return;
    if (!requireActiveController(request, response, sessionStore, session)) return;
    const input = roomMutationSchema.safeParse(request.body);
    if (!input.success) {
      sendError(response, 400, "invalid-request", "Start request was not understood");
      return;
    }
    runRoomMutation(
      response,
      lobbyCommands,
      session,
      input.data.commandId,
      { code: request.params.code, operation: "start-room" },
      () => undefined,
      () => {
        const room = roomStore.start(session, request.params.code);
        return { commandId: input.data.commandId, ok: true as const, roomCode: room.code };
      },
    );
  });
  app.post("/api/rooms/:code/leave", (request, response) => {
    const session = requireSession(request, response, sessionStore);
    if (session === null) return;
    if (!requireActiveController(request, response, sessionStore, session)) return;
    const input = roomMutationSchema.safeParse(request.body);
    if (!input.success) {
      sendError(response, 400, "invalid-request", "Leave request was not understood");
      return;
    }
    runRoomMutation(
      response,
      lobbyCommands,
      session,
      input.data.commandId,
      { code: request.params.code, operation: "leave-room" },
      () => undefined,
      () => {
        roomStore.leave(session, request.params.code);
        return {
          commandId: input.data.commandId,
          ok: true as const,
          roomCode: request.params.code,
        };
      },
    );
  });
  app.post("/api/rooms/:code/return-to-lobby", (request, response) => {
    const session = requireSession(request, response, sessionStore);
    if (session === null) return;
    if (!requireActiveController(request, response, sessionStore, session)) return;
    const input = roomMutationSchema.safeParse(request.body);
    if (!input.success) {
      sendError(response, 400, "invalid-request", "Return-to-lobby request was not understood");
      return;
    }
    runRoomMutation(
      response,
      lobbyCommands,
      session,
      input.data.commandId,
      { code: request.params.code, operation: "return-to-lobby" },
      () => undefined,
      () => {
        const room = roomStore.returnToLobby(session, request.params.code);
        return { commandId: input.data.commandId, ok: true as const, roomCode: room.code };
      },
    );
  });
  app.use("/api", (_request, response) => {
    sendError(response, 404, "not-found", "Not found");
  });

  if (process.env.NODE_ENV === "production") {
    const webRoot = path.resolve(moduleDirectory, "../../web/dist");
    app.use(express.static(webRoot));
    app.use((request, response, next) => {
      if (request.method !== "GET" || !request.accepts("html")) {
        next();
        return;
      }
      response.sendFile(path.join(webRoot, "index.html"));
    });
  }

  app.use(
    (error: unknown, request: Request, response: Response, next: (error: unknown) => void) => {
      if (!request.path.startsWith("/api/") || !isBodyParserError(error)) {
        next(error);
        return;
      }
      if (error.type === "entity.too.large") {
        sendError(response, 413, "request-too-large", "Request body exceeds 16 KiB");
        return;
      }
      sendError(response, 400, "invalid-json", "Request body must be valid JSON");
    },
  );

  return app;
}

function readGuestToken(request: Request): string | undefined {
  return guestTokenFromCookieHeader(request.get("cookie"));
}

function clientAddress(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? "unknown";
}

function requireSession(
  request: Request,
  response: Response,
  store: SessionStore,
): GuestSession | null {
  const session = store.find(readGuestToken(request));
  if (session === null) sendError(response, 401, "session-required", "Start a guest session first");
  return session;
}

function requireActiveController(
  request: Request,
  response: Response,
  store: SessionStore,
  session: GuestSession,
): boolean {
  const controllerId = request.get("x-controller-id");
  if (
    controllerId !== undefined &&
    roomMutationSchema.shape.commandId.safeParse(controllerId).success &&
    store.isActiveController(session.guestId, controllerId)
  ) {
    return true;
  }
  sendError(
    response,
    409,
    "controller-replaced",
    "This guest session is controlled from another tab",
  );
  return false;
}

type HttpOutcome = Readonly<{ body: unknown; status: number }>;

class RequestRateError extends Error {}

function runRoomMutation(
  response: Response,
  replay: SessionCommandReplay<HttpOutcome>,
  session: GuestSession,
  commandId: string,
  payload: unknown,
  beforeNewCommand: () => void,
  action: () => unknown,
  successStatus = 200,
): void {
  try {
    const replayed = replay.run(session, commandId, payload, beforeNewCommand, () =>
      roomOutcome(action, successStatus),
    );
    sendOutcome(response, replayed.result);
  } catch (error) {
    if (error instanceof CommandReplayError) {
      sendError(response, error.code === "command-limit" ? 429 : 409, error.code, error.message);
      return;
    }
    if (error instanceof RequestRateError) {
      sendError(response, 429, "rate-limit", error.message);
      return;
    }
    throw error;
  }
}

function runRoomAction(response: Response, action: () => unknown, successStatus = 200): void {
  sendOutcome(response, roomOutcome(action, successStatus));
}

function roomOutcome(action: () => unknown, successStatus: number): HttpOutcome {
  try {
    return { body: action(), status: successStatus };
  } catch (error) {
    if (!(error instanceof RoomError)) throw error;
    const status =
      error.code === "room-not-found"
        ? 404
        : error.code === "host-only" || error.code === "not-in-room"
          ? 403
          : 409;
    return { body: { code: error.code, message: error.message } satisfies ApiError, status };
  }
}

function sendOutcome(response: Response, outcome: HttpOutcome): void {
  response.status(outcome.status).json(outcome.body);
}

function requireRoomAttempt(limiter: SlidingWindowRateLimiter, guestId: string): void {
  if (!limiter.consume(guestId, 10, 60_000)) {
    throw new RequestRateError("Too many room create or join attempts");
  }
}

function consumeInvalidRoomAttempt(
  response: Response,
  limiter: SlidingWindowRateLimiter,
  guestId: string,
): boolean {
  if (limiter.consume(guestId, 10, 60_000)) return true;
  sendError(response, 429, "rate-limit", "Too many room create or join attempts");
  return false;
}

function sendError(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ code, message } satisfies ApiError);
}

function serializeGuestCookie(token: string, secure: boolean): string {
  return [
    `${GUEST_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Max-Age=86400",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function isBodyParserError(error: unknown): error is Readonly<{ type: string }> {
  return typeof error === "object" && error !== null && "type" in error;
}
