import { z } from "zod";

export const healthResponseSchema = z.object({ status: z.literal("ok") });

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export * from "./lobby.js";
export * from "./tiles.js";
