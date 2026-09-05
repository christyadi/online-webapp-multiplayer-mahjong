import { createServer } from "node:http";
import { Server } from "socket.io";

import { createApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const httpServer = createServer(createApp());

new Server(httpServer, {
  maxHttpBufferSize: 16 * 1024,
  pingInterval: 10_000,
  pingTimeout: 10_000,
});

httpServer.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Mahjong Together listening on port ${String(port)}\n`);
});
