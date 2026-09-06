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
  SessionCapacityError,
  SessionStore,
  type GuestSession,
} from "./identity/sessions.js";
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

  app.disable("x-powered-by");
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
      const established = sessionStore.establish(readGuestToken(request));
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
    const input = createRoomRequestSchema.safeParse(request.body);
    if (!input.success) {
      sendError(response, 400, "invalid-request", "Enter a nickname from 1 to 20 characters");
      return;
    }
    runRoomAction(response, () => roomStore.create(session, input.data.nickname), 201);
  });
  app.post("/api/rooms/:code/join", (request, response) => {
    const session = requireSession(request, response, sessionStore);
    if (session === null) return;
    const input = joinRoomRequestSchema.safeParse(request.body);
    if (!input.success) {
      sendError(response, 400, "invalid-request", "Enter a nickname from 1 to 20 characters");
      return;
    }
    runRoomAction(response, () =>
      roomStore.join(session, request.params.code, input.data.nickname),
    );
  });
  app.post("/api/rooms/:code/ready", (request, response) => {
    const session = requireSession(request, response, sessionStore);
    if (session === null) return;
    const input = setReadyRequestSchema.safeParse(request.body);
    if (!input.success) {
      sendError(response, 400, "invalid-request", "Ready status was not understood");
      return;
    }
    runRoomAction(response, () =>
      roomStore.setReady(session, request.params.code, input.data.ready),
    );
  });
  app.post("/api/rooms/:code/start", (request, response) => {
    const session = requireSession(request, response, sessionStore);
    if (session === null) return;
    const input = roomMutationSchema.safeParse(request.body);
    if (!input.success) {
      sendError(response, 400, "invalid-request", "Start request was not understood");
      return;
    }
    runRoomAction(response, () => roomStore.start(session, request.params.code));
  });
  app.post("/api/rooms/:code/leave", (request, response) => {
    const session = requireSession(request, response, sessionStore);
    if (session === null) return;
    const input = roomMutationSchema.safeParse(request.body);
    if (!input.success) {
      sendError(response, 400, "invalid-request", "Leave request was not understood");
      return;
    }
    runRoomAction(response, () => {
      roomStore.leave(session, request.params.code);
      return { left: true };
    });
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
  const cookieHeader = request.get("cookie");
  if (cookieHeader === undefined) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== GUEST_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
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

function runRoomAction(response: Response, action: () => unknown, successStatus = 200): void {
  try {
    response.status(successStatus).json(action());
  } catch (error) {
    if (!(error instanceof RoomError)) throw error;
    const status =
      error.code === "room-not-found"
        ? 404
        : error.code === "host-only" || error.code === "not-in-room"
          ? 403
          : 409;
    sendError(response, status, error.code, error.message);
  }
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
