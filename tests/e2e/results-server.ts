import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { Server } from "socket.io";

import { createApp } from "../../apps/server/src/app.js";
import { startHand, type HandState } from "../../apps/server/src/game/state.js";
import { createTileSet, shuffleTiles, type SeatIndex } from "../../apps/server/src/game/wall.js";
import { SessionStore } from "../../apps/server/src/identity/sessions.js";
import { configureRealtime } from "../../apps/server/src/realtime.js";
import { RoomStore } from "../../apps/server/src/rooms/rooms.js";

const port = Number.parseInt(process.env.PORT ?? "4174", 10);
let startedHands = 0;
let createdRooms = 0;
const roomStore = new RoomStore({
  codeFactory: () => `resultflow${String((createdRooms += 1)).padStart(2, "0")}`,
  handFactory: (dealer) => nextTestHand(dealer),
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
  process.stdout.write(`Mahjong Together result fixture listening on port ${String(port)}\n`);
});

httpServer.on("close", () => {
  stopRealtime();
  stopRoomCleanup();
});

function nextTestHand(dealer: SeatIndex): HandState {
  startedHands += 1;
  const hand = startHand(randomUUID(), dealer, shuffleTiles(createTileSet()));
  return startedHands % 2 === 1 ? { ...hand, phase: "hand-ended", result: { kind: "draw" } } : hand;
}
