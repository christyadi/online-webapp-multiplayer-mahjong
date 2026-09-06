import { createServer, type Server as HttpServer } from "node:http";

import type { CommandAcknowledgement, GameCommand, GameSnapshot } from "@mahjong-together/shared";
import { Server } from "socket.io";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { startHand } from "./game/state.js";
import { createTileSet } from "./game/wall.js";
import { GUEST_COOKIE_NAME, SessionStore, type GuestSession } from "./identity/sessions.js";
import { configureRealtime, type ClientEvents, type ServerEvents } from "./realtime.js";
import { RoomStore } from "./rooms/rooms.js";

type TestClient = ClientSocket<ServerEvents, ClientEvents>;

describe("Socket.IO game protocol", () => {
  it("ignores callback-less and wrong-callback packets without losing the connection", async () => {
    const harness = await createHarness();
    try {
      harness.clients[0].connect();
      await waitForConnect(harness.clients[0]);
      const rawClient = harness.clients[0] as unknown as {
        emit: (event: string, ...arguments_: unknown[]) => void;
      };
      rawClient.emit("room:watch");
      rawClient.emit("game:command", {});
      rawClient.emit("game:command", {}, "not-a-callback");

      await expect(watchRoom(harness.clients[0])).resolves.toBeUndefined();
      expect(harness.clients[0].connected).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("can watch a room created after the socket connected", async () => {
    const harness = await createHarness(false);
    try {
      harness.clients[0].connect();
      await waitForConnect(harness.clients[0]);
      const room = harness.rooms.create(harness.sessions[0], "Host");
      await watchRoom(harness.clients[0]);

      const changed = new Promise<void>((resolve) =>
        harness.clients[0].once("room:changed", resolve),
      );
      harness.rooms.join(harness.sessions[1], room.code, "Friend");
      await changed;
    } finally {
      await harness.close();
    }
  });

  it("sends recipient-private snapshots and replay-safe typed acknowledgements", async () => {
    const harness = await createHarness();
    try {
      const hostSnapshotPromise = nextSnapshot(harness.clients[0]);
      const friendSnapshotPromise = nextSnapshot(harness.clients[1]);
      harness.clients.forEach((client) => client.connect());
      await Promise.all(harness.clients.map(waitForConnect));
      const [hostSnapshot, friendSnapshot] = await Promise.all([
        hostSnapshotPromise,
        friendSnapshotPromise,
      ]);

      expect(hostSnapshot.players[1].concealedTiles).toBeNull();
      const friendTiles = friendSnapshot.players[1].concealedTiles;
      if (friendTiles === null) throw new Error("Expected friend tiles");
      const hostPayload = JSON.stringify(hostSnapshot);
      for (const tile of friendTiles) expect(hostPayload).not.toContain(tile.id);
      for (const tile of harness.initialWall) expect(hostPayload).not.toContain(tile.id);
      expect(hostSnapshot).not.toHaveProperty("wall");
      expect(friendSnapshot.legalActions).toEqual({ kind: "none" });

      if (hostSnapshot.legalActions.kind !== "discard" || hostSnapshot.decisionId === null) {
        throw new Error("Expected opening discard");
      }
      const command: GameCommand = {
        action: {
          kind: "discard",
          tileId: hostSnapshot.legalActions.discardTileIds[0],
        },
        commandId: uuid(10),
        decisionId: hostSnapshot.decisionId,
        handId: hostSnapshot.handId,
        roomId: hostSnapshot.roomId,
      };
      const changedSnapshot = nextSnapshot(harness.clients[0]);
      const acknowledgement = await sendCommand(harness.clients[0], command);
      expect(acknowledgement.ok).toBe(true);
      const currentSnapshot = await changedSnapshot;
      expect(currentSnapshot.roomRevision).toBe(acknowledgement.roomRevision);

      const recoverySnapshot = nextSnapshot(harness.clients[0]);
      const stale = await sendCommand(harness.clients[0], {
        ...command,
        commandId: uuid(12),
      });
      expect(stale).toMatchObject({ code: "stale-decision", ok: false });
      await expect(recoverySnapshot).resolves.toMatchObject({
        decisionId: currentSnapshot.decisionId,
        roomRevision: currentSnapshot.roomRevision,
      });

      const duplicate = await sendCommand(harness.clients[0], command);
      expect(duplicate).toEqual(acknowledgement);
      const changedPayload = await sendCommand(harness.clients[0], {
        ...command,
        action: { kind: "discard", tileId: "different" },
      });
      expect(changedPayload).toMatchObject({ code: "command-id-reused", ok: false });
      const malformed = await sendCommand(harness.clients[0], {
        ...command,
        commandId: uuid(11),
        unexpected: true,
      });
      expect(malformed).toMatchObject({ code: "invalid-command", ok: false });
    } finally {
      await harness.close();
    }
  });

  it("rejects unauthenticated and cross-origin handshakes", async () => {
    const harness = await createHarness();
    try {
      const noCookie = connect(harness.url, {
        auth: { controllerId: uuid(900) },
        autoConnect: false,
        extraHeaders: { Origin: harness.origin },
        transports: ["websocket"],
      });
      const wrongOrigin = connect(harness.url, {
        auth: { controllerId: uuid(901) },
        autoConnect: false,
        extraHeaders: {
          Cookie: `${GUEST_COOKIE_NAME}=${harness.tokens[0]}`,
          Origin: "https://attacker.example",
        },
        transports: ["websocket"],
      });
      const noCookieError = nextConnectError(noCookie);
      const wrongOriginError = nextConnectError(wrongOrigin);
      noCookie.connect();
      wrongOrigin.connect();

      await expect(noCookieError).resolves.toBe("session-required");
      await expect(wrongOriginError).resolves.toBe("origin-rejected");
      noCookie.disconnect();
      wrongOrigin.disconnect();
    } finally {
      await harness.close();
    }
  });

  it("limits new commands while allowing an exact cached retry", async () => {
    const harness = await createHarness();
    try {
      const snapshotPromise = nextSnapshot(harness.clients[1]);
      harness.clients[1].connect();
      await waitForConnect(harness.clients[1]);
      const snapshot = await snapshotPromise;
      if (snapshot.decisionId === null) throw new Error("Expected opening decision");
      const firstCommand: GameCommand = {
        action: { kind: "discard", tileId: "not-the-friend-turn" },
        commandId: uuid(100),
        decisionId: snapshot.decisionId,
        handId: snapshot.handId,
        roomId: snapshot.roomId,
      };

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const acknowledgement = await sendCommand(harness.clients[1], {
          ...firstCommand,
          commandId: uuid(100 + attempt),
        });
        expect(acknowledgement).toMatchObject({ code: "wrong-seat", ok: false });
      }
      const limited = await sendCommand(harness.clients[1], {
        ...firstCommand,
        commandId: uuid(110),
      });
      expect(limited).toMatchObject({ code: "rate-limit", ok: false });
      expect(await sendCommand(harness.clients[1], firstCommand)).toMatchObject({
        code: "wrong-seat",
        ok: false,
      });
    } finally {
      await harness.close();
    }
  });

  it("counts malformed repeated IDs and retains the rate window across reconnects", async () => {
    const harness = await createHarness();
    try {
      harness.clients[0].connect();
      await waitForConnect(harness.clients[0]);
      const malformed = { commandId: uuid(500), unexpected: true };
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await expect(sendCommand(harness.clients[0], malformed)).resolves.toMatchObject({
          code: "invalid-command",
          ok: false,
        });
      }
      await expect(sendCommand(harness.clients[0], malformed)).resolves.toMatchObject({
        code: "rate-limit",
        ok: false,
      });

      harness.clients[0].disconnect();
      await new Promise((resolve) => setTimeout(resolve, 20));
      harness.clients[0].connect();
      await waitForConnect(harness.clients[0]);
      await expect(sendCommand(harness.clients[0], malformed)).resolves.toMatchObject({
        code: "rate-limit",
        ok: false,
      });
    } finally {
      await harness.close();
    }
  });

  it("rejects HTTP mutations from a socket that lost latest-tab control", async () => {
    const harness = await createHarness(false);
    let replacement: TestClient | null = null;
    try {
      const room = harness.rooms.create(harness.sessions[0], "Host");
      harness.clients[0].connect();
      await waitForConnect(harness.clients[0]);
      const replaced = new Promise<void>((resolve) =>
        harness.clients[0].once("session:replaced", resolve),
      );
      const replacementController = uuid(700);
      replacement = connect(harness.url, {
        auth: { controllerId: replacementController },
        autoConnect: false,
        extraHeaders: {
          Cookie: `${GUEST_COOKIE_NAME}=${harness.tokens[0]}`,
          Origin: harness.origin,
        },
        transports: ["websocket"],
      });
      replacement.connect();
      await Promise.all([replaced, waitForConnect(replacement)]);

      const rejected = await postReady(harness, room.code, harness.controllerIds[0], uuid(701));
      expect(rejected.status).toBe(409);
      await expect(rejected.json()).resolves.toMatchObject({ code: "controller-replaced" });
      expect(harness.rooms.getCurrent(harness.sessions[0])?.viewerReady).toBe(false);

      const accepted = await postReady(harness, room.code, replacementController, uuid(702));
      expect(accepted.status).toBe(200);
      expect(harness.rooms.getCurrent(harness.sessions[0])?.viewerReady).toBe(true);
    } finally {
      replacement?.disconnect();
      await harness.close();
    }
  });
});

async function createHarness(prepareRoom = true): Promise<
  Readonly<{
    clients: [TestClient, TestClient];
    close: () => Promise<void>;
    controllerIds: [string, string];
    initialWall: readonly Readonly<{ id: string }>[];
    origin: string;
    rooms: RoomStore;
    sessions: [GuestSession, GuestSession];
    tokens: [string, string];
    url: string;
  }>
> {
  let tokenSequence = 0;
  const sessions = new SessionStore({
    tokenFactory: () => `test-token-${String((tokenSequence += 1))}`,
  });
  const established = [sessions.establish(undefined), sessions.establish(undefined)] as const;
  const sessionPair = established.map((entry) => entry.session) as [GuestSession, GuestSession];
  const tokenPair = established.map((entry) => entry.token) as [string, string];
  const initial = startHand(uuid(1), 0, createTileSet());
  const rooms = new RoomStore({
    codeFactory: () => "socketcode01",
    handFactory: () => structuredClone(initial),
  });
  if (prepareRoom) {
    const room = rooms.create(sessionPair[0], "Host");
    rooms.join(sessionPair[1], room.code, "Friend");
    rooms.setReady(sessionPair[0], room.code, true);
    rooms.setReady(sessionPair[1], room.code, true);
    rooms.start(sessionPair[0], room.code);
  }

  const origin = "https://mahjong.example";
  const httpServer = createServer(
    createApp({ appOrigin: origin, roomStore: rooms, sessionStore: sessions }),
  );
  const socketServer = new Server<ClientEvents, ServerEvents>(httpServer, {
    maxHttpBufferSize: 16 * 1024,
  });
  const stopRealtime = configureRealtime(socketServer, {
    appOrigin: origin,
    disconnectGraceMs: 10,
    roomStore: rooms,
    sessionStore: sessions,
  });
  const url = await listen(httpServer);
  const controllerIds = [uuid(1_000), uuid(1_001)] as [string, string];
  const clients = tokenPair.map((token) =>
    connect(url, {
      auth: { controllerId: controllerIds[token === tokenPair[0] ? 0 : 1] },
      autoConnect: false,
      extraHeaders: {
        Cookie: `${GUEST_COOKIE_NAME}=${token}`,
        Origin: origin,
      },
      transports: ["websocket"],
    }),
  ) as [TestClient, TestClient];

  return {
    clients,
    close: async () => {
      clients.forEach((client) => client.disconnect());
      stopRealtime();
      await new Promise<void>((resolve) => {
        void socketServer.close(() => resolve());
      });
    },
    controllerIds,
    initialWall: initial.wall,
    origin,
    rooms,
    sessions: sessionPair,
    tokens: tokenPair,
    url,
  };
}

async function listen(server: HttpServer): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP address");
  return `http://127.0.0.1:${String(address.port)}`;
}

