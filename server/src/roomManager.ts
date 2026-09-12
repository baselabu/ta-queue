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
 * Presence is recorded but never acted on. A lab session runs for hours, so a closed phone
 * or a sleeping laptop is the normal state, not a reason to remove anyone. People leave the
 * room only when they say so, when a TA removes them, or when the room closes.
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
  /** Only set once they are finished or removed, to drop the record a while later. */
  expiryTimer: NodeJS.Timeout | null;
}

export interface TA {
  id: string;
  name: string;
  isHost: boolean;
  socketId: string | null;
  currentStudentId: string | null;
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
  /** Timestamp since which the room has been both unattended and empty; null otherwise. */
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

    const host: TA = { id: nanoid(), name, isHost: true, socketId: null, currentStudentId: null };
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
    for (const s of room.students.values()) if (s.expiryTimer) clearTimeout(s.expiryTimer);
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
    };
    room.tas.set(ta.id, ta);
    return ta;
  }

  /** Reattach a TA to a new socket after a refresh, a reconnect or a laptop waking up. */
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

    this.expireLater(room, student);
    return student;
  }

  /**
   * Take a student out of the room without counting a session - their name was called and
   * nobody came. Any TA may do this, including for a student held by a TA who is offline.
   */
  removeStudent(room: Room, studentId: unknown): Student {
    const student = this.findStudent(room, studentId);
    this.detachFromTA(room, student);

    student.status = "removed";
    student.taId = null;
    this.expireLater(room, student);
    return student;
  }

  /**
   * Put a taken student back in line, keeping their original ticket number - which sorts
   * them to the front. Used when a TA has to hand a student back, or when their TA has
   * gone offline holding them.
   */
  requeue(room: Room, studentId: unknown): Student {
    const student = this.findStudent(room, studentId);
    if (student.status !== "assigned") throw new RoomError("That student is not with a TA.");
    this.detachFromTA(room, student);

    if (student.expiryTimer) {
      clearTimeout(student.expiryTimer);
      student.expiryTimer = null;
    }
    student.status = "waiting";
    student.taId = null;
    return student;
  }

  private findStudent(room: Room, studentId: unknown): Student {
    const student = typeof studentId === "string" ? room.students.get(studentId) : undefined;
    if (!student) throw new RoomError("That student is no longer in this room.");
    return student;
  }

  /** Free whichever TA is holding this student, if any. */
  private detachFromTA(room: Room, student: Student): void {
    const ta = student.taId ? room.tas.get(student.taId) : undefined;
    if (ta && ta.currentStudentId === student.id) ta.currentStudentId = null;
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
      expiryTimer: null,
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
    this.detachFromTA(room, student);
    this.dropStudent(room, student);
  }

  /** Delete the record outright, with no trace left for the student to read. */
  private dropStudent(room: Room, student: Student): void {
    if (student.expiryTimer) clearTimeout(student.expiryTimer);
    room.students.delete(student.id);
  }

  /** Keep a finished record around briefly so the student's own screen can show the result. */
  private expireLater(room: Room, student: Student): void {
    if (student.expiryTimer) clearTimeout(student.expiryTimer);
    student.expiryTimer = setTimeout(() => {
      if (this.rooms.has(room.id) && room.students.get(student.id) === student) {
        room.students.delete(student.id);
        this.onChange(room);
      }
    }, config.resultLingerMs);
    student.expiryTimer.unref?.();
  }

  // ------------------------------------------------------------- connections

  attachStudent(room: Room, student: Student, socketId: string): void {
    student.socketId = socketId;
    room.emptySince = null;
  }

  attachTA(room: Room, ta: TA, socketId: string): void {
    ta.socketId = socketId;
    room.emptySince = null;
  }

  /**
   * A student's socket dropped: they closed the tab or locked their phone, which is what
   * we tell them to do. Their place is theirs until they leave or a TA calls them.
   */
  detachStudent(room: Room, student: Student): void {
    student.socketId = null;
    this.markEmptyIfDeserted(room);
  }

  /**
   * A TA's socket dropped: another tab, a sleeping laptop, wifi. They keep their place on
   * the board and keep the student they are with; only the presence dot changes.
   */
  detachTA(room: Room, ta: TA): void {
    ta.socketId = null;
    this.markEmptyIfDeserted(room);
  }

  /** A room counts as deserted only when nobody is connected AND nobody is queued. */
  private markEmptyIfDeserted(room: Room): void {
    const connected =
      [...room.tas.values()].some((t) => t.socketId) || [...room.students.values()].some((s) => s.socketId);
    room.emptySince = connected || room.students.size > 0 ? null : Date.now();
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
