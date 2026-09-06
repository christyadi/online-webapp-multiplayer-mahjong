import type { RoomView } from "@mahjong-together/shared";
import { describe, expect, it } from "vitest";

import { reduceServerState } from "./server-state.js";

describe("server state ordering", () => {
  it("ignores a lobby response that arrives after a newer active-room response", () => {
    const lobby = room(2, "lobby");
    const active = room(3, "active");
    const current = reduceServerState(
      { game: null, room: null },
      { room: active, type: "room-received" },
    );

    expect(reduceServerState(current, { room: lobby, type: "room-received" })).toBe(current);
  });
});

function room(roomRevision: number, phase: RoomView["phase"]): RoomView {
  return {
    canStart: false,
    code: "revisionroom",
    phase,
    roomRevision,
    seats: [
      {
        connected: true,
        host: true,
        kind: "human",
        nickname: "Host",
        ready: true,
      },
      null,
      null,
      null,
    ],
    viewerReady: true,
    viewerSeat: 0,
  };
}
