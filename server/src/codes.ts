import { randomInt } from "node:crypto";

const DIGITS = 6;

/** Cryptographically random 6-digit code, e.g. "482731". */
export function randomCode(): string {
  return String(randomInt(0, 10 ** DIGITS)).padStart(DIGITS, "0");
}

/** A code that satisfies `isTaken` — used to keep student codes unique per server. */
export function uniqueCode(isTaken: (code: string) => boolean): string {
  for (let i = 0; i < 100; i++) {
    const code = randomCode();
    if (!isTaken(code)) return code;
  }
  throw new Error("Could not allocate a room code");
}
