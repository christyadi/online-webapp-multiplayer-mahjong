import { describe, expect, it } from "vitest";

import { LatestRequestGate } from "./request-gate.js";

describe("latest room request gate", () => {
  it("rejects a delayed room response after room state is cleared", () => {
    const gate = new LatestRequestGate();
    const delayedRoom = gate.begin();
    gate.invalidate();

    expect(gate.isCurrent(delayedRoom)).toBe(false);
  });

  it("rejects an old-room response after a newer room request starts", () => {
    const gate = new LatestRequestGate();
    const oldRoom = gate.begin();
    const newRoom = gate.begin();

    expect(gate.isCurrent(oldRoom)).toBe(false);
    expect(gate.isCurrent(newRoom)).toBe(true);
  });
});
