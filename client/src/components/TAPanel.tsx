import type { TAView } from "@shared/types";
import { Button } from "./ui";

export function TAPanel({
  tas,
  myTaId,
  onComplete,
}: {
  tas: TAView[];
  myTaId: string;
  onComplete: () => void;
}) {
  return (
    <section className="rounded-2xl bg-paper border border-line overflow-hidden">
      <div className="flex items-baseline justify-between px-5 sm:px-6 py-4 border-b border-line">
        <h2 className="text-2xl font-black tracking-tight">TAs</h2>
        <span className="num text-lg font-bold text-muted">
          {tas.filter((t) => !t.current).length} free
        </span>
      </div>

      <ul className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">
        {tas.map((ta) => {
          const mine = ta.id === myTaId;
          const queueColor = ta.current?.queue === "approval" ? "text-approval" : "text-help";
          return (
            <li key={ta.id} className={`bg-paper p-5 ${mine ? "ring-2 ring-inset ring-ink" : ""}`}>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold truncate">{ta.name}</span>
                {mine && <span className="text-sm font-semibold text-muted">you</span>}
                {!ta.connected && <span className="text-sm font-semibold text-muted">offline</span>}
              </div>

              {ta.current ? (
                <>
                  <div className="mt-2 flex items-baseline gap-3">
                    <span className={`num text-4xl font-black ${queueColor}`}>#{ta.current.ticket}</span>
                    <span className="text-xl font-semibold truncate">{ta.current.name}</span>
                  </div>
                  <p className={`text-base font-bold ${queueColor}`}>
                    {ta.current.queue === "approval" ? "Approval" : "Help"}
                  </p>
                  {mine && (
                    <Button className="mt-4 w-full" onClick={onComplete}>
                      Complete
                    </Button>
                  )}
                </>
              ) : (
                <p className="mt-2 flex items-center gap-2 text-lg font-bold text-free">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-free" aria-hidden="true" />
                  Available
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
