import { createHash, randomBytes, randomUUID } from "node:crypto";

export const GUEST_COOKIE_NAME = "mahjong_guest";

export type GuestSession = Readonly<{
  expiresAt: number;
  guestId: string;
}>;

export class SessionCapacityError extends Error {
  constructor() {
    super("The service cannot accept another guest right now");
  }
}

type StoredSession = GuestSession & { tokenHash: string };

type SessionStoreOptions = Readonly<{
  clock?: () => number;
  lifetimeMs?: number;
  maxSessions?: number;
  tokenFactory?: () => string;
}>;

export class SessionStore {
  readonly #activeControllers = new Map<string, string>();
  readonly #clock: () => number;
  readonly #lifetimeMs: number;
  readonly #maxSessions: number;
  readonly #sessions = new Map<string, StoredSession>();
  readonly #tokenFactory: () => string;

  constructor(options: SessionStoreOptions = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#lifetimeMs = options.lifetimeMs ?? 24 * 60 * 60 * 1000;
    this.#maxSessions = options.maxSessions ?? 1_000;
    this.#tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
  }

  establish(presentedToken: string | undefined): Readonly<{
    created: boolean;
    session: GuestSession;
    token?: string;
  }> {
    const existing = this.find(presentedToken);
    if (existing !== null) return { created: false, session: existing };

    this.pruneExpired();
    if (this.#sessions.size >= this.#maxSessions) throw new SessionCapacityError();

    const token = this.#tokenFactory();
    const tokenHash = hashToken(token);
    if (this.#sessions.has(tokenHash)) throw new Error("Session token collision");
    const session: StoredSession = {
      expiresAt: this.#clock() + this.#lifetimeMs,
      guestId: randomUUID(),
      tokenHash,
    };
    this.#sessions.set(tokenHash, session);
    return { created: true, session: publicSession(session), token };
  }

  find(presentedToken: string | undefined): GuestSession | null {
    if (presentedToken === undefined || presentedToken.length === 0) return null;
    const tokenHash = hashToken(presentedToken);
    const session = this.#sessions.get(tokenHash);
    if (session === undefined) return null;
    if (session.expiresAt <= this.#clock()) {
      this.#sessions.delete(tokenHash);
      this.#activeControllers.delete(session.guestId);
      return null;
    }
    return publicSession(session);
  }

  claimController(guestId: string, controllerId: string): void {
    this.#activeControllers.set(guestId, controllerId);
  }

  isActiveController(guestId: string, controllerId: string): boolean {
    return this.#activeControllers.get(guestId) === controllerId;
  }

  releaseController(guestId: string, controllerId: string): void {
    if (this.#activeControllers.get(guestId) === controllerId) {
      this.#activeControllers.delete(guestId);
    }
  }

  pruneExpired(): void {
    const now = this.#clock();
    for (const [tokenHash, session] of this.#sessions) {
      if (session.expiresAt <= now) {
        this.#sessions.delete(tokenHash);
        this.#activeControllers.delete(session.guestId);
      }
    }
  }

  get size(): number {
    return this.#sessions.size;
  }
}

export function guestTokenFromCookieHeader(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== GUEST_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function publicSession(session: StoredSession): GuestSession {
  return { expiresAt: session.expiresAt, guestId: session.guestId };
}
