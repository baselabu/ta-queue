/** Tunables. Everything that governs room lifetime and disconnect behaviour lives here. */

const num = (v: string | undefined, fallback: number) => (v ? Number(v) : fallback);

export const config = {
  port: num(process.env.PORT, 3001),
  /** Comma-separated origins allowed to connect. "*" in dev. */
  corsOrigin: process.env.CORS_ORIGIN ?? "*",

  /** A waiting student who drops off is held this long before losing their place. */
  studentGraceMs: num(process.env.STUDENT_GRACE_MS, 45_000),
  /** A TA who drops off is held this long before being removed from the room. */
  taGraceMs: num(process.env.TA_GRACE_MS, 90_000),
  /**
   * What happens to a student whose TA vanishes mid-session.
   * "requeue" puts them back in their original queue — their original ticket number
   * still sorts them near the front, so they are seen next.
   * "complete" instead counts the session as done.
   */
  onTADisconnect: (process.env.ON_TA_DISCONNECT ?? "requeue") as "requeue" | "complete",

  /** An empty room (nobody connected) is deleted after this long. */
  emptyRoomTtlMs: num(process.env.EMPTY_ROOM_TTL_MS, 15 * 60_000),
  /** Hard ceiling on room lifetime, connected or not. */
  maxRoomLifetimeMs: num(process.env.MAX_ROOM_LIFETIME_MS, 12 * 60 * 60_000),
  sweepIntervalMs: num(process.env.SWEEP_INTERVAL_MS, 60_000),

  /** Per-socket rate limit: actions allowed per window. */
  rateLimit: { max: num(process.env.RATE_LIMIT_MAX, 40), windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 10_000) },

  maxNameLength: 32,
  maxRoomsPerServer: num(process.env.MAX_ROOMS, 500),
};
