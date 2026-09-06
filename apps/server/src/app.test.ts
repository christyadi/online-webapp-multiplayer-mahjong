import { sessionViewSchema } from "@mahjong-together/shared";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { guestTokenFromCookieHeader, SessionStore } from "./identity/sessions.js";
import { RoomStore } from "./rooms/rooms.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  vi.unstubAllEnvs();
});

describe("health endpoint", () => {
  it("fails closed when production starts without an application origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "");
    expect(() => createApp()).toThrow("APP_ORIGIN must be set");
    vi.unstubAllEnvs();
  });

  it("rejects a non-HTTPS external production origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "http://mahjong.example");
    expect(() => createApp()).toThrow("APP_ORIGIN must use HTTPS");
    vi.unstubAllEnvs();
  });

  it("returns only the service status", async () => {
    const server = createServer(createApp());
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected a TCP address");

    const response = await fetch(`http://127.0.0.1:${String(address.port)}/api/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("keeps unknown API routes as JSON 404 responses", async () => {
    const server = createServer(createApp());
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected a TCP address");

    const response = await fetch(`http://127.0.0.1:${String(address.port)}/api/missing`);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

describe("guest and lobby HTTP API", () => {
  it("issues a hardened opaque cookie and reuses it on refresh", async () => {
    const origin = "https://mahjong.example";
    const baseUrl = await listen(createApp({ appOrigin: origin, secureCookies: true }));

    const created = await fetch(`${baseUrl}/api/session`, {
      headers: { origin },
      method: "POST",
    });
    const cookie = created.headers.get("set-cookie");
    expect(created.status).toBe(201);
    expect(cookie).toMatch(
      /^mahjong_guest=[A-Za-z0-9_-]{43}; Max-Age=86400; Path=\/; HttpOnly; SameSite=Lax; Secure$/,
    );
    const sessionBody: unknown = await created.json();
    expect(sessionViewSchema.parse(sessionBody).expiresAt).toBeGreaterThan(Date.now());

    const reused = await fetch(`${baseUrl}/api/session`, {
      headers: { cookie: cookieHeader(cookie), origin },
      method: "POST",
    });
    expect(reused.status).toBe(200);
    expect(reused.headers.get("set-cookie")).toBeNull();
  });

  it("keeps seat control session-bound and returns a useful fifth-player rejection", async () => {
    const origin = "http://mahjong.test";
    const roomStore = new RoomStore({ codeFactory: () => "invitecode01" });
    const sessionStore = new SessionStore();
    const baseUrl = await listen(createApp({ appOrigin: origin, roomStore, sessionStore }));
    const cookies = await Promise.all(
      [0, 1, 2, 3, 4].map(async () => establishSession(baseUrl, origin, sessionStore)),
    );
    const created = await postJson(baseUrl, origin, cookies[0], "/api/rooms", {
      commandId: randomUUID(),
      nickname: " Same name ",
    });
    expect(created.status).toBe(201);
    const room = (await created.json()) as { roomCode: string };
    expect(room.roomCode).toBe("invitecode01");

    for (const cookie of cookies.slice(1, 4)) {
      const joined = await postJson(baseUrl, origin, cookie, `/api/rooms/${room.roomCode}/join`, {
        commandId: randomUUID(),
        nickname: "Same name",
      });
      expect(joined.status).toBe(200);
    }
    const fifth = await postJson(baseUrl, origin, cookies[4], `/api/rooms/${room.roomCode}/join`, {
      commandId: randomUUID(),
      nickname: "Fifth",
    });
    expect(fifth.status).toBe(409);
    await expect(fifth.json()).resolves.toEqual({
      code: "room-full",
      message: "This room already has four players",
    });

    const refreshed = await fetch(`${baseUrl}/api/rooms/current`, {
      headers: { cookie: cookies[1].cookie },
    });
    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({
      room: {
        seats: [
          { nickname: "Same name" },
          { nickname: "Same name" },
          { nickname: "Same name" },
          { nickname: "Same name" },
        ],
        viewerSeat: 1,
      },
    });

    const intruder = await fetch(`${baseUrl}/api/rooms/${room.roomCode}`, {
      headers: { cookie: cookies[4].cookie },
    });
    expect(intruder.status).toBe(403);
    await expect(intruder.json()).resolves.toMatchObject({ code: "not-in-room" });
  });

  it("rejects mutation requests outside the configured application origin", async () => {
    const baseUrl = await listen(createApp({ appOrigin: "https://allowed.example" }));
    const response = await fetch(`${baseUrl}/api/session`, {
      headers: { origin: "https://attacker.example" },
      method: "POST",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "origin-rejected" });
  });

  it("returns no current room after an in-memory server restart", async () => {
    const origin = "http://mahjong.test";
    const firstSessions = new SessionStore();
    const firstRooms = new RoomStore({ codeFactory: () => "restartcode1" });
    const firstBaseUrl = await listen(
      createApp({ appOrigin: origin, roomStore: firstRooms, sessionStore: firstSessions }),
    );
    const guest = await establishSession(firstBaseUrl, origin, firstSessions);
    const created = await postJson(firstBaseUrl, origin, guest, "/api/rooms", {
      commandId: randomUUID(),
      nickname: "Host",
    });
    expect(created.status).toBe(201);

    const secondBaseUrl = await listen(
      createApp({
        appOrigin: origin,
        roomStore: new RoomStore(),
        sessionStore: new SessionStore(),
      }),
    );
    const recoveredSession = await fetch(`${secondBaseUrl}/api/session`, {
      headers: { cookie: guest.cookie, origin },
      method: "POST",
    });
    expect(recoveredSession.status).toBe(201);
    const recoveredCookie = cookieHeader(recoveredSession.headers.get("set-cookie"));
    const current = await fetch(`${secondBaseUrl}/api/rooms/current`, {
      headers: { cookie: recoveredCookie },
    });
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toEqual({ room: null });
  });

  it("replays lobby commands once and rejects command-ID payload changes", async () => {
    const origin = "http://mahjong.test";
    const roomStore = new RoomStore({ codeFactory: () => "replaycode01" });
    const sessionStore = new SessionStore();
    const baseUrl = await listen(createApp({ appOrigin: origin, roomStore, sessionStore }));
    const cookie = await establishSession(baseUrl, origin, sessionStore);
    const commandId = randomUUID();
    const first = await postJson(baseUrl, origin, cookie, "/api/rooms", {
      commandId,
      nickname: "Host",
    });
    const replayed = await postJson(baseUrl, origin, cookie, "/api/rooms", {
      commandId,
      nickname: "Host",
    });

    expect(first.status).toBe(201);
    expect(replayed.status).toBe(201);
    expect(await replayed.json()).toEqual(await first.json());
    expect(roomStore.size).toBe(1);

    const changed = await postJson(baseUrl, origin, cookie, "/api/rooms", {
      commandId,
      nickname: "Different",
    });
    expect(changed.status).toBe(409);
    await expect(changed.json()).resolves.toMatchObject({ code: "command-id-reused" });
  });

  it("limits new room attempts while allowing a cached rejection retry", async () => {
    const origin = "http://mahjong.test";
    const sessionStore = new SessionStore();
    const baseUrl = await listen(createApp({ appOrigin: origin, sessionStore }));
    const cookie = await establishSession(baseUrl, origin, sessionStore);
    const firstCommandId = randomUUID();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await postJson(baseUrl, origin, cookie, "/api/rooms/missingroom1/join", {
        commandId: attempt === 0 ? firstCommandId : randomUUID(),
        nickname: "Guest",
      });
      expect(response.status).toBe(404);
    }
    const limited = await postJson(baseUrl, origin, cookie, "/api/rooms/missingroom1/join", {
      commandId: randomUUID(),
      nickname: "Guest",
    });
    expect(limited.status).toBe(429);

    const replayed = await postJson(baseUrl, origin, cookie, "/api/rooms/missingroom1/join", {
      commandId: firstCommandId,
      nickname: "Guest",
    });
    expect(replayed.status).toBe(404);
  });

  it("counts malformed room attempts before request validation", async () => {
    const origin = "http://mahjong.test";
    const sessionStore = new SessionStore();
    const baseUrl = await listen(createApp({ appOrigin: origin, sessionStore }));
    const guest = await establishSession(baseUrl, origin, sessionStore);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await postJson(baseUrl, origin, guest, "/api/rooms", {
        commandId: "not-a-uuid",
        nickname: "Host",
      });
      expect(response.status).toBe(400);
    }
    const limited = await postJson(baseUrl, origin, guest, "/api/rooms", {
      commandId: "still-not-a-uuid",
      nickname: "Host",
    });
    expect(limited.status).toBe(429);
  });

  it("limits unauthenticated session allocation by client address", async () => {
    const origin = "http://mahjong.test";
    const baseUrl = await listen(createApp({ appOrigin: origin }));
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/session`, {
        headers: { origin },
        method: "POST",
      });
      expect(response.status).toBe(201);
    }
    const limited = await fetch(`${baseUrl}/api/session`, {
      headers: { origin },
      method: "POST",
    });
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({ code: "rate-limit" });
  });
});

async function listen(app: ReturnType<typeof createApp>): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
  return `http://127.0.0.1:${String(address.port)}`;
}

type ControlledGuest = Readonly<{ controllerId: string; cookie: string }>;

async function establishSession(
  baseUrl: string,
  origin: string,
  sessionStore: SessionStore,
): Promise<ControlledGuest> {
  const response = await fetch(`${baseUrl}/api/session`, { headers: { origin }, method: "POST" });
  expect(response.status).toBe(201);
  const cookie = cookieHeader(response.headers.get("set-cookie"));
  const session = sessionStore.find(guestTokenFromCookieHeader(cookie));
  if (session === null) throw new Error("Expected stored guest session");
  const controllerId = randomUUID();
  sessionStore.claimController(session.guestId, controllerId);
  return { controllerId, cookie };
}

async function postJson(
  baseUrl: string,
  origin: string,
  guest: ControlledGuest,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      cookie: guest.cookie,
      origin,
      "x-controller-id": guest.controllerId,
    },
    method: "POST",
  });
}

function cookieHeader(setCookie: string | null): string {
  if (setCookie === null) throw new Error("Expected a guest cookie");
  return setCookie.split(";", 1)[0];
}
