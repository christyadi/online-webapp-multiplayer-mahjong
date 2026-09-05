import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "./app.js";

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
