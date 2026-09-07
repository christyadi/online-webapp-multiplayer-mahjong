import {
  apiErrorSchema,
  commandAcknowledgementSchema,
  currentRoomResponseSchema,
  gameSnapshotSchema,
  lobbyMutationAcknowledgementSchema,
  roomCodeSchema,
  roomInvitationSchema,
  suitedTileDetails,
  tileTypeIndex,
  type CommandAcknowledgement,
  type GameCommand,
  type GameSnapshot,
  type RoomInvitation,
  type RoomView,
  type TileType,
} from "@mahjong-together/shared";
import {
  StrictMode,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { io, type Socket } from "socket.io-client";

import { LatestRequestGate } from "./request-gate.js";
import { ServerStateProvider, useServerState } from "./server-state.js";
import "./styles.css";
import { TileArt } from "./tile-art.js";

const OCCUPIED_ROOM_STORAGE_KEY = "mahjong-together:occupied-room";
const THEME_STORAGE_KEY = "mahjong-together:theme";

type Theme = "light" | "dark";

const HOME_TILE = { id: "decorative-bamboo-6", type: "b6" } as const;

function readThemePreference(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Continue with the system preference when storage is unavailable.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function ThemeToggle({
  className = "",
  theme,
  onToggle,
}: Readonly<{ className?: string; onToggle: () => void; theme: Theme }>) {
  const nextTheme = theme === "dark" ? "light" : "dark";
  return (
    <button
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={theme === "dark"}
      className={`theme-toggle${className === "" ? "" : ` ${className}`}`}
      onClick={onToggle}
      title={`Switch to ${nextTheme} mode`}
      type="button"
    >
      <span aria-hidden="true" className="theme-toggle-icon">
        {theme === "dark" ? "☀" : "☾"}
      </span>
      <span>{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}

function Root() {
  const [theme, setTheme] = useState<Theme>(() => readThemePreference());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The theme still applies for this session when storage is unavailable.
    }
  }, [theme]);

  return (
    <App
      onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      theme={theme}
    />
  );
}

function App({ onToggleTheme, theme }: Readonly<{ onToggleTheme: () => void; theme: Theme }>) {
  const { dispatch, state: serverState } = useServerState();
  const { game, room } = serverState;
  const [error, setError] = useState<string | null>(null);
  const [controllerId, setControllerId] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState(window.location.pathname);
  const [pending, setPending] = useState(false);
  const [roomExpired, setRoomExpired] = useState(false);
  const [sessionReplaced, setSessionReplaced] = useState(false);
  const occupiedRoomCode = useRef(readOccupiedRoomCode());
  const roomRequests = useRef(new LatestRequestGate());
  const realtime = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const pageThemeToggle = <ThemeToggle onToggle={onToggleTheme} theme={theme} />;

  const navigate = useCallback((nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }, []);

  const acceptRoom = useCallback(
    (nextRoom: RoomView) => {
      roomRequests.current.invalidate();
      occupiedRoomCode.current = nextRoom.code;
      persistOccupiedRoomCode(nextRoom.code);
      setRoomExpired(false);
      dispatch({ room: nextRoom, type: "room-received" });
      realtime.current?.emit("room:watch", () => undefined);
    },
    [dispatch],
  );

  const expireRoom = useCallback(() => {
    roomRequests.current.invalidate();
    occupiedRoomCode.current = null;
    clearOccupiedRoomCode();
    dispatch({ type: "room-cleared" });
    setRoomExpired(true);
    window.history.replaceState({}, "", "/");
    setPath("/");
  }, [dispatch]);

  const recoverFromRestart = useCallback(() => {
    realtime.current?.disconnect();
    expireRoom();
    setError(null);
    setLoading(true);
    setSessionReady(false);
    setControllerId(crypto.randomUUID());
  }, [expireRoom]);

  const refreshRoom = useCallback(async () => {
    const requestGeneration = roomRequests.current.begin();
    const current = await requestJson(
      "/api/rooms/current",
      currentRoomResponseSchema,
      controllerId,
    );
    if (!roomRequests.current.isCurrent(requestGeneration)) return;
    if (current.room === null) {
      const inviteCode = inviteCodeFromPath(window.location.pathname);
      if (occupiedRoomCode.current !== null && occupiedRoomCode.current === inviteCode) {
        expireRoom();
      } else {
        if (occupiedRoomCode.current !== null) {
          occupiedRoomCode.current = null;
          clearOccupiedRoomCode();
        }
        dispatch({ type: "room-cleared" });
      }
      return;
    }
    acceptRoom(current.room);
    if (window.location.pathname !== `/room/${current.room.code}`) {
      window.history.replaceState({}, "", `/room/${current.room.code}`);
      setPath(`/room/${current.room.code}`);
    }
  }, [acceptRoom, controllerId, dispatch, expireRoom]);

  useEffect(() => {
    const initialize = async () => {
      try {
        await requestJson("/api/session", undefined, controllerId, { method: "POST" });
        setSessionReady(true);
        await refreshRoom();
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setLoading(false);
      }
    };
    void initialize();
  }, [controllerId, refreshRoom]);

  useEffect(() => {
    if (!sessionReady) return;
    const socket = io({
      ackTimeout: 5_000,
      auth: { controllerId },
      autoConnect: false,
      retries: 2,
    });
    realtime.current = socket;
    socket.on("connect", () => {
      setSocket(socket);
      setRealtimeReady(true);
      setSessionReplaced(false);
      setError(null);
    });
    socket.on("disconnect", () => {
      setRealtimeReady(false);
      setSocket((current) => (current === socket ? null : current));
    });
    socket.on("connect_error", (caught) => {
      if (caught instanceof Error && caught.message === "session-required") {
        recoverFromRestart();
        return;
      }
      if (caught instanceof Error && caught.message === "controller-replaced") {
        socket.disconnect();
        setSessionReplaced(true);
        setRealtimeReady(false);
        setError("This room is controlled from another tab.");
        return;
      }
      setError(errorMessage(caught));
    });
    socket.on("room:changed", () => {
      void refreshRoom().catch((caught: unknown) => setError(errorMessage(caught)));
    });
    socket.on("game:snapshot", (input: unknown) => {
      const snapshot = gameSnapshotSchema.safeParse(input);
      if (!snapshot.success) return;
      dispatch({ snapshot: snapshot.data, type: "game-received" });
    });
    socket.on("session:replaced", () => {
      socket.disconnect();
      setSessionReplaced(true);
      setError("This room is now controlled from another tab.");
      setRealtimeReady(false);
    });
    socket.connect();
    return () => {
      if (realtime.current === socket) realtime.current = null;
      setSocket((current) => (current === socket ? null : current));
      socket.disconnect();
    };
  }, [controllerId, dispatch, recoverFromRestart, refreshRoom, sessionReady]);

  const takeControl = useCallback(() => {
    setControllerId(crypto.randomUUID());
    setError(null);
    setSessionReplaced(false);
  }, []);

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
    return (
      <>
        {pageThemeToggle}
        <StatusCard title="Opening the table…" message="Starting your guest session." />
      </>
    );

  if (!sessionReady) {
    return (
      <>
        {pageThemeToggle}
        <StatusCard
          title="Unable to open the table"
          message={error ?? "A guest session could not be started."}
        />
      </>
    );
  }

  if (!realtimeReady) {
    return (
      <>
        {pageThemeToggle}
        <StatusCard
          title={error === null ? "Connecting to the table…" : "Table control unavailable"}
          message={
            sessionReplaced
              ? "This room is controlled from another tab. Take control only if you mean to move play here."
              : (error ?? "Establishing the secure live connection.")
          }
          {...(sessionReplaced
            ? { action: { label: "Take control here", onClick: takeControl } }
            : {})}
        />
      </>
    );
  }

  if (roomExpired) {
    return (
      <main>
        {pageThemeToggle}
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
        controllerId={controllerId}
        error={error}
        onError={setError}
        onExpired={expireRoom}
        onToggleTheme={onToggleTheme}
        onLeave={() => {
          roomRequests.current.invalidate();
          occupiedRoomCode.current = null;
          clearOccupiedRoomCode();
          dispatch({ type: "room-cleared" });
          setRoomExpired(false);
          navigate("/");
        }}
        onInvalidateRoomRequests={() => roomRequests.current.invalidate()}
        onRefresh={refreshRoom}
        pending={pending}
        game={game}
        realtime={socket}
        room={room}
        setPending={setPending}
        theme={theme}
      />
    );
  }

  const inviteCode = inviteCodeFromPath(path);
  if (inviteCode !== null) {
    return (
      <>
        {pageThemeToggle}
        <JoinRoom
          code={inviteCode}
          controllerId={controllerId}
          error={error}
          onJoined={refreshRoom}
          onMutationStart={() => roomRequests.current.invalidate()}
          pending={pending}
          setError={setError}
          setPending={setPending}
        />
      </>
    );
  }

  return (
    <main className="home-page">
      {pageThemeToggle}
      <section className="welcome-card home-card" aria-labelledby="page-title">
        <header className="home-intro">
          <div aria-hidden="true" className="home-hero-tile">
            <TileArt tile={HOME_TILE} />
          </div>
          <div className="home-intro-copy">
            <p className="eyebrow">Private games for friends</p>
            <h1 id="page-title">Mahjong Together</h1>
            <p>
              Start a table or join a friend with an invite code. Empty seats are filled by bots.
            </p>
          </div>
        </header>
        <div className="home-lobby-options">
          <section className="home-lobby-action" aria-labelledby="create-room-title">
            <p className="home-action-kicker">Open a new table</p>
            <h2 id="create-room-title">Create a private room</h2>
            <p>Choose a nickname, then share your invite code with friends.</p>
            <NicknameForm
              buttonLabel="Create a private room"
              disabled={pending}
              error={error}
              fieldId="create-room-nickname"
              onSubmit={async (nickname) => {
                roomRequests.current.invalidate();
                setPending(true);
                setError(null);
                try {
                  const created = await requestJson(
                    "/api/rooms",
                    lobbyMutationAcknowledgementSchema,
                    controllerId,
                    {
                      body: JSON.stringify({ commandId: crypto.randomUUID(), nickname }),
                      headers: { "content-type": "application/json" },
                      method: "POST",
                    },
                  );
                  navigate(`/room/${created.roomCode}`);
                  await refreshRoom();
                } catch (caught) {
                  setError(errorMessage(caught));
                } finally {
                  setPending(false);
                }
              }}
            />
          </section>
          <section className="home-lobby-action" aria-labelledby="join-lobby-title">
            <p className="home-action-kicker">Use an invitation</p>
            <h2 id="join-lobby-title">Join a lobby</h2>
            <p>Enter the 12-character code from a friend’s invitation.</p>
            <LobbyCodeForm onJoin={(code) => navigate(`/room/${code}`)} />
          </section>
        </div>
        <p className="house-rules-note">No accounts, scoring, money, or matchmaking.</p>
      </section>
    </main>
  );
}

type JoinRoomProperties = Readonly<{
  code: string;
  controllerId: string;
  error: string | null;
  onJoined: () => Promise<void>;
  onMutationStart: () => void;
  pending: boolean;
  setError: (message: string | null) => void;
  setPending: (pending: boolean) => void;
}>;

function JoinRoom({
  code,
  controllerId,
  error,
  onJoined,
  onMutationStart,
  pending,
  setError,
  setPending,
}: JoinRoomProperties) {
  const validCode = roomCodeSchema.safeParse(code).success;
  const [invitation, setInvitation] = useState<RoomInvitation | null>(null);
  const [availabilityError, setAvailabilityError] = useState<Readonly<{
    code: string;
    message: string;
  }> | null>(null);
  const [preferredSeat, setPreferredSeat] = useState<number | null>(null);
  const refreshInvitation = useCallback(async () => {
    const invitation = await requestJson(
      `/api/rooms/${code}/invitation`,
      roomInvitationSchema,
      controllerId,
    );
    setInvitation(invitation);
    setPreferredSeat((current) =>
      current === null || invitation.availableSeats.includes(current) ? current : null,
    );
    setAvailabilityError(null);
  }, [code, controllerId]);

  useEffect(() => {
    if (!validCode) return;
    const loadInvitation = async () => {
      try {
        await refreshInvitation();
      } catch (caught) {
        setAvailabilityError({ code, message: errorMessage(caught) });
      }
    };
    void loadInvitation();
  }, [code, refreshInvitation, validCode]);

  const availableSeats = invitation?.code === code ? invitation.availableSeats : null;
  const availabilityErrorMessage =
    availabilityError?.code === code ? availabilityError.message : null;
  const selectedSeat =
    preferredSeat !== null && availableSeats?.includes(preferredSeat) ? preferredSeat : null;
  const joinDisabled =
    pending ||
    availableSeats === null ||
    availableSeats.length === 0 ||
    availabilityErrorMessage !== null;
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
              disabled={joinDisabled}
              error={error ?? availabilityErrorMessage}
              fieldId="join-room-nickname"
              onSubmit={async (nickname) => {
                onMutationStart();
                setPending(true);
                setError(null);
                try {
                  await requestJson(
                    `/api/rooms/${code}/join`,
                    lobbyMutationAcknowledgementSchema,
                    controllerId,
                    {
                      body: JSON.stringify({
                        commandId: crypto.randomUUID(),
                        nickname,
                        ...(selectedSeat === null ? {} : { seat: selectedSeat }),
                      }),
                      headers: { "content-type": "application/json" },
                      method: "POST",
                    },
                  );
                  await onJoined();
                } catch (caught) {
                  setError(errorMessage(caught));
                  await refreshInvitation().catch(() => undefined);
                } finally {
                  setPending(false);
                }
              }}
            >
              {availableSeats === null ? (
                <p aria-live="polite">Checking available seats…</p>
              ) : availableSeats.length === 0 ? (
                <p className="error" role="alert">
                  This room already has four players.
                </p>
              ) : (
                <fieldset className="seat-picker">
                  <legend>Choose a seat</legend>
                  <label className="seat-choice">
                    <input
                      checked={selectedSeat === null}
                      name="preferred-seat"
                      onChange={() => setPreferredSeat(null)}
                      type="radio"
                    />
                    First available
                  </label>
                  {availableSeats.map((seat) => (
                    <label className="seat-choice" key={seat}>
                      <input
                        checked={selectedSeat === seat}
                        name="preferred-seat"
                        onChange={() => setPreferredSeat(seat)}
                        type="radio"
                      />
                      {seatName(seat)}
                    </label>
                  ))}
                </fieldset>
              )}
            </NicknameForm>
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
  children?: ReactNode;
  disabled: boolean;
  error: string | null;
  fieldId: string;
  onSubmit: (nickname: string) => Promise<void>;
}>;

function NicknameForm({
  buttonLabel,
  children,
  disabled,
  error,
  fieldId,
  onSubmit,
}: NicknameFormProperties) {
  const [nickname, setNickname] = useState("");
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit(nickname);
  };
  return (
    <form className="nickname-form" onSubmit={submit}>
      <label htmlFor={fieldId}>Nickname</label>
      <input
        autoComplete="nickname"
        disabled={disabled}
        id={fieldId}
        maxLength={20}
        onChange={(event) => setNickname(event.target.value)}
        required
        value={nickname}
      />
      {children}
      <button disabled={disabled} type="submit">
        {buttonLabel}
      </button>
      {error === null ? null : (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function LobbyCodeForm({ onJoin }: Readonly<{ onJoin: (code: string) => void }>) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCode = code.trim().toLowerCase();
    if (!roomCodeSchema.safeParse(normalizedCode).success) {
      setError("Enter the 12-character lobby code from your invitation.");
      return;
    }
    setError(null);
    onJoin(normalizedCode);
  };
  return (
    <form className="lobby-code-form" onSubmit={submit}>
      <label htmlFor="lobby-code">Lobby code</label>
      <input
        autoCapitalize="none"
        autoComplete="off"
        id="lobby-code"
        maxLength={12}
        onChange={(event) => setCode(event.target.value)}
        required
        spellCheck={false}
        value={code}
      />
      <button type="submit">Join lobby</button>
      {error === null ? null : (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

type LobbyProperties = Readonly<{
  controllerId: string;
  error: string | null;
  game: GameSnapshot | null;
  onError: (message: string | null) => void;
  onExpired: () => void;
  onLeave: () => void;
  onInvalidateRoomRequests: () => void;
  onRefresh: () => Promise<void>;
  onToggleTheme: () => void;
  pending: boolean;
  realtime: Socket | null;
  room: RoomView;
  setPending: (pending: boolean) => void;
  theme: Theme;
}>;

function Lobby({
  controllerId,
  error,
  game,
  onError,
  onExpired,
  onLeave,
  onInvalidateRoomRequests,
  onRefresh,
  onToggleTheme,
  pending,
  realtime,
  room,
  setPending,
  theme,
}: LobbyProperties) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState(false);
  const viewer = room.seats[room.viewerSeat];
  const viewerIsHost = viewer?.kind === "human" && viewer.host;
  const inviteUrl = `${window.location.origin}/room/${room.code}`;
  const leaveInFlight = useRef(false);
  const mutationInFlight = useRef(false);

  const mutate = async (path: string, body: Record<string, unknown>) => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setPending(true);
    onError(null);
    try {
      await requestJson(path, lobbyMutationAcknowledgementSchema, controllerId, {
        body: JSON.stringify({ commandId: crypto.randomUUID(), ...body }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      await onRefresh();
    } catch (caught) {
      if (isRoomExpiredError(caught)) onExpired();
      else onError(errorMessage(caught));
    } finally {
      mutationInFlight.current = false;
      setPending(false);
    }
  };

  const leaveGame = () => {
    if (leaveInFlight.current) return;
    if (room.phase === "active" && !window.confirm("Leave this hand and give your seat to a bot?"))
      return;
    leaveInFlight.current = true;
    onInvalidateRoomRequests();
    setPending(true);
    void requestJson(`/api/rooms/${room.code}/leave`, undefined, controllerId, {
      body: JSON.stringify({ commandId: crypto.randomUUID() }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
      .then(onLeave)
      .catch((caught: unknown) => {
        if (isRoomExpiredError(caught)) onExpired();
        else onError(errorMessage(caught));
      })
      .finally(() => {
        leaveInFlight.current = false;
        setPending(false);
      });
  };

  if (room.phase === "active" && game !== null) {
    return (
      <Table
        error={error}
        game={game}
        canPlayAgain={viewerIsHost}
        onError={onError}
        onLeave={leaveGame}
        onPlayAgain={() => void mutate(`/api/rooms/${room.code}/start`, {})}
        onToggleTheme={onToggleTheme}
        pending={pending}
        realtime={realtime}
        room={room}
        theme={theme}
      />
    );
  }

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
      <ThemeToggle onToggle={onToggleTheme} theme={theme} />
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
            {game === null
              ? "Synchronizing the hand…"
              : `${game.phase.replaceAll("-", " ")} · ${String(game.wallCount)} tiles remain`}
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

        <button className="text-button" disabled={pending} onClick={leaveGame} type="button">
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

function StatusCard({
  action,
  title,
  message,
}: Readonly<{
  action?: Readonly<{ label: string; onClick: () => void }>;
  message: string;
  title: string;
}>) {
  return (
    <main>
      <section className="welcome-card" aria-live="polite">
        <h1>{title}</h1>
        <p>{message}</p>
        {action === undefined ? null : (
          <button onClick={action.onClick} type="button">
            {action.label}
          </button>
        )}
      </section>
    </main>
  );
}

type TableProperties = Readonly<{
  canPlayAgain: boolean;
  error: string | null;
  game: GameSnapshot;
  onError: (message: string | null) => void;
  onLeave: () => void;
  onPlayAgain: () => void;
  onToggleTheme: () => void;
  pending: boolean;
  realtime: Socket | null;
  room: RoomView;
  theme: Theme;
}>;

function Table({
  canPlayAgain,
  error,
  game,
  onError,
  onLeave,
  onPlayAgain,
  onToggleTheme,
  pending,
  realtime,
  room,
  theme,
}: TableProperties) {
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [pendingDecisionId, setPendingDecisionId] = useState<string | null>(null);
  const [tileOrder, setTileOrder] = useState<string[]>([]);
  const [touchReorderSourceId, setTouchReorderSourceId] = useState<string | null>(null);
  const [showOpponentTiles, setShowOpponentTiles] = useState(false);
  const [showResult, setShowResult] = useState(() => game.result !== null);
  const [showRules, setShowRules] = useState(false);
  const [autoPlayAgain, setAutoPlayAgain] = useState(true);
  const [autoPlaySeconds, setAutoPlaySeconds] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [latestPublicAction, setLatestPublicAction] = useState(() => initialPublicAction(game));
  const autoPlayIntervalRef = useRef<number | null>(null);
  const autoPlayTimeoutRef = useRef<number | null>(null);
  const playAgainRef = useRef(onPlayAgain);
  const previousGame = useRef(game);
  const displayedResultHandId = useRef<string | null>(game.result === null ? null : game.handId);
  const touchTilePress = useRef<{
    activated: boolean;
    pointerId: number;
    sourceId: string;
    x: number;
    y: number;
  } | null>(null);
  const touchReorderTimer = useRef<number | null>(null);
  const suppressedTouchClick = useRef<string | null>(null);
  const viewer = game.players.find((player) => player.seat === game.viewerSeat);
  const legal = game.legalActions;
  const commandPending = pendingDecisionId === game.decisionId;
  const serverTiles = viewer?.concealedTiles ?? [];
  const serverTileIds = serverTiles.map((tile) => tile.id);
  const orderedTileIds = [
    ...tileOrder.filter((id) => serverTileIds.includes(id)),
    ...serverTileIds.filter((id) => !tileOrder.includes(id)),
  ];
  const orderedTiles = orderedTileIds
    .map((id) => serverTiles.find((tile) => tile.id === id))
    .filter((tile): tile is (typeof serverTiles)[number] => tile !== undefined);
  const reorderTile = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setTileOrder((current) =>
      moveTile(current.length === 0 ? serverTileIds : current, sourceId, targetId, serverTileIds),
    );
  };
  const clearTouchReorderTimer = () => {
    if (touchReorderTimer.current === null) return;
    window.clearTimeout(touchReorderTimer.current);
    touchReorderTimer.current = null;
  };
  const selectTile = (tileId: string) => {
    if (suppressedTouchClick.current === tileId) {
      suppressedTouchClick.current = null;
      return;
    }
    if (touchReorderSourceId !== null) {
      if (touchReorderSourceId !== tileId) reorderTile(touchReorderSourceId, tileId);
      setTouchReorderSourceId(null);
      setSelectedTileId(null);
      return;
    }
    setSelectedTileId((selected) => (selected === tileId ? null : tileId));
  };
  const sortHand = () => {
    setTileOrder(
      [...serverTiles]
        .sort((left, right) => {
          const typeDifference = tileTypeIndex(left.type) - tileTypeIndex(right.type);
          return typeDifference === 0 ? left.id.localeCompare(right.id) : typeDifference;
        })
        .map((tile) => tile.id),
    );
    setSelectedTileId(null);
    setTouchReorderSourceId(null);
  };

  useEffect(
    () => () => {
      if (touchReorderTimer.current !== null) {
        window.clearTimeout(touchReorderTimer.current);
      }
    },
    [],
  );
  const deadlineRemaining =
    game.deadline === null
      ? null
      : Math.max(0, game.deadline - game.serverTime - (clock - game.serverTime));
  const seconds = deadlineRemaining === null ? null : Math.ceil(deadlineRemaining / 1000);
  const rematchRemaining =
    game.rematchDeadline === null
      ? null
      : Math.max(0, game.rematchDeadline - game.serverTime - (clock - game.serverTime));
  const rematchSeconds = rematchRemaining === null ? null : Math.ceil(rematchRemaining / 1000);

  useEffect(() => {
    playAgainRef.current = onPlayAgain;
  }, [onPlayAgain]);

  const startNextHand = useCallback(() => {
    if (autoPlayIntervalRef.current !== null) {
      window.clearInterval(autoPlayIntervalRef.current);
      autoPlayIntervalRef.current = null;
    }
    if (autoPlayTimeoutRef.current !== null) {
      window.clearTimeout(autoPlayTimeoutRef.current);
      autoPlayTimeoutRef.current = null;
    }
    playAgainRef.current();
  }, []);

  useEffect(() => {
    if (!canPlayAgain || game.phase !== "hand-ended" || !autoPlayAgain || pending) {
      return;
    }
    const deadline = Date.now() + 15_000;
    const interval = window.setInterval(() => {
      setAutoPlaySeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)));
    }, 250);
    const timeout = window.setTimeout(startNextHand, 15_000);
    autoPlayIntervalRef.current = interval;
    autoPlayTimeoutRef.current = timeout;
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      if (autoPlayIntervalRef.current === interval) autoPlayIntervalRef.current = null;
      if (autoPlayTimeoutRef.current === timeout) autoPlayTimeoutRef.current = null;
    };
  }, [autoPlayAgain, canPlayAgain, game.phase, pending, startNextHand]);

  useEffect(() => {
    if (game.deadline === null && game.rematchDeadline === null) return;
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [game.deadline, game.rematchDeadline]);

  useEffect(() => {
    if (game.result === null) {
      displayedResultHandId.current = null;
      setShowResult(false);
      return;
    }
    if (displayedResultHandId.current !== game.handId) {
      displayedResultHandId.current = game.handId;
      setShowResult(true);
    }
  }, [game.handId, game.result]);

  useEffect(() => {
    const previous = previousGame.current;
    if (previous.roomRevision !== game.roomRevision || previous.handId !== game.handId) {
      const nextAction = publicActionSince(previous, game);
      if (nextAction !== null) setLatestPublicAction(nextAction);
      previousGame.current = game;
    }
  }, [game]);

  if (viewer === undefined)
    return <StatusCard message="Your seat is unavailable." title="Table error" />;

  const send = (action: GameCommand["action"]) => {
    if (realtime === null || !realtime.connected || game.decisionId === null || commandPending)
      return;
    setPendingDecisionId(game.decisionId);
    onError(null);
    const command: GameCommand = {
      action,
      commandId: crypto.randomUUID(),
      decisionId: game.decisionId,
      handId: game.handId,
      roomId: game.roomId,
    };
    realtime
      .timeout(5_000)
      .emit("game:command", command, (timeoutError: unknown, input: unknown) => {
        setPendingDecisionId(null);
        if (timeoutError !== null && timeoutError !== undefined) {
          onError("The table did not respond. Your hand will resync shortly.");
          return;
        }
        const acknowledgement = commandAcknowledgementSchema.safeParse(input);
        if (!acknowledgement.success) {
          onError("The table sent an invalid response.");
          return;
        }
        handleAcknowledgement(acknowledgement.data);
      });
  };

  const handleAcknowledgement = (acknowledgement: CommandAcknowledgement) => {
    if (!acknowledgement.ok) onError(acknowledgement.message);
  };

  return (
    <main className="table-page">
      <section className="table-shell" aria-labelledby="table-title">
        <header className="table-header">
          <h1 className="sr-only" id="table-title">
            Mahjong table
          </h1>
          <div className="table-identity">
            <span aria-label={`${seatName(game.dealer)} is dealer`} className="dealer-wind">
              {seatName(game.dealer).slice(0, 1)}
            </span>
            <div>
              <span className="table-room">Room {room.code}</span>
              <span className="table-seat-label">You are {SEAT_NAMES[game.viewerSeat]}</span>
            </div>
          </div>
          <div className="table-header-actions">
            <div aria-atomic="true" aria-live="polite" className="table-activity" role="status">
              <span>Table activity</span>
              <strong>{latestPublicAction}</strong>
            </div>
            <div className="table-status" aria-label="Turn countdown">
              <span>{game.phase === "hand-ended" ? "Hand complete" : "Live hand"}</span>
              {seconds === null ? null : <strong>{seconds}s</strong>}
            </div>
            {game.result === null || showResult ? null : (
              <button
                aria-controls="hand-result"
                className="table-result-trigger"
                onClick={() => setShowResult(true)}
                type="button"
              >
                View result
              </button>
            )}
            <button
              aria-controls="table-rules"
              aria-expanded={showRules}
              aria-label="Table rules"
              className="table-help-trigger"
              onClick={() => setShowRules(true)}
              title="How to play"
              type="button"
            >
              <span aria-hidden="true">?</span>
            </button>
            <ThemeToggle className="table-theme-toggle" onToggle={onToggleTheme} theme={theme} />
          </div>
        </header>

        <div className="table-felt" aria-label="Four-sided mahjong table">
          {game.players.map((player) => (
            <div
              className={`table-seat seat-position-${seatPosition(player.seat, game.viewerSeat)}`}
              key={player.seat}
            >
              <PlayerPanel game={game} player={player} seconds={seconds} />
              {player.seat === game.viewerSeat ? (
                <div className="hand-controls">
                  <div className="hand-tools">
                    <button className="secondary sort-button" onClick={sortHand} type="button">
                      Sort hand
                    </button>
                    <span className="drag-hint" role="status">
                      {touchReorderSourceId === null
                        ? "Drag a tile, or hold one on touch to rearrange"
                        : "Tap the tile that should follow the held tile"}
                    </span>
                  </div>
                  <div className="tile-rack" aria-label="Your concealed tiles">
                    {orderedTiles.map((tile) => (
                      <div
                        aria-label="Drag tile to reorder"
                        className={`draggable-tile${game.drawnTileId === tile.id ? " is-drawn-tile" : ""}${touchReorderSourceId === tile.id ? " is-touch-reorder-source" : ""}`}
                        data-tile-id={tile.id}
                        draggable
                        key={tile.id}
                        onDragOver={(event) => event.preventDefault()}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", tile.id);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const sourceId = event.dataTransfer.getData("text/plain");
                          if (sourceId !== "") reorderTile(sourceId, tile.id);
                        }}
                        onPointerCancel={() => {
                          clearTouchReorderTimer();
                          touchTilePress.current = null;
                        }}
                        onPointerDown={(event) => {
                          if (event.pointerType === "mouse") return;
                          clearTouchReorderTimer();
                          const press = {
                            activated: false,
                            pointerId: event.pointerId,
                            sourceId: tile.id,
                            x: event.clientX,
                            y: event.clientY,
                          };
                          touchTilePress.current = press;
                          touchReorderTimer.current = window.setTimeout(() => {
                            if (touchTilePress.current !== press) return;
                            press.activated = true;
                            touchReorderTimer.current = null;
                            setSelectedTileId(null);
                            setTouchReorderSourceId(tile.id);
                          }, 450);
                        }}
                        onPointerMove={(event) => {
                          const press = touchTilePress.current;
                          if (press?.pointerId !== event.pointerId || press.activated) return;
                          if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 12)
                            return;
                          clearTouchReorderTimer();
                          touchTilePress.current = null;
                        }}
                        onPointerUp={(event) => {
                          const press = touchTilePress.current;
                          clearTouchReorderTimer();
                          touchTilePress.current = null;
                          if (press?.pointerId !== event.pointerId || !press.activated) return;
                          suppressedTouchClick.current = press.sourceId;
                          window.setTimeout(() => {
                            if (suppressedTouchClick.current === press.sourceId)
                              suppressedTouchClick.current = null;
                          }, 0);
                        }}
                      >
                        <TileArt
                          onClick={() => selectTile(tile.id)}
                          selected={selectedTileId === tile.id}
                          tile={tile}
                        />
                      </div>
                    ))}
                  </div>
                  <ActionBar
                    commandPending={commandPending}
                    game={game}
                    legal={legal}
                    onAction={send}
                    selectedTileId={selectedTileId}
                  />
                </div>
              ) : null}
            </div>
          ))}
          <div className="table-center">
            <div className="table-center-status">
              <WallStack count={game.wallCount} />
              <span className="center-wind" title="Dealer">
                {seatName(game.dealer).slice(0, 1)}
              </span>
            </div>
            <DiscardPool game={game} />
            {game.pendingDiscard === null ? null : (
              <span className="claim-window">Claims open for the latest discard</span>
            )}
          </div>
        </div>

        {game.result === null || !showResult ? null : (
          <ResultDialog
            autoPlayAgain={autoPlayAgain}
            autoPlaySeconds={autoPlaySeconds}
            canPlayAgain={canPlayAgain}
            game={game}
            onClose={() => setShowResult(false)}
            onToggleAutoPlay={() => setAutoPlayAgain((enabled) => !enabled)}
            onShowOpponentTiles={() => setShowOpponentTiles(true)}
            onPlayAgain={startNextHand}
            pending={pending}
            rematchSeconds={rematchSeconds}
          />
        )}
        {showRules ? <RulesDialog onClose={() => setShowRules(false)} /> : null}
        {showOpponentTiles ? (
          <OpponentHandsDialog game={game} onClose={() => setShowOpponentTiles(false)} />
        ) : null}
        {error === null ? null : (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="table-footer">
          <p>{realtime?.connected ? "Connected" : "Reconnecting…"}</p>
          <button className="text-button" onClick={onLeave} type="button">
            Leave game
          </button>
        </div>
      </section>
    </main>
  );
}

function PlayerPanel({
  game,
  player,
  seconds,
}: Readonly<{
  game: GameSnapshot;
  player: GameSnapshot["players"][number];
  seconds: number | null;
}>) {
  const isViewer = player.seat === game.viewerSeat;
  const status = playerStatus(game, player.seat);
  return (
    <article
      className={`player-panel seat-${String(player.seat)} ${status.kind === "active" ? "is-active" : ""}`}
    >
      <div className="player-heading">
        <strong>{player.nickname ?? `Bot ${seatName(player.seat)}`}</strong>
        <span className="seat-heading-meta">
          {seatName(player.seat)}
          {player.seat === game.dealer ? " · Dealer" : ""}
          {player.controller === "bot" ? <BotIndicator /> : null}
        </span>
      </div>
      <span className={`turn-indicator turn-${status.kind}`}>{status.label}</span>
      {status.kind === "active" && seconds !== null ? (
        <span aria-label={`${String(seconds)} seconds remaining`} className="seat-turn-timer">
          {seconds}s remaining
        </span>
      ) : null}
      {isViewer ? null : (
        <div
          className="opponent-tiles"
          aria-label={`${player.nickname ?? "Bot"} has ${String(player.concealedCount)} concealed tiles`}
        >
          {Array.from({ length: Math.min(player.concealedCount, 14) }, (_, index) => (
            <span className="tile-back" key={index} />
          ))}
        </div>
      )}
      {player.melds.length === 0 ? null : (
        <div className="meld-strip" aria-label={`${player.nickname ?? "Player"} exposed melds`}>
          {player.melds.map((meld, index) => (
            <div className="meld-group" key={`${meld.kind}-${String(index)}`}>
              <span className="meld-name">
                {meld.kind === "chow" ? "Chow" : meld.kind === "pung" ? "Pung" : "Kong"}
              </span>
              <span className="meld-summary">
                {meld.tiles === null
                  ? `${String(meld.tileCount)} concealed tiles`
                  : meld.tiles.map((tile) => compactTileLabel(tile.type)).join(" · ")}
              </span>
              <div className="meld-tiles">
                {(meld.tiles ?? []).map((tile) => (
                  <TileArt key={tile.id} tile={tile} />
                ))}
                {meld.tiles === null
                  ? Array.from({ length: meld.tileCount }, (_, tileIndex) => (
                      <span className="tile-back" key={tileIndex} />
                    ))
                  : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function BotIndicator() {
  return (
    <span aria-label="Bot player" className="bot-indicator" role="img">
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <rect height="13" rx="3" width="16" x="4" y="7" />
        <path d="M12 3v4M9 12h0M15 12h0M9 16h6" />
      </svg>
    </span>
  );
}

function compactTileLabel(type: TileType): string {
  const details = suitedTileDetails(type);
  if (details !== null) return `${String(details.rank)} of ${details.suit}`;
  return type === "east" || type === "south" || type === "west" || type === "north"
    ? `${type} wind`
    : `${type} dragon`;
}

function playerStatus(
  game: GameSnapshot,
  seat: number,
): Readonly<{ kind: "active" | "ended" | "observing" | "waiting"; label: string }> {
  if (game.phase === "hand-ended") return { kind: "ended", label: "Hand ended" };
  if (game.activeSeat === seat) return { kind: "active", label: "Playing · choose discard" };
  if (game.waitingSeats.includes(seat)) {
    if (game.phase === "awaiting-discard") return { kind: "waiting", label: "Waiting for discard" };
    if (game.phase === "awaiting-discard-claims")
      return { kind: "waiting", label: "Waiting for claim" };
    return { kind: "waiting", label: "Waiting for response" };
  }
  return { kind: "observing", label: "Observing" };
}

function DiscardPool({ game }: Readonly<{ game: GameSnapshot }>) {
  const discards = game.players.flatMap((player) =>
    player.discards.map((tile) => ({ player, tile })),
  );
  return (
    <div className="discard-pool" aria-label="All discarded tiles">
      <div className="discard-pool-heading">
        <span className="discard-pool-label">Central pond</span>
        <span aria-label="Discard ownership colors" className="discard-legend">
          {game.players.map((player) => (
            <span className="discard-legend-item" key={player.seat}>
              <i aria-hidden="true" className={`seat-dot seat-${String(player.seat)}`} />
              {seatName(player.seat)}
            </span>
          ))}
        </span>
      </div>
      {discards.length === 0 ? (
        <span className="discard-empty">Waiting for the first discard</span>
      ) : (
        <div className="discard-grid">
          {discards.map(({ player, tile }) => (
            <span
              className={`discard-tile seat-accent-${String(player.seat)}${game.pendingDiscard?.tile.id === tile.id ? " is-latest-discard" : ""}`}
              key={tile.id}
            >
              <TileArt tile={tile} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function WallStack({ count }: Readonly<{ count: number }>) {
  return (
    <div aria-label={`${String(count)} tiles remaining in the wall`} className="wall-stack">
      <span aria-hidden="true" className="wall-tile wall-tile-back" />
      <span aria-hidden="true" className="wall-tile wall-tile-middle" />
      <span aria-hidden="true" className="wall-tile wall-tile-front" />
      <span className="wall-counter">Wall · {count}</span>
    </div>
  );
}

function RulesDialog({ onClose }: Readonly<{ onClose: () => void }>) {
  return (
    <TableDialog id="table-rules" onClose={onClose} title="How to play">
      <ul className="dialog-list">
        <li>When your card says Playing, choose one tile and select Discard selected.</li>
        <li>
          On another player&apos;s discard, choose Pass, Win, Pung, Kong, or Chow when that action
          is available. Only the next seat may Chow.
        </li>
        <li>
          Win with four sets and a pair, or seven distinct pairs. The table resolves competing
          claims by win, then kong or pung, then chow.
        </li>
        <li>
          The server shows the remaining time for each turn. A disconnected human seat is
          temporarily played by a bot and returns to human control when it reconnects.
        </li>
      </ul>
    </TableDialog>
  );
}

function OpponentHandsDialog({
  game,
  onClose,
}: Readonly<{
  game: GameSnapshot;
  onClose: () => void;
}>) {
  return (
    <TableDialog id="opponent-hands" onClose={onClose} title="Other players’ hands">
      <p className="dialog-intro">Hands are sorted by suit and rank after this hand only.</p>
      <div className="opponent-hand-grid">
        {game.players
          .filter((player) => player.seat !== game.viewerSeat)
          .map((player) => {
            const tiles = [...(player.concealedTiles ?? [])].sort((left, right) => {
              const typeDifference = tileTypeIndex(left.type) - tileTypeIndex(right.type);
              return typeDifference === 0 ? left.id.localeCompare(right.id) : typeDifference;
            });
            return (
              <article className={`opponent-hand seat-${String(player.seat)}`} key={player.seat}>
                <strong>{playerNickname(player)}</strong>
                <span>{seatName(player.seat)}</span>
                <div
                  aria-label={`${playerNickname(player)} concealed tiles`}
                  className="opponent-hand-tiles"
                >
                  {tiles.map((tile) => (
                    <TileArt key={tile.id} tile={tile} />
                  ))}
                </div>
              </article>
            );
          })}
      </div>
    </TableDialog>
  );
}

function TableDialog({
  className = "",
  children,
  id,
  onClose,
  title,
}: Readonly<{
  className?: string;
  children: ReactNode;
  id: string;
  onClose: () => void;
  title: string;
}>) {
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const dialog = useRef<HTMLElement | null>(null);
  const closeHandler = useRef(onClose);

  useEffect(() => {
    closeHandler.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const triggeringControl = document.querySelector<HTMLElement>(`[aria-controls="${id}"]`);
    const returnFocus =
      previouslyFocused?.getAttribute("aria-controls") === id
        ? previouslyFocused
        : (triggeringControl ?? previouslyFocused);
    const applicationRoot = document.querySelector<HTMLElement>("#root");
    const wasInert = applicationRoot?.inert ?? false;
    if (applicationRoot !== null) applicationRoot.inert = true;
    closeButton.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeHandler.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          [
            "a[href]",
            "button:not([disabled])",
            "input:not([disabled])",
            "select:not([disabled])",
            "textarea:not([disabled])",
            "[tabindex]:not([tabindex='-1'])",
          ].join(","),
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (applicationRoot !== null) applicationRoot.inert = wasInert;
      returnFocus?.focus();
    };
  }, [id]);

  return createPortal(
    <div className="table-dialog-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby={`${id}-title`}
        aria-modal="true"
        className={`table-dialog${className === "" ? "" : ` ${className}`}`}
        id={id}
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialog}
        role="dialog"
        tabIndex={-1}
      >
        <header className="table-dialog-header">
          <h2 id={`${id}-title`}>{title}</h2>
          <button aria-label={`Close ${title}`} onClick={onClose} ref={closeButton} type="button">
            Close
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}

function initialPublicAction(game: GameSnapshot): string {
  if (game.result?.kind === "win") return `${seatName(game.result.winner)} won the hand.`;
  if (game.result?.kind === "draw") return "The wall is empty. This hand is a draw.";
  if (game.pendingDiscard !== null)
    return discardActionLabel(game, game.pendingDiscard.seat, game.pendingDiscard.tile.type);
  if (game.pendingAddedKong !== null)
    return `${playerNicknameForSeat(game, game.pendingAddedKong.seat)} proposed an added Kong.`;
  if (game.activeSeat !== null)
    return `${playerNicknameForSeat(game, game.activeSeat)} is choosing a discard.`;
  return "Waiting for the table.";
}

function publicActionSince(previous: GameSnapshot, game: GameSnapshot): string | null {
  if (previous.handId !== game.handId) return initialPublicAction(game);

  const knownDiscardIds = new Set(
    previous.players.flatMap((player) => player.discards.map((tile) => tile.id)),
  );
  for (const player of game.players) {
    const newDiscard = player.discards.find((tile) => !knownDiscardIds.has(tile.id));
    if (newDiscard !== undefined) return discardActionLabel(game, player.seat, newDiscard.type);
  }

  if (
    game.pendingAddedKong !== null &&
    game.pendingAddedKong.tile.id !== previous.pendingAddedKong?.tile.id
  ) {
    return `${playerNicknameForSeat(game, game.pendingAddedKong.seat)} proposed an added Kong.`;
  }
  if (previous.result === null && game.result !== null) return initialPublicAction(game);
  if (game.activeSeat !== null && previous.activeSeat !== game.activeSeat)
    return `${playerNicknameForSeat(game, game.activeSeat)} is choosing a discard.`;
  return null;
}

function discardActionLabel(
  game: GameSnapshot,
  seat: number,
  type: Parameters<typeof tileTypeName>[0],
): string {
  return `${playerNicknameForSeat(game, seat)} discarded ${tileTypeName(type)}.`;
}

function playerNicknameForSeat(game: GameSnapshot, seat: number): string {
  const player = game.players.find((candidate) => candidate.seat === seat);
  return player === undefined ? seatName(seat) : playerNickname(player);
}

function playerNickname(player: GameSnapshot["players"][number]): string {
  return player.nickname ?? `Bot ${seatName(player.seat)}`;
}

function chowOptionLabel(game: GameSnapshot, tileIds: readonly string[]): string {
  const viewer = game.players.find((player) => player.seat === game.viewerSeat);
  const availableTiles = [
    ...(viewer?.concealedTiles ?? []),
    ...(game.pendingDiscard === null ? [] : [game.pendingDiscard.tile]),
  ];
  const requiredIds = new Set([
    ...tileIds,
    ...(game.pendingDiscard === null ? [] : [game.pendingDiscard.tile.id]),
  ]);
  const tiles = availableTiles
    .filter((tile) => requiredIds.has(tile.id))
    .sort((left, right) => tileTypeIndex(left.type) - tileTypeIndex(right.type));
  return tiles.length === 3
    ? `Chow: ${tiles.map((tile) => tileTypeName(tile.type)).join(", ")}`
    : "Chow";
}

function tileTypeName(type: Parameters<typeof tileTypeIndex>[0]): string {
  const details = suitedTileDetails(type);
  if (details !== null) return `${String(details.rank)} of ${details.suit}`;
  if (type === "east" || type === "south" || type === "west" || type === "north")
    return `${type} wind`;
  return `${type} dragon`;
}

function ActionBar({
  commandPending,
  game,
  legal,
  onAction,
  selectedTileId,
}: Readonly<{
  commandPending: boolean;
  game: GameSnapshot;
  legal: GameSnapshot["legalActions"];
  onAction: (action: GameCommand["action"]) => void;
  selectedTileId: string | null;
}>) {
  const [chowChoiceIndex, setChowChoiceIndex] = useState(0);
  const disabled = commandPending || game.decisionId === null;
  if (legal.kind === "none") return <p className="action-hint">Waiting for the table…</p>;
  if (legal.kind === "discard") {
    const canDiscard = selectedTileId !== null && legal.discardTileIds.includes(selectedTileId);
    return (
      <div className="action-bar">
        <button
          disabled={disabled || !canDiscard}
          onClick={() =>
            selectedTileId === null
              ? undefined
              : onAction({ kind: "discard", tileId: selectedTileId })
          }
          type="button"
        >
          {commandPending ? "Sending…" : "Discard selected"}
        </button>
        {legal.canWin ? (
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => onAction({ kind: "declare-self-win" })}
            type="button"
          >
            Win
          </button>
        ) : null}
        {legal.concealedKongs.map((tileType) => (
          <button
            className="secondary"
            disabled={disabled}
            key={tileType}
            onClick={() => onAction({ kind: "declare-concealed-kong", tileType })}
            type="button"
          >
            Kong {tileType}
          </button>
        ))}
        {legal.addedKongs.map((addedKong) => {
          const tile = game.players
            .find((player) => player.seat === game.viewerSeat)
            ?.concealedTiles?.find((candidate) => candidate.id === addedKong.tileId);
          const tileName = tile === undefined ? "tile" : tileTypeName(tile.type);
          return (
            <button
              className="secondary"
              disabled={disabled}
              key={`${String(addedKong.meldIndex)}-${addedKong.tileId}`}
              onClick={() =>
                onAction({
                  kind: "propose-added-kong",
                  meldIndex: addedKong.meldIndex,
                  tileId: addedKong.tileId,
                })
              }
              type="button"
            >
              Upgrade Pung to Kong with {tileName}
            </button>
          );
        })}
      </div>
    );
  }
  if (legal.kind === "discard-claim")
    return (
      <div className="action-bar">
        <button
          disabled={disabled}
          onClick={() => onAction({ choice: { kind: "pass" }, kind: "respond-to-discard" })}
          type="button"
        >
          Pass
        </button>
        {legal.legal.canWin ? (
          <button
            disabled={disabled}
            onClick={() => onAction({ choice: { kind: "win" }, kind: "respond-to-discard" })}
            type="button"
          >
            Win
          </button>
        ) : null}
        {legal.legal.canPung ? (
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => onAction({ choice: { kind: "pung" }, kind: "respond-to-discard" })}
            type="button"
          >
            Pung
          </button>
        ) : null}
        {legal.legal.canKong ? (
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => onAction({ choice: { kind: "kong" }, kind: "respond-to-discard" })}
            type="button"
          >
            Kong
          </button>
        ) : null}
        {legal.legal.chows.length > 1 ? (
          <select
            aria-label="Chow combination"
            className="chow-choice"
            disabled={disabled}
            onChange={(event) => setChowChoiceIndex(Number(event.target.value))}
            value={String(Math.min(chowChoiceIndex, legal.legal.chows.length - 1))}
          >
            {legal.legal.chows.map((_, index) => (
              <option key={index} value={String(index)}>
                {chowOptionLabel(game, legal.legal.chows[index]?.tileIds ?? [])}
              </option>
            ))}
          </select>
        ) : null}
        {legal.legal.chows.length === 0 ? null : (
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => {
              const chow =
                legal.legal.chows[Math.min(chowChoiceIndex, legal.legal.chows.length - 1)];
              if (chow !== undefined) {
                onAction({
                  choice: { kind: "chow", tileIds: chow.tileIds },
                  kind: "respond-to-discard",
                });
              }
            }}
            type="button"
          >
            Chow
          </button>
        )}
      </div>
    );
  return (
    <div className="action-bar">
      <button
        disabled={disabled}
        onClick={() => onAction({ choice: "pass", kind: "respond-to-kong-robbery" })}
        type="button"
      >
        Pass
      </button>
      <button
        disabled={disabled}
        onClick={() => onAction({ choice: "win", kind: "respond-to-kong-robbery" })}
        type="button"
      >
        Win
      </button>
    </div>
  );
}

function ResultDialog({
  autoPlayAgain,
  autoPlaySeconds,
  canPlayAgain,
  game,
  onClose,
  onToggleAutoPlay,
  onShowOpponentTiles,
  onPlayAgain,
  pending,
  rematchSeconds,
}: Readonly<{
  autoPlayAgain: boolean;
  autoPlaySeconds: number | null;
  canPlayAgain: boolean;
  game: GameSnapshot;
  onClose: () => void;
  onToggleAutoPlay: () => void;
  onShowOpponentTiles: () => void;
  onPlayAgain: () => void;
  pending: boolean;
  rematchSeconds: number | null;
}>) {
  const result = game.result;
  if (result === null) return null;
  const winner = result.kind === "win" ? playerNicknameForSeat(game, result.winner) : null;
  return (
    <TableDialog
      className="result-dialog"
      id="hand-result"
      onClose={onClose}
      title={result.kind === "draw" ? "Draw hand" : `${winner ?? seatName(result.winner)} wins`}
    >
      <p className="result-eyebrow">Hand complete</p>
      <div className="result-summary">
        {result.kind === "draw" ? (
          <p>The wall is empty. This hand ends in a draw.</p>
        ) : (
          <>
            <strong>
              {winner} · {seatName(result.winner)}
            </strong>
            <p>Win by {result.source.replaceAll("-", " ")}.</p>
          </>
        )}
        {result.kind === "win" ? <WinningCombination decomposition={result.decomposition} /> : null}
      </div>
      <p className="result-expiry" role="status">
        {rematchSeconds === null
          ? "Start another hand before this room closes."
          : `Room closes in ${formatRemainingTime(rematchSeconds)} unless the host starts another hand.`}
      </p>
      <div className="result-actions">
        <button disabled={!canPlayAgain || pending} onClick={onPlayAgain} type="button">
          {canPlayAgain ? (pending ? "Starting…" : "Play again") : "Waiting for host"}
        </button>
        <label className="auto-play-option">
          <input
            checked={autoPlayAgain}
            disabled={!canPlayAgain || pending}
            onChange={onToggleAutoPlay}
            type="checkbox"
          />
          {canPlayAgain
            ? `Auto-play next hand${autoPlayAgain && autoPlaySeconds !== null ? ` in ${String(autoPlaySeconds)}s` : ""}`
            : "Waiting for host"}
        </label>
        <button
          aria-controls="opponent-hands"
          className="secondary"
          onClick={onShowOpponentTiles}
          type="button"
        >
          Show other hands
        </button>
      </div>
    </TableDialog>
  );
}

function formatRemainingTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}

function WinningCombination({
  decomposition,
}: Readonly<{
  decomposition: Exclude<NonNullable<GameSnapshot["result"]>, { kind: "draw" }>["decomposition"];
}>) {
  if (decomposition.kind === "seven-pairs") {
    return (
      <div aria-label="Winning combination" className="winning-combination">
        <strong>Winning combination · Seven pairs</strong>
        <div className="winning-groups">
          {decomposition.pairs.map((pair, index) => (
            <div className="winning-group" key={`pair-${String(index)}`}>
              <span>Pair</span>
              {pair.map((tile) => (
                <TileArt key={tile.id} tile={tile} />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div aria-label="Winning combination" className="winning-combination">
      <strong>Winning combination</strong>
      <div className="winning-groups">
        <div className="winning-group">
          <span>Pair</span>
          {decomposition.pair.map((tile) => (
            <TileArt key={tile.id} tile={tile} />
          ))}
        </div>
        {decomposition.sets.map((set, index) => (
          <div className="winning-group" key={`set-${String(index)}`}>
            <span>{set.kind}</span>
            {set.tiles.map((tile) => (
              <TileArt key={tile.id} tile={tile} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function seatName(seat: number): string {
  return SEAT_NAMES[seat as 0 | 1 | 2 | 3];
}

function seatPosition(seat: number, viewerSeat: number): "north" | "east" | "south" | "west" {
  const offset = (seat - viewerSeat + 4) % 4;
  switch (offset) {
    case 0:
      return "south";
    case 1:
      return "west";
    case 2:
      return "north";
    default:
      return "east";
  }
}

function moveTile(
  currentOrder: readonly string[],
  sourceId: string,
  targetId: string,
  validIds: readonly string[],
): string[] {
  const order = [
    ...currentOrder.filter((id) => validIds.includes(id)),
    ...validIds.filter((id) => !currentOrder.includes(id)),
  ];
  const sourceIndex = order.indexOf(sourceId);
  const targetIndex = order.indexOf(targetId);
  if (sourceIndex === -1 || targetIndex === -1) return order;
  const [source] = order.splice(sourceIndex, 1);
  if (source === undefined) return order;
  order.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, source);
  return order;
}

async function requestJson<T>(
  path: string,
  schema: Readonly<{ parse: (input: unknown) => T }> | undefined,
  controllerId: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-controller-id", controllerId);
  const response = await fetch(path, { ...init, credentials: "same-origin", headers });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    throw error.success
      ? new ApiRequestError(error.data.code, error.data.message)
      : new Error("The server could not complete the request");
  }
  return schema === undefined ? (body as T) : schema.parse(body);
}

function readOccupiedRoomCode(): string | null {
  try {
    const parsed = roomCodeSchema.safeParse(
      window.sessionStorage.getItem(OCCUPIED_ROOM_STORAGE_KEY),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function persistOccupiedRoomCode(code: string): void {
  try {
    window.sessionStorage.setItem(OCCUPIED_ROOM_STORAGE_KEY, code);
  } catch {
    // Private browsing can disable storage; in-memory recovery still works in the current tab.
  }
}

function clearOccupiedRoomCode(): void {
  try {
    window.sessionStorage.removeItem(OCCUPIED_ROOM_STORAGE_KEY);
  } catch {
    // Clearing an unavailable optional recovery marker is intentionally best effort.
  }
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
    <ServerStateProvider>
      <Root />
    </ServerStateProvider>
  </StrictMode>,
);
