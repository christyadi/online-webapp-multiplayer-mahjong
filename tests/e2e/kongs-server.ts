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

const port = Number.parseInt(process.env.PORT ?? "4177", 10);
let createdRooms = 0;

// This entrypoint is used only by Playwright. Production startup has no
// fixture switch or route and cannot construct this controlled hand.
const roomStore = new RoomStore({
  codeFactory: () => `kongflow${String((createdRooms += 1)).padStart(4, "0")}`,
  handFactory: (dealer) => addedKongFixtureHand(dealer),
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
  process.stdout.write(`Mahjong Together kong fixture listening on port ${String(port)}\n`);
});

httpServer.on("close", () => {
  stopRealtime();
  stopRoomCleanup();
});

function addedKongFixtureHand(dealer: SeatIndex): AwaitingDiscardState {
  if (dealer !== 0) throw new Error("Kong fixture expects the host to deal first");
  const pool = createTileSet();
  const take = (type: TileType): PhysicalTile => {
    const index = pool.findIndex((tile) => tile.type === type);
    if (index === -1) throw new Error(`Missing ${type} tile for kong fixture`);
    return pool.splice(index, 1)[0];
  };
  const player0: PlayerHandState = {
    concealed: [
      take("d3"),
      take("b1"),
      take("b1"),
      take("b1"),
      take("b1"),
      take("b2"),
      take("b2"),
      take("b2"),
      take("b2"),
      take("b4"),
      take("b4"),
    ],
    discards: [],
    melds: [{ concealed: false, kind: "pung", tiles: [take("d3"), take("d3"), take("d3")] }],
  };
  const players: [PlayerHandState, PlayerHandState, PlayerHandState, PlayerHandState] = [
    player0,
    player([
      "east",
      "east",
      "east",
      "east",
      "south",
      "south",
      "south",
      "south",
      "west",
      "west",
      "west",
      "west",
      "north",
    ]),
    player([
      "north",
      "north",
      "north",
      "red",
      "red",
      "red",
      "red",
      "green",
      "green",
      "green",
      "green",
      "white",
      "white",
    ]),
    player(["d1", "d1", "d1", "d1", "d2", "d2", "d2", "d2", "d4", "d4", "d4", "d4", "d5"]),
  ];
  const handId = randomUUID();
  const drawnTileId = player0.concealed.at(-1)?.id;
  if (drawnTileId === undefined) throw new Error("Kong fixture dealer hand invariant failed");
  return {
    dealer,
    decisionId: `${handId}:1`,
    decisionSequence: 1,
    drawnTileId,
    handId,
    phase: "awaiting-discard",
    players,
    turn: dealer,
    turnOrigin: "draw",
    wall: pool,
  };

  function player(types: readonly TileType[]): PlayerHandState {
    return { concealed: types.map(take), discards: [], melds: [] };
  }
}
