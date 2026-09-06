import {
  apiErrorSchema,
  commandAcknowledgementSchema,
  currentRoomResponseSchema,
  gameSnapshotSchema,
  lobbyMutationAcknowledgementSchema,
  roomCodeSchema,
  tileTypeIndex,
  type CommandAcknowledgement,
  type GameCommand,
  type GameSnapshot,
  type RoomView,
} from "@mahjong-together/shared";
import { StrictMode, useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { createRoot } from "react-dom/client";
import { io, type Socket } from "socket.io-client";

import { LatestRequestGate } from "./request-gate.js";
import { ServerStateProvider, useServerState } from "./server-state.js";
import "./styles.css";
import { TileArt } from "./tile-art.js";

const controllerId = crypto.randomUUID();

function App() {
  const { dispatch, state: serverState } = useServerState();
  const { game, room } = serverState;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState(window.location.pathname);
  const [pending, setPending] = useState(false);
  const [roomExpired, setRoomExpired] = useState(false);
  const occupiedRoomCode = useRef<string | null>(null);
  const roomRequests = useRef(new LatestRequestGate());
  const realtime = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  const navigate = useCallback((nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }, []);

  const acceptRoom = useCallback(
    (nextRoom: RoomView) => {
      roomRequests.current.invalidate();
      occupiedRoomCode.current = nextRoom.code;
      setRoomExpired(false);
      dispatch({ room: nextRoom, type: "room-received" });
      realtime.current?.emit("room:watch", () => undefined);
    },
    [dispatch],
  );

  const expireRoom = useCallback(() => {
    roomRequests.current.invalidate();
    occupiedRoomCode.current = null;
    dispatch({ type: "room-cleared" });
    setRoomExpired(true);
    window.history.replaceState({}, "", "/");
    setPath("/");
  }, [dispatch]);

  const refreshRoom = useCallback(async () => {
    const requestGeneration = roomRequests.current.begin();
    const current = await requestJson("/api/rooms/current", currentRoomResponseSchema);
    if (!roomRequests.current.isCurrent(requestGeneration)) return;
    if (current.room === null) {
      if (occupiedRoomCode.current !== null) expireRoom();
      else dispatch({ type: "room-cleared" });
      return;
    }
    acceptRoom(current.room);
    if (window.location.pathname !== `/room/${current.room.code}`) {
      window.history.replaceState({}, "", `/room/${current.room.code}`);
      setPath(`/room/${current.room.code}`);
    }
  }, [acceptRoom, dispatch, expireRoom]);

  useEffect(() => {
    const initialize = async () => {
      try {
        await requestJson("/api/session", undefined, { method: "POST" });
        setSessionReady(true);
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
      setError(null);
    });
    socket.on("disconnect", () => {
      setRealtimeReady(false);
      setSocket((current) => (current === socket ? null : current));
    });
    socket.on("connect_error", (caught) => setError(errorMessage(caught)));
    socket.on("room:changed", () => {
      void refreshRoom().catch((caught: unknown) => setError(errorMessage(caught)));
    });
    socket.on("game:snapshot", (input: unknown) => {
      const snapshot = gameSnapshotSchema.safeParse(input);
      if (!snapshot.success) return;
      dispatch({ snapshot: snapshot.data, type: "game-received" });
    });
    socket.on("session:replaced", () => {
      setError("This room is now controlled from another tab. Reload to take control here.");
      setRealtimeReady(false);
    });
    socket.connect();
    return () => {
      if (realtime.current === socket) realtime.current = null;
      setSocket((current) => (current === socket ? null : current));
      socket.disconnect();
    };
  }, [dispatch, refreshRoom, sessionReady]);

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

  if (!sessionReady) {
    return (
      <StatusCard
        title="Unable to open the table"
        message={error ?? "A guest session could not be started."}
      />
    );
  }

  if (!realtimeReady) {
    return (
      <StatusCard
        title={error === null ? "Connecting to the table…" : "Table control unavailable"}
        message={error ?? "Establishing the secure live connection."}
      />
    );
  }

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
          roomRequests.current.invalidate();
          occupiedRoomCode.current = null;
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
      />
    );
  }

  const inviteCode = inviteCodeFromPath(path);
  if (inviteCode !== null) {
    return (
      <JoinRoom
        code={inviteCode}
        error={error}
        onJoined={refreshRoom}
        onMutationStart={() => roomRequests.current.invalidate()}
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
            roomRequests.current.invalidate();
            setPending(true);
            setError(null);
            try {
              const created = await requestJson("/api/rooms", lobbyMutationAcknowledgementSchema, {
                body: JSON.stringify({ commandId: crypto.randomUUID(), nickname }),
                headers: { "content-type": "application/json" },
                method: "POST",
              });
              navigate(`/room/${created.roomCode}`);
              await refreshRoom();
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
  onJoined: () => Promise<void>;
  onMutationStart: () => void;
  pending: boolean;
  setError: (message: string | null) => void;
  setPending: (pending: boolean) => void;
}>;

function JoinRoom({
  code,
  error,
  onJoined,
  onMutationStart,
  pending,
  setError,
  setPending,
}: JoinRoomProperties) {
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
                onMutationStart();
                setPending(true);
                setError(null);
                try {
                  await requestJson(`/api/rooms/${code}/join`, lobbyMutationAcknowledgementSchema, {
                    body: JSON.stringify({ commandId: crypto.randomUUID(), nickname }),
                    headers: { "content-type": "application/json" },
                    method: "POST",
                  });
                  await onJoined();
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
  game: GameSnapshot | null;
  onError: (message: string | null) => void;
  onExpired: () => void;
  onLeave: () => void;
  onInvalidateRoomRequests: () => void;
  onRefresh: () => Promise<void>;
  pending: boolean;
  realtime: Socket | null;
  room: RoomView;
  setPending: (pending: boolean) => void;
}>;

function Lobby({
  error,
  game,
  onError,
  onExpired,
  onLeave,
  onInvalidateRoomRequests,
  onRefresh,
  pending,
  realtime,
  room,
  setPending,
}: LobbyProperties) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState(false);
  const viewer = room.seats[room.viewerSeat];
  const viewerIsHost = viewer?.kind === "human" && viewer.host;
  const inviteUrl = `${window.location.origin}/room/${room.code}`;

  if (room.phase === "active" && game !== null) {
    return (
      <Table
        error={error}
        game={game}
        onError={onError}
        onLeave={onLeave}
        realtime={realtime}
        room={room}
      />
    );
  }

  const mutate = async (path: string, body: Record<string, unknown>) => {
    setPending(true);
    onError(null);
    try {
      await requestJson(path, lobbyMutationAcknowledgementSchema, {
        body: JSON.stringify({ commandId: crypto.randomUUID(), ...body }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      await onRefresh();
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

        <button
          className="text-button"
          disabled={pending}
          onClick={() => {
            if (
              room.phase === "active" &&
              !window.confirm("Leave this hand and give your seat to a bot?")
            )
              return;
            onInvalidateRoomRequests();
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

type TableProperties = Readonly<{
  error: string | null;
  game: GameSnapshot;
  onError: (message: string | null) => void;
  onLeave: () => void;
  realtime: Socket | null;
  room: RoomView;
}>;

function Table({ error, game, onError, onLeave, realtime, room }: TableProperties) {
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [pendingDecisionId, setPendingDecisionId] = useState<string | null>(null);
  const [tileOrder, setTileOrder] = useState<string[]>([]);
  const [showOpponentTiles, setShowOpponentTiles] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
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
  };
  const deadlineRemaining =
    game.deadline === null
      ? null
      : Math.max(0, game.deadline - game.serverTime - (clock - game.serverTime));
  const seconds = deadlineRemaining === null ? null : Math.ceil(deadlineRemaining / 1000);

  useEffect(() => {
    if (game.phase === "hand-ended" || game.deadline === null) return;
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [game.deadline, game.phase]);

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
          <div>
            <p className="eyebrow">
              Room {room.code} · {SEAT_NAMES[game.viewerSeat]}
            </p>
            <h1 id="table-title">Hand starting · Mahjong table</h1>
          </div>
          <div className="table-status" aria-live="polite">
            <span>
              {game.phase === "hand-ended" ? "Hand complete" : game.phase.replaceAll("-", " ")}
            </span>
            {seconds === null ? null : <strong>{seconds}s</strong>}
          </div>
        </header>

        <div className="table-felt" aria-label="Four-sided mahjong table">
          {game.players.map((player) => (
            <div
              className={`table-seat seat-position-${seatPosition(player.seat, game.viewerSeat)}`}
              key={player.seat}
            >
              <PlayerPanel game={game} player={player} showOpponentTiles={showOpponentTiles} />
              {player.seat === game.viewerSeat ? (
                <div className="hand-controls">
                  <div className="hand-tools">
                    <button className="secondary sort-button" onClick={sortHand} type="button">
                      Sort hand
                    </button>
                    <span className="drag-hint">Drag tiles to reorder</span>
                  </div>
                  <div className="tile-rack" aria-label="Your concealed tiles">
                    {orderedTiles.map((tile) => (
                      <div
                        aria-label="Drag tile to reorder"
                        className="draggable-tile"
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
                          if (sourceId === "" || sourceId === tile.id) return;
                          setTileOrder((current) =>
                            moveTile(
                              current.length === 0 ? serverTileIds : current,
                              sourceId,
                              tile.id,
                              serverTileIds,
                            ),
                          );
                        }}
                      >
                        <TileArt
                          onClick={() => setSelectedTileId(tile.id)}
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
            <div className="wall-counter">Wall · {game.wallCount}</div>
            <DiscardPool game={game} />
            {game.pendingDiscard === null ? null : (
              <div className="pending-discard">
                Current discard <TileArt tile={game.pendingDiscard.tile} />
              </div>
            )}
          </div>
        </div>

        {game.result === null ? null : (
          <ResultBanner
            game={game}
            onToggleOpponentTiles={() => setShowOpponentTiles((visible) => !visible)}
            showOpponentTiles={showOpponentTiles}
          />
        )}
        <details className="help-panel">
          <summary>How to play</summary>
          <p>
            Choose a tile, then discard it. When another player discards, claim with win, pung,
            kong, chow, or pass. A green status means the server is in control of the hand.
          </p>
        </details>
        {error === null ? null : (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="table-footer">
          <p>
            Live table · server revision {game.roomRevision} ·{" "}
            {realtime?.connected ? "Connected" : "Reconnecting…"}
          </p>
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
  showOpponentTiles,
}: Readonly<{
  game: GameSnapshot;
  player: GameSnapshot["players"][number];
  showOpponentTiles: boolean;
}>) {
  const isViewer = player.seat === game.viewerSeat;
  const showTiles = !isViewer && game.phase === "hand-ended" && showOpponentTiles;
  const status = playerStatus(game, player.seat);
  return (
    <article
      className={`player-panel seat-${String(player.seat)} ${status.kind === "active" ? "is-active" : ""}`}
    >
      <div className="player-heading">
        <strong>{player.nickname ?? `Bot ${seatName(player.seat)}`}</strong>
        <span>{seatName(player.seat)}</span>
      </div>
      <small className="seat-detail">
        {player.connected ? "Connected" : "Reconnecting"} ·{" "}
        {player.controller === "bot" ? "Bot control" : "Human control"}
      </small>
      <span className={`turn-indicator turn-${status.kind}`} aria-live="polite">
        {status.label}
      </span>
      {isViewer ? null : (
        <div
          className="opponent-tiles"
          aria-label={
            showTiles
              ? `${player.nickname ?? "Player"}'s revealed tiles`
              : `${player.nickname ?? "Bot"} has ${String(player.concealedCount)} concealed tiles`
          }
        >
          {showTiles
            ? (player.concealedTiles ?? []).map((tile) => <TileArt key={tile.id} tile={tile} />)
            : Array.from({ length: Math.min(player.concealedCount, 14) }, (_, index) => (
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
      <span className="discard-pool-label">Discard pool</span>
      {discards.length === 0 ? (
        <span className="discard-empty">No discards yet</span>
      ) : (
        <div className="discard-grid">
          {discards.map(({ player, tile }) => (
            <span className={`discard-tile seat-accent-${String(player.seat)}`} key={tile.id}>
              <TileArt tile={tile} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
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
        {legal.legal.chows.map((chow, index) => (
          <button
            className="secondary"
            disabled={disabled}
            key={index}
            onClick={() =>
              onAction({
                choice: { kind: "chow", tileIds: chow.tileIds },
                kind: "respond-to-discard",
              })
            }
            type="button"
          >
            Chow
          </button>
        ))}
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

function ResultBanner({
  game,
  onToggleOpponentTiles,
  showOpponentTiles,
}: Readonly<{
  game: GameSnapshot;
  onToggleOpponentTiles: () => void;
  showOpponentTiles: boolean;
}>) {
  const result = game.result;
  if (result === null) return null;
  return (
    <div className="result-banner">
      <div>
        <strong>{result.kind === "draw" ? "Draw hand" : `${seatName(result.winner)} wins`}</strong>
        <span>
          {result.kind === "draw"
            ? "The wall is empty."
            : `Win by ${result.source.replaceAll("-", " ")}.`}
        </span>
      </div>
      <button className="secondary" onClick={onToggleOpponentTiles} type="button">
        {showOpponentTiles ? "Hide other hands" : "Show other hands"}
      </button>
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
      <App />
    </ServerStateProvider>
  </StrictMode>,
);
