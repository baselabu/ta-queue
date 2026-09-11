import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { CreateRoomResult } from "@shared/types";
import { call, message, resetSocket } from "../lib/socket";
import { lastName, taSession } from "../lib/session";
import { Button, ErrorNote, Field, Screen } from "../components/ui";

export default function Landing() {
  const navigate = useNavigate();
  const [name, setName] = useState(lastName.get());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createRoom(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await resetSocket();
      const room = await call<CreateRoomResult>("room:create", { taName: name });
      lastName.set(name.trim());
      taSession.set({ studentCode: room.studentCode, taId: room.taId, name: name.trim(), isHost: true });
      navigate(`/room/${room.studentCode}`);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  const digits = code.replace(/\D/g, "").slice(0, 6);

  return (
    <Screen>
      <div className="flex-1 flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-xl">
          <header className="mb-8">
            <h1 className="text-[clamp(3rem,12vw,5.5rem)] leading-[0.85] font-black tracking-[-0.04em]">
              TA Queue
            </h1>
            <p className="mt-4 text-lg text-muted max-w-md">
              Organize assignment approvals and student help sessions.
            </p>
          </header>

          {/* One ticket, torn in two: run a room above, join one below. */}
          <div className="rounded-2xl bg-paper border border-line overflow-hidden">
            <form onSubmit={createRoom} className="p-6 sm:p-8 flex flex-col gap-4">
              <Field
                label="Your name"
                name="host-name"
                value={name}
                autoComplete="name"
                maxLength={32}
                placeholder="Sara"
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit" size="lg" disabled={busy || !name.trim()}>
                {busy ? "Creating room…" : "Create room"}
              </Button>
            </form>

            <div className="relative h-0 border-t-2 border-dashed border-line">
              <span className="absolute -top-3 -left-3 block h-6 w-6 rounded-full bg-wash" />
              <span className="absolute -top-3 -right-3 block h-6 w-6 rounded-full bg-wash" />
            </div>

            <div className="p-6 sm:p-8 flex flex-col gap-4">
              <Field
                label="Room code"
                name="room-code"
                value={digits}
                inputMode="numeric"
                autoComplete="off"
                placeholder="482731"
                className="num text-3xl tracking-[0.3em] font-bold"
                onChange={(e) => setCode(e.target.value)}
              />
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={digits.length !== 6}
                  onClick={() => navigate(`/join/${digits}`)}
                >
                  Join the queue
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={digits.length !== 6}
                  onClick={() => navigate(`/room/${digits}`)}
                >
                  Join as a TA
                </Button>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-6">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}

          <p className="mt-8 text-sm text-muted">
            Rooms live in memory for as long as the session runs. Nothing is stored afterwards.
          </p>
        </div>
      </div>
    </Screen>
  );
}
