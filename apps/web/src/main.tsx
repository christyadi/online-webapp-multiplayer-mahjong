import {
  apiErrorSchema,
  currentRoomResponseSchema,
  roomCodeSchema,
  roomViewSchema,
  type RoomView,
} from "@mahjong-together/shared";
import { StrictMode, useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

function App() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState(window.location.pathname);
  const [pending, setPending] = useState(false);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [roomExpired, setRoomExpired] = useState(false);
  const occupiedRoomCode = useRef<string | null>(null);

  const navigate = useCallback((nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }, []);

  const acceptRoom = useCallback((nextRoom: RoomView) => {
    occupiedRoomCode.current = nextRoom.code;
    setRoomExpired(false);
    setRoom(nextRoom);
  }, []);

  const expireRoom = useCallback(() => {
    occupiedRoomCode.current = null;
    setRoom(null);
    setRoomExpired(true);
    window.history.replaceState({}, "", "/");
    setPath("/");
  }, []);

  const refreshRoom = useCallback(async () => {
    const current = await requestJson("/api/rooms/current", currentRoomResponseSchema);
    if (current.room === null) {
      if (occupiedRoomCode.current !== null) expireRoom();
      else setRoom(null);
      return;
    }
    acceptRoom(current.room);
    if (window.location.pathname !== `/room/${current.room.code}`) {
      window.history.replaceState({}, "", `/room/${current.room.code}`);
      setPath(`/room/${current.room.code}`);
    }
  }, [acceptRoom, expireRoom]);

  useEffect(() => {
    const initialize = async () => {
      try {
        await requestJson("/api/session", undefined, { method: "POST" });
        await refreshRoom();
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setLoading(false);
      }
    };
    void initialize();
  }, [refreshRoom]);

  useEffect(() => {
    const handleNavigation = () => setPath(window.location.pathname);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshRoom().catch(() => undefined);
    };
    window.addEventListener("popstate", handleNavigation);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("popstate", handleNavigation);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshRoom]);

  if (loading)
    return <StatusCard title="Opening the table…" message="Starting your guest session." />;

  if (roomExpired) {
    return (
      <main>
        <section className="welcome-card" aria-labelledby="expired-title">
          <p className="eyebrow">Room closed</p>
          <h1 id="expired-title">Room expired</h1>
          <p>This private room is no longer available. You can safely create or join another.</p>
          <button onClick={() => setRoomExpired(false)} type="button">
            Return home
          </button>
        </section>
      </main>
    );
  }

  if (room !== null) {
    return (
      <Lobby
        error={error}
        onError={setError}
        onExpired={expireRoom}
        onLeave={() => {
          occupiedRoomCode.current = null;
          setRoom(null);
          setRoomExpired(false);
          navigate("/");
        }}
        onRefresh={refreshRoom}
        onRoom={acceptRoom}
        pending={pending}
        room={room}
        setPending={setPending}
      />
    );
  }

  const inviteCode = inviteCodeFromPath(path);
  if (inviteCode !== null) {
    return (
      <JoinRoom
        code={inviteCode}
        error={error}
        onJoined={(joined) => {
          acceptRoom(joined);
          navigate(`/room/${joined.code}`);
        }}
        pending={pending}
        setError={setError}
        setPending={setPending}
      />
    );
  }

  return (
    <main>
      <section className="welcome-card" aria-labelledby="page-title">
        <p className="eyebrow">Private games for friends</p>
        <h1 id="page-title">Mahjong Together</h1>
        <p>Simple Chinese house rules for one to four people. Empty seats are filled by bots.</p>
        <NicknameForm
          buttonLabel="Create a private room"
          disabled={pending}
          error={error}
          onSubmit={async (nickname) => {
            setPending(true);
            setError(null);
            try {
              const created = await requestJson("/api/rooms", roomViewSchema, {
                body: JSON.stringify({ commandId: crypto.randomUUID(), nickname }),
                headers: { "content-type": "application/json" },
                method: "POST",
              });
              acceptRoom(created);
              navigate(`/room/${created.code}`);
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setPending(false);
            }
          }}
        />
        <p className="house-rules-note">No accounts, scoring, money, or matchmaking.</p>
      </section>
    </main>
  );
}

