# TA Queue

Two queues for a busy lab session: one for students who want an assignment approved, one
for students who are stuck. TAs work both from a single board that everyone sees update
live.

Open the site, click **Create room**, put the code and QR on the projector. Students scan
and pick a queue. Other TAs join with a second, private code.

There is no database and no login. A room lives in the server's memory for as long as the
session runs, and disappears when the host closes it or the server restarts. That is the
whole design.

---

## Quick start

```bash
npm install
npm run dev
```

- Dashboard and landing page: <http://localhost:5173>
- API and health check: <http://localhost:3001/healthz>

The dev client talks to the API on port 3001 of whatever host you loaded it from, so a
phone on the same wifi can scan the QR code and reach the room without any configuration.

### Production

```bash
npm run build     # builds the client into client/dist
npm start         # serves the API, the websocket and the built client on one port
```

Everything runs in one Node process on `PORT` (default 3001). Open
<http://localhost:3001>.

---

## How a session runs

1. A TA creates a room and becomes the **host**. They get a 6-digit **student code** and a
   separate 6-digit **TA code**.
2. Students open `/join/<student code>` — by scanning the QR code or typing the digits —
   enter a name, and choose **Assignment approval** or **I need help**.
3. Every student who joins gets the next number from **one counter shared by both queues**,
   so `#1 #2` in Approval and `#3` in Help means the Help student arrived third. Numbers
   are never reused, even when someone leaves.
4. Any TA can click any waiting student in either queue. The server decides who gets them;
   the second TA to click sees "already taken".
5. The TA clicks **Complete**, which adds to either the Approved or the Helped count and
   frees the TA.
6. The host clicks **Close room**. Everyone is told, and the room is deleted.

---

## Layout

```
ta-queue/
├── shared/types.ts        one set of types for both sides of the socket
├── server/
│   └── src/
│       ├── index.ts       express + socket.io bootstrap, health check, SPA hosting
│       ├── config.ts      every tunable: grace periods, TTLs, rate limits
│       ├── codes.ts       cryptographically random room codes
│       ├── roomManager.ts all room state and all the rules that change it
│       ├── views.ts       what each audience is allowed to see
│       └── socket.ts      event handlers, roles, validation, broadcasting
└── client/
    └── src/
        ├── pages/         Landing, JoinStudent, Dashboard
        ├── components/    JoinBanner, QueuePanel, TAPanel, ui primitives
        └── lib/           socket wrapper, per-tab session
```

`shared/types.ts` is type-only, so it is erased at compile time and needs no build step of
its own.

---

## The server is the only source of truth

Clients never remove a student from a queue on their own. They emit an event, the server
validates it, mutates the room, and broadcasts the result to everyone.

**Race conditions.** Node runs one JavaScript task to completion before starting the next,
and every method on `RoomManager` is synchronous. Two TAs clicking the same student arrive
as two separate tasks: the first sets `student.status = "assigned"` before the second is
ever entered, so the second is rejected. No lock is needed, and the acceptance test fires
both clicks at once to prove it.

**Roles.** Each socket carries a server-assigned role of `host`, `ta` or `student`. The
client cannot claim one. Taking, completing and closing all re-check the role and the room
on every call.

**The TA code** is sent only in the answer to the host's own `room:create` or `ta:resume`.
It is not part of the broadcast room state, so no student client ever receives it.

### Socket events

| Client sends      | Server answers with                       |
| ----------------- | ----------------------------------------- |
| `room:create`     | student code, TA code, your TA id         |
| `ta:join`         | your TA id (TA code only if you are host) |
| `ta:resume`       | the same, after a refresh                 |
| `ta:take`         | ok, or why not                            |
| `ta:complete`     | ok, or why not                            |
| `room:close`      | ok (host only)                            |
| `student:join`    | your ticket number                        |
| `student:resume`  | the same, after a refresh                 |
| `student:leave`   | ok                                        |

