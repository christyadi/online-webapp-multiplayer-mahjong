import { createHash } from "node:crypto";

import type { GuestSession } from "../identity/sessions.js";

export class CommandReplayError extends Error {
  constructor(
    readonly code: "command-id-reused" | "command-limit",
    message: string,
  ) {
    super(message);
  }
}

type CachedCommand<T> = Readonly<{ payloadHash: string; result: T }>;
type GuestCommands<T> = { commands: Map<string, CachedCommand<T>>; expiresAt: number };

export class SessionCommandReplay<T> {
  readonly #guests = new Map<string, GuestCommands<T>>();
  readonly #maxCommands: number;

  constructor(maxCommands = 10_000) {
    this.#maxCommands = maxCommands;
  }

  run(
    session: GuestSession,
    commandId: string,
    payload: unknown,
    beforeNewCommand: () => void,
    action: () => T,
  ): Readonly<{ replayed: boolean; result: T }> {
    this.pruneExpired(Date.now());
    const commands = this.commandsFor(session);
    const payloadHash = hashPayload(payload);
    const cached = commands.commands.get(commandId);
    if (cached !== undefined) {
      if (cached.payloadHash !== payloadHash) {
        throw new CommandReplayError(
          "command-id-reused",
          "This command ID was already used for a different request",
        );
      }
      return { replayed: true, result: cached.result };
    }
    if (commands.commands.size >= this.#maxCommands) {
      throw new CommandReplayError("command-limit", "This guest has reached the command limit");
    }

    beforeNewCommand();
    const result = action();
    commands.commands.set(commandId, { payloadHash, result });
    return { replayed: false, result };
  }

  pruneExpired(now: number): void {
    for (const [guestId, commands] of this.#guests) {
      if (commands.expiresAt <= now) this.#guests.delete(guestId);
    }
  }

  commandsFor(session: GuestSession): GuestCommands<T> {
    const existing = this.#guests.get(session.guestId);
    if (existing !== undefined) return existing;
    const created: GuestCommands<T> = { commands: new Map(), expiresAt: session.expiresAt };
    this.#guests.set(session.guestId, created);
    return created;
  }
}

export class SlidingWindowRateLimiter {
  readonly #attempts = new Map<string, number[]>();

  consume(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const cutoff = now - windowMs;
    const recent = (this.#attempts.get(key) ?? []).filter((attempt) => attempt > cutoff);
    if (recent.length >= limit) {
      this.#attempts.set(key, recent);
      return false;
    }
    recent.push(now);
    this.#attempts.set(key, recent);
    return true;
  }
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("base64url");
}
