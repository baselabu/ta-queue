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
    assert.deepEqual(roomState(room).tas[0]?.current, { name: "Alice", ticket: 1, queue: "approval" });
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

describe("disconnects", () => {
  test("a TA dropping out returns their student to the queue", () => {
    assert.equal(config.onTADisconnect, "requeue", "test assumes the default policy");

    const rooms = new RoomManager();
    const { room, host } = rooms.createRoom("Sara");
    rooms.attachTA(room, host, "socket-1");
    const alice = rooms.joinQueue(room, "Alice", "approval");
    rooms.take(room, host, alice.id);

    rooms.detachTA(room, host);

    assert.equal(alice.status, "waiting");
    assert.equal(alice.taId, null);
    assert.equal(host.currentStudentId, null);
    // Their original number still sorts them to the front.
    assert.deepEqual(tickets(room, "approval"), [1]);
  });

  test("a student keeps their place until the grace period expires", () => {
    const rooms = new RoomManager();
    const { room } = rooms.createRoom("Host");
    const alice = rooms.joinQueue(room, "Alice", "approval");
    rooms.attachStudent(room, alice, "socket-a");

    rooms.detachStudent(room, alice);

    assert.equal(room.students.has(alice.id), true);
    assert.notEqual(alice.graceTimer, null);
    rooms.removeStudent(room, alice); // stop the timer so the test process can exit
  });

  test("reconnecting cancels the grace timer", () => {
    const rooms = new RoomManager();
    const { room } = rooms.createRoom("Host");
    const alice = rooms.joinQueue(room, "Alice", "approval");
    rooms.attachStudent(room, alice, "socket-a");
    rooms.detachStudent(room, alice);

    rooms.attachStudent(room, alice, "socket-b");

    assert.equal(alice.graceTimer, null);
    assert.equal(alice.socketId, "socket-b");
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

  test("the sweeper clears rooms nobody has been connected to", () => {
    const rooms = new RoomManager();
    const { room } = rooms.createRoom("Host");
    room.emptySince = Date.now() - config.emptyRoomTtlMs - 1;

    rooms.sweep();

    assert.equal(rooms.size, 0);
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
