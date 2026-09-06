import { z } from "zod";

export const roomCodeSchema = z
  .string()
  .regex(/^[a-z0-9]{12}$/, "Room codes must contain 12 lowercase letters or numbers");

export const nicknameSchema = z.string().trim().min(1).max(20);

export const roomMutationSchema = z.strictObject({
  commandId: z.uuid(),
});

export const createRoomRequestSchema = roomMutationSchema
  .extend({
    nickname: nicknameSchema,
  })
  .strict();

export const joinRoomRequestSchema = createRoomRequestSchema;

export const setReadyRequestSchema = roomMutationSchema
  .extend({
    ready: z.boolean(),
  })
  .strict();

export const lobbyOccupantSchema = z.discriminatedUnion("kind", [
  z.object({
    connected: z.boolean(),
    host: z.boolean(),
    kind: z.literal("human"),
    nickname: nicknameSchema,
    ready: z.boolean(),
  }),
  z.object({ kind: z.literal("bot") }),
]);

export const roomViewSchema = z.object({
  canStart: z.boolean(),
  code: roomCodeSchema,
  phase: z.enum(["lobby", "active"]),
  roomRevision: z.number().int().nonnegative(),
  seats: z.array(lobbyOccupantSchema.nullable()).length(4),
  viewerReady: z.boolean(),
  viewerSeat: z.number().int().min(0).max(3),
});

export const sessionViewSchema = z.object({
  expiresAt: z.number().int().positive(),
});

export const currentRoomResponseSchema = z.object({
  room: roomViewSchema.nullable(),
});

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const lobbyMutationAcknowledgementSchema = z.object({
  commandId: z.uuid(),
  ok: z.literal(true),
  roomCode: roomCodeSchema,
});

export type ApiError = z.infer<typeof apiErrorSchema>;
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
export type JoinRoomRequest = z.infer<typeof joinRoomRequestSchema>;
export type LobbyMutationAcknowledgement = z.infer<typeof lobbyMutationAcknowledgementSchema>;
export type RoomView = z.infer<typeof roomViewSchema>;
export type SessionView = z.infer<typeof sessionViewSchema>;
export type SetReadyRequest = z.infer<typeof setReadyRequestSchema>;