| Server pushes    | To                                              |
| ---------------- | ----------------------------------------------- |
| `room:state`     | everyone in the room — queues, TAs, counters    |
| `student:state`  | one student — their number, position and TA     |
| `room:closed`    | everyone, once, before the room is deleted      |

Every call answers with `{ ok: true, data }` or `{ ok: false, error }`, where `error` is a
sentence meant to be shown to the person. Stack traces stay on the server.

---

## Disconnects

Campus wifi drops, and a page refresh looks exactly like a disconnect, so nobody loses
their place immediately.

| Who                    | What happens                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| Waiting student drops  | Held for `STUDENT_GRACE_MS` (45s), then removed from the queue. Reconnecting cancels the timer. |
| TA drops while helping | Their student is released **at once**; the TA slot is held for `TA_GRACE_MS` (90s).            |

What happens to that released student is set by `ON_TA_DISCONNECT`:

- `requeue` (default) — back into their original queue. Their original ticket number still
  sorts them near the front, so they are seen next rather than sent to the back.
- `complete` — the session is counted as finished instead.

A tab that refreshes reconnects with the id it saved in `sessionStorage` and picks up
exactly where it was, ticket number included.

## Room cleanup

- Host closes the room → deleted immediately.
- Nobody connected for `EMPTY_ROOM_TTL_MS` (15 min) → deleted.
- Older than `MAX_ROOM_LIFETIME_MS` (12 h) → deleted.

A sweeper runs once a minute. Deleting a room clears its timers and drops every reference,
so nothing survives it.

---

## Configuration

Copy the examples and edit what you need:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

**Server** (`server/.env`) — `PORT`, `CORS_ORIGIN`, the grace periods and TTLs above,
`ON_TA_DISCONNECT`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`.

**Client** (`client/.env`) — build-time, so rebuild after changing:

- `VITE_SERVER_URL` — where the websocket lives. Leave empty when one process serves both,
  which is the production default.
- `VITE_PUBLIC_URL` — the address encoded in the QR code. Set this when students reach the
  app at a different address from the one the dashboard is open on.

Nothing about localhost is hardcoded in production code.

---

## Deploying

The app is one Node process serving HTTP, websockets and the built client.

```bash
npm ci
npm run build
CORS_ORIGIN=https://taqueue.example.edu PORT=8080 npm start
```

Requirements for the host or reverse proxy:

- **Websockets must be allowed to upgrade.** Socket.IO falls back to HTTP long-polling if
  they are not, which works but is heavier. On nginx:

  ```nginx
  location / {
      proxy_pass         http://127.0.0.1:8080;
      proxy_http_version 1.1;
      proxy_set_header   Upgrade $http_upgrade;
      proxy_set_header   Connection "upgrade";
      proxy_set_header   Host $host;
      proxy_read_timeout 300s;
  }
  ```

- **One instance.** Rooms live in the memory of a single process, so do not run several
  replicas or a platform that sleeps idle dynos. If you ever need more than one instance,
  the place to change is `RoomManager` — make its methods async and back them with Redis.
  Nothing outside that file touches the Maps.

- **Health check:** `GET /healthz` returns `{ status, rooms, uptime }`.

- `SIGINT` and `SIGTERM` close the sockets and exit cleanly. Rooms are lost on restart,
  which is expected; deploy between lab sessions.

---

## Tests

```bash
npm test         # 32 tests: unit + full socket-level acceptance run
npm run typecheck
```

`roomManager.test.ts` covers the rules directly: code generation, the shared ticket
counter, numbers never being reused after someone leaves, take/complete, the TA-disconnect
policy, cleanup, and that the broadcast state never contains the TA code.

`acceptance.test.ts` runs the full session scenario against a real Socket.IO server with
real client sockets — four students across both queues, two TAs seeing identical state,
simultaneous clicks on the same student, a student refreshing mid-queue, and the host
closing the room — plus the permission checks: students cannot take, complete or close;
a non-host TA cannot close; a wrong TA code is refused.