type JoinRoomProperties = Readonly<{
  code: string;
  error: string | null;
  onJoined: (room: RoomView) => void;
  pending: boolean;
  setError: (message: string | null) => void;
  setPending: (pending: boolean) => void;
}>;

function JoinRoom({ code, error, onJoined, pending, setError, setPending }: JoinRoomProperties) {
  const validCode = roomCodeSchema.safeParse(code).success;
  return (
    <main>
      <section className="welcome-card" aria-labelledby="join-title">
        <p className="eyebrow">Private invitation</p>
        <h1 id="join-title">Join Mahjong Together</h1>
        {validCode ? (
          <>
            <p>
              Choose a nickname for room <strong>{code}</strong>.
            </p>
            <NicknameForm
              buttonLabel="Join room"
              disabled={pending}
              error={error}
              onSubmit={async (nickname) => {
                setPending(true);
                setError(null);
                try {
                  const joined = await requestJson(`/api/rooms/${code}/join`, roomViewSchema, {
                    body: JSON.stringify({ commandId: crypto.randomUUID(), nickname }),
                    headers: { "content-type": "application/json" },
                    method: "POST",
                  });
                  onJoined(joined);
                } catch (caught) {
                  setError(errorMessage(caught));
                } finally {
                  setPending(false);
                }
              }}
            />
          </>
        ) : (
          <p className="error" role="alert">
            This invite link is not valid.
          </p>
        )}
        <a href="/">Return home</a>
      </section>
    </main>
  );
}

type NicknameFormProperties = Readonly<{
  buttonLabel: string;
  disabled: boolean;
  error: string | null;
  onSubmit: (nickname: string) => Promise<void>;
}>;

