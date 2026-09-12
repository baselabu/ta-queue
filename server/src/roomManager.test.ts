import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RoomError, RoomManager, cleanName, type Room } from "./roomManager.js";
import { roomState, studentState } from "./views.js";
import { config } from "./config.js";

const tickets = (room: Room, queue: "approval" | "help") =>
  roomState(room)[queue].map((s) => s.ticket);

describe("room creation", () => {
  test("issues a student code and a separate TA code", () => {
    const { room, host } = new RoomManager().createRoom("Sara");

    assert.match(room.studentCode, /^\d{6}$/);
    assert.match(room.taCode, /^\d{6}$/);
    assert.notEqual(room.studentCode, room.taCode);
    assert.equal(host.isHost, true);
    assert.equal(room.hostId, host.id);
    assert.equal(room.tas.size, 1);
  });

  test("codes are unique across rooms", () => {
    const rooms = new RoomManager();
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) codes.add(rooms.createRoom("Host").room.studentCode);
    assert.equal(codes.size, 50);
  });

  test("looking up an unknown code fails with a readable message", () => {
    assert.throws(() => new RoomManager().getByStudentCode("000000"), RoomError);
  });
});

describe("ticket numbering", () => {
  test("one counter serves both queues, in arrival order", () => {
    const rooms = new RoomManager();
    const { room } = rooms.createRoom("Host");

    const a = rooms.joinQueue(room, "Alice", "approval");
    const b = rooms.joinQueue(room, "Bob", "approval");
    const c = rooms.joinQueue(room, "Charlie", "help");
    const d = rooms.joinQueue(room, "David", "approval");

    assert.deepEqual([a.ticket, b.ticket, c.ticket, d.ticket], [1, 2, 3, 4]);
    assert.deepEqual(tickets(room, "approval"), [1, 2, 4]);
    assert.deepEqual(tickets(room, "help"), [3]);
  });

  test("leaving retires a ticket number instead of renumbering", () => {
    const rooms = new RoomManager();
    const { room } = rooms.createRoom("Host");

    rooms.joinQueue(room, "A", "approval");
    const second = rooms.joinQueue(room, "B", "approval");
    rooms.joinQueue(room, "C", "approval");
    rooms.joinQueue(room, "D", "approval");

    rooms.leaveQueue(room, second);

    assert.deepEqual(tickets(room, "approval"), [1, 3, 4]);
    assert.equal(rooms.joinQueue(room, "E", "approval").ticket, 5);
  });

  test("a student sees how many hold a lower ticket in their own queue", () => {
    const rooms = new RoomManager();
    const { room } = rooms.createRoom("Host");

    rooms.joinQueue(room, "A", "approval");
    rooms.joinQueue(room, "B", "help");
    const c = rooms.joinQueue(room, "C", "approval");

    assert.equal(studentState(room, c).ahead, 1);
  });
});

describe("taking a student", () => {
  test("an available TA takes a waiting student", () => {
    const rooms = new RoomManager();
    const { room, host } = rooms.createRoom("Sara");
    const alice = rooms.joinQueue(room, "Alice", "approval");

    rooms.take(room, host, alice.id);

    assert.equal(alice.status, "assigned");
    assert.equal(host.currentStudentId, alice.id);
    assert.deepEqual(tickets(room, "approval"), []);
    assert.deepEqual(roomState(room).tas[0]?.current, {
      id: alice.id,
      name: "Alice",
      ticket: 1,
      queue: "approval",
    });
  });

  test("only one of two TAs racing for the same student wins", () => {
    const rooms = new RoomManager();
    const { room, host } = rooms.createRoom("Sara");
    const jonas = rooms.joinTA(room, room.taCode, "Jonas");
    const alice = rooms.joinQueue(room, "Alice", "approval");

    rooms.take(room, host, alice.id);
    assert.throws(() => rooms.take(room, jonas, alice.id), /already taken/);

    assert.equal(alice.taId, host.id);
    assert.equal(jonas.currentStudentId, null);
  });

  test("a busy TA cannot take a second student", () => {
    const rooms = new RoomManager();
    const { room, host } = rooms.createRoom("Sara");
    const alice = rooms.joinQueue(room, "Alice", "approval");
    const bob = rooms.joinQueue(room, "Bob", "help");

    rooms.take(room, host, alice.id);
    assert.throws(() => rooms.take(room, host, bob.id), /current student/);
    assert.equal(bob.status, "waiting");
  });

  test("taking a student who has left fails", () => {
    const rooms = new RoomManager();
    const { room, host } = rooms.createRoom("Sara");
    assert.throws(() => rooms.take(room, host, "nobody"), /left the queue/);
  });
});

