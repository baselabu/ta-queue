import { useEffect, useRef } from "react";
import { resetSocket, socket } from "./socket";

/**
 * Say who this tab is on every connection - the first one, and every automatic reconnect
 * after a laptop sleeps, a background tab is throttled or wifi drops.
 *
 * The server keys sessions by socket, and a reconnect is a brand new socket: without this,
 * a dashboard looks connected while the server no longer knows who it belongs to, so the
 * board goes stale and every click is refused.
 */
export function useReattach(attach: () => Promise<void>): void {
  const latest = useRef(attach);
  latest.current = attach;

  useEffect(() => {
    let running = false;
    const run = async () => {
      if (running) return; // a reconnect can land while the first attach is still in flight
      running = true;
      try {
        await latest.current();
      } finally {
        running = false;
      }
    };

    socket.on("connect", run);
    void resetSocket(); // one socket per tab: start clean, then `run` fires on connect
    return () => {
      socket.off("connect", run);
    };
  }, []);
}
