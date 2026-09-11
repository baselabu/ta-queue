import { io, type Socket } from "socket.io-client";
import type { Ack, ClientToServer, ServerToClient } from "@shared/types";

/**
 * In production the built client is served by the API host, so same-origin is right.
 * In dev the Vite server runs on its own port, so point at the API's default port on the
 * same host - that also works when a phone on the same wifi scans the QR code.
 */
const serverUrl =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : window.location.origin);

export const socket: Socket<ServerToClient, ClientToServer> = io(serverUrl, {
  autoConnect: true,
  transports: ["websocket", "polling"],
  reconnectionDelayMax: 4000,
});

/**
 * One socket carries one room membership, and the server refuses a second. Navigating
 * between pages therefore starts a fresh connection before joining again.
 */
export function resetSocket(): Promise<void> {
  return new Promise((resolve) => {
    socket.disconnect();
    socket.once("connect", () => resolve());
    socket.connect();
  });
}

/** Emit and wait for the server's verdict. Rejects with the message meant for the user. */
export function call<T>(event: keyof ClientToServer, payload: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    // The typed event map describes the concrete handlers; this generic bridge steps around it.
    const loose = socket as unknown as Socket;
    loose.timeout(10_000).emit(event, payload, (timedOut: unknown, response: Ack<T>) => {
      if (timedOut) return reject(new Error("The server is not responding. Check your connection."));
      if (!response?.ok) return reject(new Error(response?.error ?? "Something went wrong."));
      resolve(response.data);
    });
  });
}

export const message = (err: unknown): string =>
  err instanceof Error ? err.message : "Something went wrong.";