describe("completing", () => {
  test("approval and help increment their own counter and free the TA", () => {
    const rooms = new RoomManager();
    const { room, host } = rooms.createRoom("Sara");
    const alice = rooms.joinQueue(room, "Alice", "approval");
    const bob = rooms.joinQueue(room, "Bob", "help");

    rooms.take(room, host, alice.id);
    rooms.complete(room, host);
    assert.deepEqual([room.approvedCount, room.helpedCount], [1, 0]);
    assert.equal(host.currentStudentId, null);

    rooms.take(room, host, bob.id);
    rooms.complete(room, host);
    assert.deepEqual([room.approvedCount, room.helpedCount], [1, 1]);
    assert.equal(bob.status, "completed");
  });

  test("completing with nobody assigned fails", () => {
    const rooms = new RoomManager();
    const { room, host } = rooms.createRoom("Sara");
    assert.throws(() => rooms.complete(room, host), /not with a student/);
  });
});

describe("presence is never enforced", () => {
  test("a TA who goes offline keeps their place and their student", () => {
    const rooms = new RoomManager();
    const { room, host } = rooms.createRoom("Sara");
    rooms.attachTA(room, host, "socket-1");
    const alice = rooms.joinQueue(room, "Alice", "approval");
    rooms.take(room, host, alice.id);

    rooms.detachTA(room, host, "socket-1");

    assert.equal(room.tas.has(host.id), true, "a TA is not removed for being away");
    assert.equal(host.currentStudentId, alice.id, "their student stays with them");
    assert.equal(alice.status, "assigned");
    assert.equal(roomState(room).tas[0]?.connected, false, "but the board shows them away");
  });

  test("a waiting student who closes their phone keeps their number", () => {
    const rooms = new RoomManager();
    const { room } = rooms.createRoom("Host");
    const alice = rooms.joinQueue(room, "Alice", "approval");
    rooms.attachStudent(room, alice, "socket-a");

    rooms.detachStudent(room, alice, "socket-a");

    assert.equal(room.students.has(alice.id), true);
    assert.equal(alice.expiryTimer, null, "no countdown is started");
    assert.deepEqual(tickets(room, "approval"), [1]);
    assert.equal(roomState(room).approval[0]?.connected, false);
  });

  test("a second tab closing does not make an active TA look away", () => {
    const rooms = new RoomManager();
    const { room, host } = rooms.createRoom("Sara");
    rooms.attachTA(room, host, "laptop");
    const alice = rooms.joinQueue(room, "Alice", "approval");
    rooms.take(room, host, alice.id);

    // A second tab in the same browser resumes the same TA, then is closed.
    rooms.attachTA(room, host, "stray-tab");
    rooms.detachTA(room, host, "stray-tab");

    assert.equal(roomState(room).tas[0]?.connected, true, "the laptop is still open");
    assert.equal(host.currentStudentId, alice.id, "and nobody may hand their student back");

    rooms.detachTA(room, host, "laptop");
    assert.equal(roomState(room).tas[0]?.connected, false, "away only once every tab is gone");
  });

  test("reopening the page puts them back online without changing their place", () => {
    const rooms = new RoomManager();
    const { room } = rooms.createRoom("Host");
    const alice = rooms.joinQueue(room, "Alice", "approval");
    rooms.attachStudent(room, alice, "socket-a");
    rooms.detachStudent(room, alice, "socket-a");

    rooms.attachStudent(room, alice, "socket-b");

    assert.deepEqual([...alice.sockets], ["socket-b"]);
    assert.equal(alice.ticket, 1);
  });
});

