import { nanoid } from "nanoid";
import { config } from "./config.js";
import { uniqueCode, randomCode } from "./codes.js";
import type { QueueType, StudentStatus } from "@shared/types.js";

/**
 * All room state lives in this process's memory and is lost on restart - by design.
 *
 * Atomicity: Node runs one JavaScript task to completion before starting the next, and
 * every method here is synchronous. Two TAs clicking the same student therefore arrive as
 * two separate tasks; the first mutates `student.status` before the second is ever entered,
 * so the second sees "assigned" and is rejected. No locking needed.
 *
 * To move to Redis or a database later, keep this class's method signatures and make them
 * async - nothing outside this file reads the Maps directly.
 */

export class RoomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoomError";
  }
}

export interface Student {
  id: string;
  name: string;
  ticket: number;
  queue: QueueType;
  status: StudentStatus;
  taId: string | null;
  socketId: string | null;
  graceTimer: NodeJS.Timeout | null;
}

export interface TA {
  id: string;
  name: string;
  isHost: boolean;
  socketId: string | null;
  currentStudentId: string | null;
  graceTimer: NodeJS.Timeout | null;
}

export interface Room {
  id: string;
  studentCode: string;
  taCode: string;
  hostId: string;
  students: Map<string, Student>;
  tas: Map<string, TA>;
  nextTicketNumber: number;
  approvedCount: number;
  helpedCount: number;
  createdAt: number;
  /** Timestamp since which nobody has been connected; null while someone is. */
  emptySince: number | null;
}

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") throw new RoomError("Enter a name.");
  const name = raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, config.maxNameLength);
  if (!name) throw new RoomError("Enter a name.");
  return name;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private byStudentCode = new Map<string, Room>();
  private sweeper: NodeJS.Timeout | null = null;

  /** Called whenever a room's state changes, so the socket layer can broadcast. */
  onChange: (room: Room) => void = () => {};
  /** Called when a room is destroyed, so its sockets can be told and disconnected. */
  onClose: (room: Room, reason: string) => void = () => {};

  // --------------------------------------------------------------- lifecycle

  createRoom(hostName: string): { room: Room; host: TA } {
    if (this.rooms.size >= config.maxRoomsPerServer) {
      throw new RoomError("The server is at capacity. Try again shortly.");
    }
    const name = cleanName(hostName);
    const studentCode = uniqueCode((c) => this.byStudentCode.has(c));
    let taCode = randomCode();
    while (taCode === studentCode) taCode = randomCode();

    const host: TA = { id: nanoid(), name, isHost: true, socketId: null, currentStudentId: null, graceTimer: null };
    const room: Room = {
      id: nanoid(),
      studentCode,
      taCode,
      hostId: host.id,
      students: new Map(),
      tas: new Map([[host.id, host]]),
      nextTicketNumber: 1,
      approvedCount: 0,
      helpedCount: 0,
      createdAt: Date.now(),
      emptySince: Date.now(),
    };
    this.rooms.set(room.id, room);
    this.byStudentCode.set(studentCode, room);
    return { room, host };
  }

  getByStudentCode(code: unknown): Room {
    const room = typeof code === "string" ? this.byStudentCode.get(code.trim()) : undefined;
    if (!room) throw new RoomError("No room with that code. Check the digits and try again.");
    return room;
  }

  closeRoom(room: Room, reason: string): void {
    for (const s of room.students.values()) if (s.graceTimer) clearTimeout(s.graceTimer);
    for (const t of room.tas.values()) if (t.graceTimer) clearTimeout(t.graceTimer);
    this.rooms.delete(room.id);
    this.byStudentCode.delete(room.studentCode);
    this.onClose(room, reason);
    room.students.clear();
    room.tas.clear();
  }

  // --------------------------------------------------------------------- TAs

  joinTA(room: Room, taCode: unknown, rawName: string): TA {
    if (typeof taCode !== "string" || taCode.trim() !== room.taCode) {
      throw new RoomError("That TA code is not right.");
    }
    const ta: TA = {
      id: nanoid(),
      name: cleanName(rawName),
      isHost: false,
      socketId: null,
      currentStudentId: null,
      graceTimer: null,
    };
    room.tas.set(ta.id, ta);
    return ta;
  }

  /** Reattach a TA to a new socket after a refresh or reconnect. */
  resumeTA(room: Room, taId: unknown): TA {
    const ta = typeof taId === "string" ? room.tas.get(taId) : undefined;
    if (!ta) throw new RoomError("That session has ended. Join the room again.");
    return ta;
  }

  /** Assign a waiting student to an available TA. Rejects if either is no longer eligible. */
  take(room: Room, ta: TA, studentId: unknown): Student {
    if (ta.currentStudentId) throw new RoomError("Finish with your current student first.");
    const student = typeof studentId === "string" ? room.students.get(studentId) : undefined;
    if (!student) throw new RoomError("That student has left the queue.");
    if (student.status !== "waiting") {
      throw new RoomError(`Number ${student.ticket} was already taken by another TA.`);
    }

    student.status = "assigned";
    student.taId = ta.id;
    ta.currentStudentId = student.id;
    return student;
  }

  /** Finish with the TA's current student and bump the matching counter. */
  complete(room: Room, ta: TA): Student {
    const student = ta.currentStudentId ? room.students.get(ta.currentStudentId) : undefined;
    ta.currentStudentId = null;
    if (!student) throw new RoomError("You are not with a student right now.");

    student.status = "completed";
    if (student.queue === "approval") room.approvedCount++;
    else room.helpedCount++;

    // Keep the record briefly so the student's own screen can show the result, then drop it.
    this.scheduleRemoval(room, student, 60_000);
    return student;
  }

  // ---------------------------------------------------------------- students

  joinQueue(room: Room, rawName: string, queue: unknown): Student {
    if (queue !== "approval" && queue !== "help") throw new RoomError("Pick a queue.");
    const student: Student = {
      id: nanoid(),
      name: cleanName(rawName),
      ticket: room.nextTicketNumber++, // one counter for the whole room; never reused
      queue,
      status: "waiting",
      taId: null,
      socketId: null,
      graceTimer: null,
    };
    room.students.set(student.id, student);
    return student;
  }

  resumeStudent(room: Room, studentId: unknown): Student {
    const student = typeof studentId === "string" ? room.students.get(studentId) : undefined;
    if (!student) throw new RoomError("That ticket has expired. Join the queue again.");
    return student;
  }

  /** Student gives up their place. Their ticket number retires with them. */
  leaveQueue(room: Room, student: Student): void {
    if (student.status === "assigned") {
      const ta = student.taId ? room.tas.get(student.taId) : undefined;
      if (ta) ta.currentStudentId = null;
    }
    this.removeStudent(room, student);
  }

  removeStudent(room: Room, student: Student): void {
    if (student.graceTimer) clearTimeout(student.graceTimer);
    room.students.delete(student.id);
  }

  private scheduleRemoval(room: Room, student: Student, ms: number): void {
    if (student.graceTimer) clearTimeout(student.graceTimer);
    student.graceTimer = setTimeout(() => {
      if (this.rooms.has(room.id) && room.students.get(student.id) === student) {
        room.students.delete(student.id);
        this.onChange(room);
      }
    }, ms);
    student.graceTimer.unref?.();
  }

  // ------------------------------------------------------------- connections

  attachStudent(room: Room, student: Student, socketId: string): void {
    if (student.graceTimer) {
      clearTimeout(student.graceTimer);
      student.graceTimer = null;
    }
    student.socketId = socketId;
    room.emptySince = null;
  }

  attachTA(room: Room, ta: TA, socketId: string): void {
    if (ta.graceTimer) {
      clearTimeout(ta.graceTimer);
      ta.graceTimer = null;
    }
    ta.socketId = socketId;
    room.emptySince = null;
  }

  /**
   * A student's socket dropped. Hold their place for the grace period so a flaky
   * connection or a page refresh does not cost them their turn.
   */
  detachStudent(room: Room, student: Student): void {
    student.socketId = null;
    this.markEmptyIfDeserted(room);
    if (student.status !== "waiting") return;
    student.graceTimer = setTimeout(() => {
      if (this.rooms.has(room.id) && room.students.get(student.id) === student && !student.socketId) {
        room.students.delete(student.id);
        this.onChange(room);
      }
    }, config.studentGraceMs);
    student.graceTimer.unref?.();
  }

  /** A TA's socket dropped. Their student is released at once; the TA slot is held briefly. */
  detachTA(room: Room, ta: TA): void {
    ta.socketId = null;
    this.markEmptyIfDeserted(room);
    this.releaseStudentOf(room, ta);
    ta.graceTimer = setTimeout(() => {
      if (this.rooms.has(room.id) && room.tas.get(ta.id) === ta && !ta.socketId) {
        room.tas.delete(ta.id);
        this.onChange(room);
      }
    }, config.taGraceMs);
    ta.graceTimer.unref?.();
  }

  /** Hand a disconnected TA's student back, per `config.onTADisconnect`. */
  private releaseStudentOf(room: Room, ta: TA): void {
    const student = ta.currentStudentId ? room.students.get(ta.currentStudentId) : undefined;
    ta.currentStudentId = null;
    if (!student || student.status !== "assigned") return;

    if (config.onTADisconnect === "complete") {
      student.status = "completed";
      if (student.queue === "approval") room.approvedCount++;
      else room.helpedCount++;
      this.scheduleRemoval(room, student, 60_000);
      return;
    }
    // requeue: their original ticket number still sorts them to the front of their queue.
    student.status = "waiting";
    student.taId = null;
  }

  private markEmptyIfDeserted(room: Room): void {
    const anyone =
      [...room.tas.values()].some((t) => t.socketId) || [...room.students.values()].some((s) => s.socketId);
    room.emptySince = anyone ? null : Date.now();
  }

  // ----------------------------------------------------------------- cleanup

  startSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), config.sweepIntervalMs);
    this.sweeper.unref?.();
  }

  stopSweeper(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  sweep(now = Date.now()): void {
    for (const room of [...this.rooms.values()]) {
      if (now - room.createdAt > config.maxRoomLifetimeMs) {
        this.closeRoom(room, "This room reached its time limit.");
      } else if (room.emptySince && now - room.emptySince > config.emptyRoomTtlMs) {
        this.closeRoom(room, "This room was empty and has been cleared.");
      }
    }
  }

  get size(): number {
    return this.rooms.size;
  }
}
