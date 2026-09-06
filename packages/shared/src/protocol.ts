import { z } from "zod";

import { roomCodeSchema } from "./lobby.js";
import { physicalTileSchema, tileTypeSchema } from "./tiles.js";

export const claimChoiceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("pass") }),
  z.strictObject({ kind: z.literal("win") }),
  z.strictObject({ kind: z.literal("pung") }),
  z.strictObject({ kind: z.literal("kong") }),
  z.strictObject({ kind: z.literal("chow"), tileIds: z.tuple([z.string(), z.string()]) }),
]);

export const gameActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("discard"), tileId: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("declare-self-win") }),
  z.strictObject({ kind: z.literal("declare-concealed-kong"), tileType: tileTypeSchema }),
  z.strictObject({
    kind: z.literal("propose-added-kong"),
    meldIndex: z.number().int().min(0).max(3),
    tileId: z.string().min(1).max(64),
  }),
  z.strictObject({ choice: claimChoiceSchema, kind: z.literal("respond-to-discard") }),
  z.strictObject({
    choice: z.enum(["pass", "win"]),
    kind: z.literal("respond-to-kong-robbery"),
  }),
]);

export const gameCommandSchema = z.strictObject({
  action: gameActionSchema,
  commandId: z.uuid(),
  decisionId: z.string().min(1).max(128),
  handId: z.uuid(),
  roomId: roomCodeSchema,
});

export const commandAcknowledgementSchema = z.discriminatedUnion("ok", [
  z.object({
    commandId: z.uuid(),
    ok: z.literal(true),
    roomRevision: z.number().int().nonnegative(),
  }),
  z.object({
    code: z.string(),
    commandId: z.uuid(),
    message: z.string(),
    ok: z.literal(false),
    roomRevision: z.number().int().nonnegative().optional(),
  }),
]);

const publicMeldSchema = z.object({
  concealed: z.boolean(),
  kind: z.enum(["chow", "pung", "kong"]),
  tileCount: z.number().int().min(3).max(4),
  tiles: z.array(physicalTileSchema).nullable(),
});

const snapshotPlayerSchema = z.object({
  concealedCount: z.number().int().nonnegative(),
  concealedTiles: z.array(physicalTileSchema).nullable(),
  connected: z.boolean(),
  controller: z.enum(["human", "bot"]),
  discards: z.array(physicalTileSchema),
  melds: z.array(publicMeldSchema),
  nickname: z.string().nullable(),
  seat: z.number().int().min(0).max(3),
});

const legalDiscardClaimsSchema = z.object({
  canKong: z.boolean(),
  canPung: z.boolean(),
  canWin: z.boolean(),
  chows: z.array(z.object({ tileIds: z.tuple([z.string(), z.string()]) })),
});

export const snapshotLegalActionsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    addedKongs: z.array(z.object({ meldIndex: z.number().int(), tileId: z.string() })),
    canWin: z.boolean(),
    concealedKongs: z.array(tileTypeSchema),
    discardTileIds: z.array(z.string()),
    kind: z.literal("discard"),
  }),
  z.object({ kind: z.literal("discard-claim"), legal: legalDiscardClaimsSchema }),
  z.object({ kind: z.literal("kong-robbery") }),
]);

const winningSetSchema = z.object({
  declared: z.boolean(),
  kind: z.enum(["chow", "pung", "kong"]),
  tiles: z.array(physicalTileSchema),
});

const winningDecompositionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("normal"),
    pair: z.tuple([physicalTileSchema, physicalTileSchema]),
    sets: z.array(winningSetSchema),
  }),
  z.object({
    kind: z.literal("seven-pairs"),
    pairs: z.array(z.tuple([physicalTileSchema, physicalTileSchema])).length(7),
  }),
]);

const handResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("draw") }),
  z.object({
    decomposition: winningDecompositionSchema,
    kind: z.literal("win"),
    source: z.enum(["self-draw", "discard", "robbed-added-kong"]),
    tileId: z.string(),
    winner: z.number().int().min(0).max(3),
  }),
]);

export const gameSnapshotSchema = z.object({
  activeSeat: z.number().int().min(0).max(3).nullable(),
  deadline: z.number().int().nullable(),
  decisionId: z.string().nullable(),
  dealer: z.number().int().min(0).max(3),
  drawnTileId: z.string().nullable(),
  handId: z.uuid(),
  legalActions: snapshotLegalActionsSchema,
  pendingAddedKong: z
    .object({ seat: z.number().int().min(0).max(3), tile: physicalTileSchema })
    .nullable(),
  pendingDiscard: z
    .object({ seat: z.number().int().min(0).max(3), tile: physicalTileSchema })
    .nullable(),
  phase: z.enum([
    "awaiting-discard",
    "awaiting-discard-claims",
    "awaiting-kong-robbery",
    "hand-ended",
  ]),
  players: z.array(snapshotPlayerSchema).length(4),
  result: handResultSchema.nullable(),
  roomId: roomCodeSchema,
  roomRevision: z.number().int().nonnegative(),
  serverTime: z.number().int(),
  viewerSeat: z.number().int().min(0).max(3),
  waitingSeats: z.array(z.number().int().min(0).max(3)),
  wallCount: z.number().int().nonnegative(),
});

export type CommandAcknowledgement = z.infer<typeof commandAcknowledgementSchema>;
export type GameCommand = z.infer<typeof gameCommandSchema>;
export type GameSnapshot = z.infer<typeof gameSnapshotSchema>;