describe("removing a student", () => {
  test("a called student who never came is dropped without counting a session", () => {
    const rooms = new RoomManager();
    const { room, host } = rooms.createRoom("Sara");
    const alice = rooms.joinQueue(room, "Alice", "approval");
    rooms.take(room, host, alice.id);

    rooms.removeStudent(room, alice.id);

    assert.equal(alice.status, "removed");
    assert.equal(host.currentStudentId, null, "the TA is free again");
    assert.deepEqual([room.approvedCount, room.helpedCount], [0, 0]);
    assert.deepEqual(tickets(room, "approval"), [], "and they are off the board");
  });

  test("a removed number is not handed out again", () => {
    const rooms = new RoomManager();
    const { room, host } = rooms.createRoom("Sara");
    const alice = rooms.joinQueue(room, "Alice", "approval");
    rooms.take(room, host, alice.id);
    rooms.removeStudent(room, alice.id);

    assert.equal(rooms.joinQueue(room, "Bob", "approval").ticket, 2);
  });

  test("any TA can hand back a student whose own TA went away", () => {
    const rooms = new RoomManager();
    const { room, host } = rooms.createRoom("Sara");
    const jonas = rooms.joinTA(room, room.taCode, "Jonas");
    const alice = rooms.joinQueue(room, "Alice", "approval");
    rooms.take(room, jonas, alice.id);
    rooms.detachTA(room, jonas, "socket-j");

    rooms.requeue(room, alice.id);

    assert.equal(alice.status, "waiting");
    assert.equal(alice.taId, null);
    assert.equal(jonas.currentStudentId, null);
    // Their original number still sorts them to the front.
    assert.deepEqual(tickets(room, "approval"), [1]);
    assert.equal(host.currentStudentId, null);
  });

  test("handing back somebody who is not with a TA fails", () => {
    const rooms = new RoomManager();
    const { room } = rooms.createRoom("Sara");
    const alice = rooms.joinQueue(room, "Alice", "approval");

    assert.throws(() => rooms.requeue(room, alice.id), /not with a TA/);
    assert.throws(() => rooms.removeStudent(room, "nobody"), /no longer in this room/);
  });
});

describe("room lifecycle", () => {
  test("closing deletes the room and its code", () => {
    const rooms = new RoomManager();
    const { room } = rooms.createRoom("Host");
    const code = room.studentCode;

    rooms.closeRoom(room, "done");

    assert.equal(rooms.size, 0);
    assert.throws(() => rooms.getByStudentCode(code), RoomError);
  });

  test("the sweeper clears rooms that are unattended and empty", () => {
    const rooms = new RoomManager();
    const { room } = rooms.createRoom("Host");
    room.emptySince = Date.now() - config.emptyRoomTtlMs - 1;

    rooms.sweep();

    assert.equal(rooms.size, 0);
  });

  test("a room with people still queued is never swept as empty", () => {
    const rooms = new RoomManager();
    const { room, host } = rooms.createRoom("Host");
    rooms.attachTA(room, host, "socket-1");
    const alice = rooms.joinQueue(room, "Alice", "approval");
    rooms.attachStudent(room, alice, "socket-a");

    // Everyone puts their laptop to sleep and their phone away.
    rooms.detachTA(room, host, "socket-1");
    rooms.detachStudent(room, alice, "socket-a");

    assert.equal(room.emptySince, null, "a queued student keeps the room alive");
    rooms.sweep(Date.now() + config.emptyRoomTtlMs + 1);
    assert.equal(rooms.size, 1);
  });

  test("the sweeper enforces a maximum room lifetime", () => {
    const rooms = new RoomManager();
    const { room, host } = rooms.createRoom("Host");
    rooms.attachTA(room, host, "socket-1");
    room.createdAt = Date.now() - config.maxRoomLifetimeMs - 1;

    rooms.sweep();

    assert.equal(rooms.size, 0);
  });
});

describe("names", () => {
  test("whitespace is collapsed and length is capped", () => {
    assert.equal(cleanName("  John   Smith  "), "John Smith");
    assert.equal(cleanName("x".repeat(200)).length, config.maxNameLength);
  });

  test("an empty name is rejected", () => {
    assert.throws(() => cleanName("   "), RoomError);
    assert.throws(() => cleanName(42), RoomError);
  });
});

describe("state visibility", () => {
  test("the broadcast state never carries the TA code", () => {
    const rooms = new RoomManager();
    const { room } = rooms.createRoom("Host");
    const payload = JSON.stringify(roomState(room));

    assert.equal(payload.includes(room.taCode), false);
  });
});
