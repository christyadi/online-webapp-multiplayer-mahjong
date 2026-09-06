import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { type PhysicalTile, type TileType } from "@mahjong-together/shared";
import { Server } from "socket.io";

import { createApp } from "../../apps/server/src/app.js";
import {
  type AwaitingDiscardState,
  type PlayerHandState,
} from "../../apps/server/src/game/state.js";
import { createTileSet, type SeatIndex } from "../../apps/server/src/game/wall.js";
import { SessionStore } from "../../apps/server/src/identity/sessions.js";
import { configureRealtime } from "../../apps/server/src/realtime.js";
import { RoomStore } from "../../apps/server/src/rooms/rooms.js";

const port = Number.parseInt(process.env.PORT ?? "4175", 10);
let createdRooms = 0;

// This entrypoint is invoked only by playwright.claims.config.ts. Production
// startup uses apps/server/src/index.ts and has no fixture route or switch.
const roomStore = new RoomStore({
  codeFactory: () => `claimflow${String((createdRooms += 1)).padStart(3, "0")}`,
  handFactory: (dealer) => chowFixtureHand(dealer),
});
const sessionStore = new SessionStore();
const stopRoomCleanup = roomStore.startCleanup();
const httpServer = createServer(createApp({ roomStore, sessionStore }));
const realtimeServer = new Server(httpServer, {
  maxHttpBufferSize: 16 * 1024,
  pingInterval: 10_000,
  pingTimeout: 10_000,
});
const appOrigin = process.env.APP_ORIGIN;
const stopRealtime = configureRealtime(realtimeServer, {
  ...(appOrigin === undefined ? {} : { appOrigin }),
  roomStore,
  sessionStore,
});

httpServer.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Mahjong Together claim fixture listening on port ${String(port)}\n`);
});

httpServer.on("close", () => {
  stopRealtime();
  stopRoomCleanup();
});

function chowFixtureHand(dealer: SeatIndex): AwaitingDiscardState {
  if (dealer !== 0) throw new Error("Claim fixture expects the host to deal first");
  const pool = createTileSet();
  const take = (type: TileType): PhysicalTile => {
    const index = pool.findIndex((tile) => tile.type === type);
    if (index === -1) throw new Error(`Missing ${type} tile for claim fixture`);
    return pool.splice(index, 1)[0];
  };
  const takeNonD3 = (): PhysicalTile => {
    const index = pool.findIndex((tile) => tile.type !== "d3");
    if (index === -1) throw new Error("Claim fixture exhausted non-discard tiles");
    return pool.splice(index, 1)[0];
  };
  const player = (types: readonly TileType[]): PlayerHandState => ({
    concealed: types.map(take),
    discards: [],
    melds: [],
  });
  const players: [PlayerHandState, PlayerHandState, PlayerHandState, PlayerHandState] = [
    player(["d3"]),
    player(["d1", "d2", "d4", "d5"]),
    player([]),
    player([]),
  ];

  for (const [seat, current] of players.entries()) {
    const target = seat === dealer ? 14 : 13;
    while (current.concealed.length < target) current.concealed.push(takeNonD3());
  }

  const handId = randomUUID();
  const drawnTileId = players[dealer].concealed.at(-1)?.id;
  if (drawnTileId === undefined) throw new Error("Claim fixture dealer hand invariant failed");
  return {
    dealer,
    decisionId: `${handId}:1`,
    decisionSequence: 1,
    drawnTileId,
    handId,
    phase: "awaiting-discard",
    players,
    turn: dealer,
    turnOrigin: "dealer-initial",
    wall: pool,
  };
}
