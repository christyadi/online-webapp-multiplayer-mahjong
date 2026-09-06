import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";

import type { GameSnapshot, RoomView } from "@mahjong-together/shared";

type ServerState = Readonly<{
  game: GameSnapshot | null;
  room: RoomView | null;
}>;

export type ServerStateAction =
  | Readonly<{ room: RoomView; type: "room-received" }>
  | Readonly<{ snapshot: GameSnapshot; type: "game-received" }>
  | Readonly<{ type: "room-cleared" }>;

const ServerStateContext = createContext<
  Readonly<{ dispatch: Dispatch<ServerStateAction>; state: ServerState }> | undefined
>(undefined);

const initialState: ServerState = { game: null, room: null };

export function ServerStateProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [state, dispatch] = useReducer(reduceServerState, initialState);
  return (
    <ServerStateContext.Provider value={{ dispatch, state }}>
      {children}
    </ServerStateContext.Provider>
  );
}

export function useServerState() {
  const value = useContext(ServerStateContext);
  if (value === undefined) throw new Error("ServerStateProvider is missing");
  return value;
}

export function reduceServerState(state: ServerState, action: ServerStateAction): ServerState {
  if (action.type === "room-cleared") return initialState;
  if (action.type === "room-received") {
    const knownRevision = Math.max(
      state.room?.code === action.room.code ? state.room.roomRevision : -1,
      state.game?.roomId === action.room.code ? state.game.roomRevision : -1,
    );
    if (knownRevision > action.room.roomRevision) return state;
    return {
      game:
        action.room.phase === "active" && state.game?.roomId === action.room.code
          ? state.game
          : null,
      room: action.room,
    };
  }
  if (state.room?.code !== action.snapshot.roomId) return state;
  if (
    state.room.roomRevision > action.snapshot.roomRevision ||
    (state.game !== null && state.game.roomRevision > action.snapshot.roomRevision)
  )
    return state;
  return { ...state, game: action.snapshot };
}
