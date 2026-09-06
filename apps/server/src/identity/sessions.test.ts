import { describe, expect, it } from "vitest";

import { SessionCapacityError, SessionStore } from "./sessions.js";

describe("guest sessions", () => {
  it("creates an opaque 24-hour token and reuses a valid presented session", () => {
    const now = Date.UTC(2026, 8, 6);
    const store = new SessionStore({ clock: () => now });

    const created = store.establish(undefined);
    expect(created.created).toBe(true);
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.session.expiresAt).toBe(now + 24 * 60 * 60 * 1000);

    const reused = store.establish(created.token);
    expect(reused).toEqual({ created: false, session: created.session });
    expect(store.size).toBe(1);
  });

  it("removes expired sessions before enforcing the capacity limit", () => {
    let now = 1_000;
    let tokenNumber = 0;
    const store = new SessionStore({
      clock: () => now,
      lifetimeMs: 100,
      maxSessions: 1,
      tokenFactory: () => `token-${String((tokenNumber += 1))}`,
    });
    const first = store.establish(undefined);

    expect(() => store.establish(undefined)).toThrow(SessionCapacityError);
    now += 101;
    const second = store.establish(undefined);

    expect(store.find(first.token)).toBeNull();
    expect(second.session.guestId).not.toBe(first.session.guestId);
    expect(store.size).toBe(1);
  });
});