function waitForConnect(client: TestClient): Promise<void> {
  if (client.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    client.once("connect", resolve);
    client.once("connect_error", reject);
  });
}

function nextSnapshot(client: TestClient): Promise<GameSnapshot> {
  return new Promise((resolve) => client.once("game:snapshot", resolve));
}

function nextConnectError(client: TestClient): Promise<string> {
  return new Promise((resolve) => client.once("connect_error", (error) => resolve(error.message)));
}

function watchRoom(client: TestClient): Promise<void> {
  return new Promise((resolve, reject) => {
    client.emit("room:watch", (result) => {
      if (result.ok) resolve();
      else reject(new Error(result.message));
    });
  });
}

function sendCommand(client: TestClient, command: unknown): Promise<CommandAcknowledgement> {
  return new Promise((resolve) => client.emit("game:command", command, resolve));
}

function postReady(
  harness: Readonly<{
    controllerIds: [string, string];
    origin: string;
    tokens: [string, string];
    url: string;
  }>,
  code: string,
  controllerId: string,
  commandId: string,
): Promise<Response> {
  return fetch(`${harness.url}/api/rooms/${code}/ready`, {
    body: JSON.stringify({ commandId, ready: true }),
    headers: {
      "content-type": "application/json",
      cookie: `${GUEST_COOKIE_NAME}=${harness.tokens[0]}`,
      origin: harness.origin,
      "x-controller-id": controllerId,
    },
    method: "POST",
  });
}

function uuid(number: number): `${string}-${string}-${string}-${string}-${string}` {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}
