import { createServer } from "node:http";
import { Server } from "socket.io";

import { createApp, resolveAppOrigin } from "./app.js";
import { SessionStore } from "./identity/sessions.js";
import { configureRealtime } from "./realtime.js";
import { RoomStore } from "./rooms/rooms.js";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const roomStore = new RoomStore();
const sessionStore = new SessionStore();
const stopRoomCleanup = roomStore.startCleanup();
const httpServer = createServer(
  createApp({
    roomStore,
    sessionStore,
    ...(process.env.PLAYWRIGHT_TEST === "true" ? { sessionCreationLimit: 120 } : {}),
  }),
);

const realtimeServer = new Server(httpServer, {
  maxHttpBufferSize: 16 * 1024,
  pingInterval: 10_000,
  pingTimeout: 10_000,
});
const appOrigin = resolveAppOrigin(process.env.APP_ORIGIN);
const stopRealtime = configureRealtime(realtimeServer, {
  ...(appOrigin === undefined ? {} : { appOrigin }),
  roomStore,
  sessionStore,
});

httpServer.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Mahjong Together listening on port ${String(port)}\n`);
});

httpServer.on("close", () => {
  stopRealtime();
  stopRoomCleanup();
});