function NicknameForm({ buttonLabel, disabled, error, onSubmit }: NicknameFormProperties) {
  const [nickname, setNickname] = useState("");
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit(nickname);
  };
  return (
    <form className="nickname-form" onSubmit={submit}>
      <label htmlFor="nickname">Nickname</label>
      <input
        autoComplete="nickname"
        disabled={disabled}
        id="nickname"
        maxLength={20}
        onChange={(event) => setNickname(event.target.value)}
        required
        value={nickname}
      />
      <button disabled={disabled} type="submit">
        {disabled ? "Please wait…" : buttonLabel}
      </button>
      {error === null ? null : (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

type LobbyProperties = Readonly<{
  error: string | null;
  onError: (message: string | null) => void;
  onExpired: () => void;
  onLeave: () => void;
  onRefresh: () => Promise<void>;
  onRoom: (room: RoomView) => void;
  pending: boolean;
  room: RoomView;
  setPending: (pending: boolean) => void;
}>;

function Lobby({
  error,
  onError,
  onExpired,
  onLeave,
  onRefresh,
  onRoom,
  pending,
  room,
  setPending,
}: LobbyProperties) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState(false);
  const viewer = room.seats[room.viewerSeat];
  const viewerIsHost = viewer?.kind === "human" && viewer.host;
  const inviteUrl = `${window.location.origin}/room/${room.code}`;

  const mutate = async (path: string, body: Record<string, unknown>) => {
    setPending(true);
    onError(null);
    try {
      const updated = await requestJson(path, roomViewSchema, {
        body: JSON.stringify({ commandId: crypto.randomUUID(), ...body }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      onRoom(updated);
    } catch (caught) {
      if (isRoomExpiredError(caught)) onExpired();
      else onError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyStatus("Invite link copied.");
      setManualCopy(false);
    } catch {
      setCopyStatus("Copy is unavailable here. Select the link below to copy it manually.");
      setManualCopy(true);
    }
  };

  return (
    <main className="lobby-page">
      <section className="lobby-card" aria-labelledby="lobby-title">
        <div className="lobby-heading">
          <div>
            <p className="eyebrow">Room {room.code}</p>
            <h1 id="lobby-title">
              {room.phase === "lobby" ? "Your private table" : "Hand starting"}
            </h1>
          </div>
          <span className="seat-chip">You are {SEAT_NAMES[room.viewerSeat]}</span>
        </div>

        <ol className="seat-list" aria-label="Table seats">
          {room.seats.map((occupant, index) => (
            <li className="seat" key={SEAT_NAMES[index]}>
              <span className="seat-name">{SEAT_NAMES[index]}</span>
              {occupant === null ? (
                <span className="seat-detail">Open — bot joins at start</span>
              ) : occupant.kind === "bot" ? (
                <span className="seat-detail">Bot</span>
              ) : (
                <span className="seat-detail">
                  {occupant.nickname}
                  {occupant.host ? " · Host" : ""}
                  {occupant.ready ? " · Ready" : " · Not ready"}
                </span>
              )}
            </li>
          ))}
        </ol>

        {room.phase === "active" ? (
          <p className="notice">
            The table is ready. Gameplay controls arrive in the next build stage.
          </p>
        ) : (
          <div className="lobby-actions">
            <button
              disabled={pending}
              onClick={() =>
                void mutate(`/api/rooms/${room.code}/ready`, { ready: !room.viewerReady })
              }
              type="button"
            >
              {room.viewerReady ? "Mark not ready" : "I’m ready"}
            </button>
            {viewerIsHost ? (
              <button
                disabled={pending || !room.canStart}
                onClick={() => void mutate(`/api/rooms/${room.code}/start`, {})}
                type="button"
              >
                Start hand
              </button>
            ) : null}
            <button
              className="secondary"
              disabled={pending}
              onClick={() =>
                void onRefresh().catch((caught: unknown) => onError(errorMessage(caught)))
              }
              type="button"
            >
              Refresh players
            </button>
          </div>
        )}

        <div className="invite-panel">
          <p>Invite friends with this private link. Their own guest session controls their seat.</p>
          <button className="secondary" onClick={() => void copyInvite()} type="button">
            Copy invite link
          </button>
          {copyStatus === null ? null : <p aria-live="polite">{copyStatus}</p>}
          {manualCopy ? <input aria-label="Invite link" readOnly value={inviteUrl} /> : null}
        </div>

        <button
          className="text-button"
          disabled={pending}
          onClick={() => {
            if (
              room.phase === "active" &&
              !window.confirm("Leave this hand and give your seat to a bot?")
            )
              return;
            setPending(true);
            void requestJson(`/api/rooms/${room.code}/leave`, undefined, {
              body: JSON.stringify({ commandId: crypto.randomUUID() }),
              headers: { "content-type": "application/json" },
              method: "POST",
            })
              .then(onLeave)
              .catch((caught: unknown) => {
                if (isRoomExpiredError(caught)) onExpired();
                else onError(errorMessage(caught));
              })
              .finally(() => setPending(false));
          }}
          type="button"
        >
          Leave game
        </button>
        {error === null ? null : (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}

function StatusCard({ title, message }: Readonly<{ message: string; title: string }>) {
  return (
    <main>
      <section className="welcome-card" aria-live="polite">
        <h1>{title}</h1>
        <p>{message}</p>
      </section>
    </main>
  );
}

async function requestJson<T>(
  path: string,
  schema: Readonly<{ parse: (input: unknown) => T }> | undefined,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin" });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    throw error.success
      ? new ApiRequestError(error.data.code, error.data.message)
      : new Error("The server could not complete the request");
  }
  return schema === undefined ? (body as T) : schema.parse(body);
}

function inviteCodeFromPath(path: string): string | null {
  const match = /^\/room\/([^/]+)\/?$/.exec(path);
  return match?.[1] ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function isRoomExpiredError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === "room-not-found";
}

class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const SEAT_NAMES = ["East", "South", "West", "North"] as const;

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) throw new Error("Missing application root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
