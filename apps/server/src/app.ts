import type { HealthResponse } from "@mahjong-together/shared";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" } satisfies HealthResponse);
  });
  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "Not found" });
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

  return app;
}
