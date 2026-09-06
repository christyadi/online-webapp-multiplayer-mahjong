import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { type PhysicalTile, type TileType } from "@mahjong-together/shared";
import { Server } from "socket.io";

import { createApp } from "../../apps/server/src/app.js";
import { findWinningDecomposition } from "../../apps/server/src/game/hand.js";
import { type HandEndedState, type PlayerHandState } from "../../apps/server/src/game/state.js";
import { createTileSet, type SeatIndex } from "../../apps/server/src/game/wall.js";
import { SessionStore } from "../../apps/server/src/identity/sessions.js";
import { configureRealtime } from "../../apps/server/src/realtime.js";
import { RoomStore } from "../../apps/server/src/rooms/rooms.js";

const port = Number.parseInt(process.env.PORT ?? "4176", 10);
let createdRooms = 0;

// This entrypoint is test-suite-only. Production startup never imports it and
// no fixture data is reachable through an HTTP or Socket.IO command.
const roomStore = new RoomStore({
  codeFactory: () => `winresult${String((createdRooms += 1)).padStart(3, "0")}`,
  handFactory: (dealer) => winningFixtureHand(dealer),
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
  process.stdout.write(`Mahjong Together win fixture listening on port ${String(port)}\n`);
});

httpServer.on("close", () => {
  stopRealtime();
  stopRoomCleanup();
});

function winningFixtureHand(dealer: SeatIndex): HandEndedState {
  if (dealer !== 0) throw new Error("Win fixture expects the host to deal first");
  const pool = createTileSet();
  const take = (type: TileType): PhysicalTile => {
    const index = pool.findIndex((tile) => tile.type === type);
    if (index === -1) throw new Error(`Missing ${type} tile for win fixture`);
    return pool.splice(index, 1)[0];
  };
  const winningTiles = [
    "d1",
    "d2",
    "d3",
    "b1",
    "b2",
    "b3",
    "c1",
    "c2",
    "c3",
    "east",
    "east",
    "east",
    "red",
    "red",
  ] satisfies readonly TileType[];
  const players: [PlayerHandState, PlayerHandState, PlayerHandState, PlayerHandState] = [
    { concealed: winningTiles.map(take), discards: [], melds: [] },
    { concealed: [], discards: [], melds: [] },
    { concealed: [], discards: [], melds: [] },
    { concealed: [], discards: [], melds: [] },
  ];
  for (const player of players.slice(1)) {
    while (player.concealed.length < 13) {
      const tile = pool.shift();
      if (tile === undefined) throw new Error("Win fixture tile pool exhausted");
      player.concealed.push(tile);
    }
  }
  const decomposition = findWinningDecomposition(players[0].concealed, []);
  const tileId = players[0].concealed.at(-1)?.id;
  if (decomposition === null || tileId === undefined)
    throw new Error("Win fixture hand invariant failed");
  return {
    dealer,
    decisionSequence: 1,
    handId: randomUUID(),
    phase: "hand-ended",
    players,
    result: { decomposition, kind: "win", source: "self-draw", tileId, winner: dealer },
    wall: pool,
  };
}
