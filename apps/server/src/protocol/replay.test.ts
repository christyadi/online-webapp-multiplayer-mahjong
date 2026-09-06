import { describe, expect, it } from "vitest";

import type { GuestSession } from "../identity/sessions.js";
import { CommandReplayError, SessionCommandReplay, SlidingWindowRateLimiter } from "./replay.js";

const session: GuestSession = { expiresAt: Number.MAX_SAFE_INTEGER, guestId: "guest" };

describe("command replay and rate controls", () => {
  it("runs an identical command once and rejects payload changes", () => {
    const replay = new SessionCommandReplay<number>();
    let executions = 0;
    const run = (payload: unknown) =>
      replay.run(
        session,
        "command",
        payload,
        () => undefined,
        () => (executions += 1),
      );

    expect(run({ ready: true })).toEqual({ replayed: false, result: 1 });
    expect(run({ ready: true })).toEqual({ replayed: true, result: 1 });
    expect(executions).toBe(1);
    expect(() => run({ ready: false })).toThrow(CommandReplayError);
  });

  it("checks replay before rate limiting and bounds new command storage", () => {
    const replay = new SessionCommandReplay<number>(1);
    let allowed = true;
    const first = () =>
      replay.run(
        session,
        "first",
        {},
        () => {
          if (!allowed) throw new Error("rate-limit");
        },
        () => 1,
      );
    first();
    allowed = false;

    expect(first()).toMatchObject({ replayed: true });
    expect(() =>
      replay.run(
        session,
        "second",
        {},
        () => undefined,
        () => 2,
      ),
    ).toThrow(expect.objectContaining({ code: "command-limit" }));
  });

  it("enforces a sliding window without counting rejected attempts", () => {
    const limiter = new SlidingWindowRateLimiter();
    expect(limiter.consume("guest", 2, 1_000, 1_000)).toBe(true);
    expect(limiter.consume("guest", 2, 1_000, 1_001)).toBe(true);
    expect(limiter.consume("guest", 2, 1_000, 1_002)).toBe(false);
    expect(limiter.consume("guest", 2, 1_000, 2_001)).toBe(true);
  });
});
