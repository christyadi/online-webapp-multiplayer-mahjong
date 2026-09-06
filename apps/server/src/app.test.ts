import { sessionViewSchema } from "@mahjong-together/shared";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { RoomStore } from "./rooms/rooms.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("health endpoint", () => {
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
    const baseUrl = await listen(createApp({ appOrigin: origin, roomStore }));
    const cookies = await Promise.all(
      [0, 1, 2, 3, 4].map(async () => establishSession(baseUrl, origin)),
    );
    const created = await postJson(baseUrl, origin, cookies[0], "/api/rooms", {
      commandId: randomUUID(),
      nickname: " Same name ",
    });
    expect(created.status).toBe(201);
    const room = (await created.json()) as { code: string };
    expect(room.code).toBe("invitecode01");

    for (const cookie of cookies.slice(1, 4)) {
      const joined = await postJson(baseUrl, origin, cookie, `/api/rooms/${room.code}/join`, {
        commandId: randomUUID(),
        nickname: "Same name",
      });
      expect(joined.status).toBe(200);
    }
    const fifth = await postJson(baseUrl, origin, cookies[4], `/api/rooms/${room.code}/join`, {
      commandId: randomUUID(),
      nickname: "Fifth",
    });
    expect(fifth.status).toBe(409);
    await expect(fifth.json()).resolves.toEqual({
      code: "room-full",
      message: "This room already has four players",
    });

    const refreshed = await fetch(`${baseUrl}/api/rooms/current`, {
      headers: { cookie: cookies[1] },
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

    const intruder = await fetch(`${baseUrl}/api/rooms/${room.code}`, {
      headers: { cookie: cookies[4] },
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
});

async function listen(app: ReturnType<typeof createApp>): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a TCP address");
  return `http://127.0.0.1:${String(address.port)}`;
}

async function establishSession(baseUrl: string, origin: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/session`, { headers: { origin }, method: "POST" });
  expect(response.status).toBe(201);
  return cookieHeader(response.headers.get("set-cookie"));
}

async function postJson(
  baseUrl: string,
  origin: string,
  cookie: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie, origin },
    method: "POST",
  });
}

function cookieHeader(setCookie: string | null): string {
  if (setCookie === null) throw new Error("Expected a guest cookie");
  return setCookie.split(";", 1)[0];
}
