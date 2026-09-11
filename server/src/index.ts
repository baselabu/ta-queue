import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { config } from "./config.js";
import { RoomManager } from "./roomManager.js";
import { registerHandlers, type TAQueueServer } from "./socket.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, "../../client/dist");
const origins = config.corsOrigin === "*" ? true : config.corsOrigin.split(",").map((o) => o.trim());

const app = express();
app.use(cors({ origin: origins }));
app.disable("x-powered-by");

const rooms = new RoomManager();

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", rooms: rooms.size, uptime: Math.round(process.uptime()) });
});

// In production the built client is served from this same process, so one deploy is enough.
app.use(express.static(clientDist));
// SPA fallback: any GET that is not a real file or an API path renders the app shell.
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/socket.io")) return next();
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

// Never leak a stack trace to a browser.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[http]", err);
  res.status(500).json({ error: "Something went wrong." });
});

const httpServer = createServer(app);
const io: TAQueueServer = new Server(httpServer, {
  cors: { origin: origins },
  // Long-lived lab sessions on flaky campus wifi: keep the socket forgiving.
  pingInterval: 20_000,
  pingTimeout: 25_000,
  connectionStateRecovery: { maxDisconnectionDuration: 30_000 },
});

registerHandlers(io, rooms);
rooms.startSweeper();

httpServer.listen(config.port, () => {
  console.log(`TA Queue server listening on :${config.port}`);
});

process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    rooms.stopSweeper();
    io.close();
    httpServer.close(() => process.exit(0));
  });
}
