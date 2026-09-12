import type { TAView } from "@shared/types";
import { Button } from "./ui";

export function TAPanel({
  tas,
  myTaId,
  onComplete,
  onRemove,
  onRequeue,
  isHost,
  onKick,
}: {
  tas: TAView[];
  myTaId: string;
  onComplete: () => void;
  onRemove: (studentId: string) => void;
  onRequeue: (studentId: string) => void;
  isHost: boolean;
  onKick: (taId: string) => void;
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
                {!ta.connected && <span className="text-sm font-semibold text-muted">away</span>}
                {isHost && !mine && (
                  <button
                    type="button"
                    onClick={() => onKick(ta.id)}
                    aria-label={`Remove ${ta.name} from the room`}
                    className="ml-auto shrink-0 text-sm font-semibold text-muted hover:text-help
                      underline underline-offset-4"
                  >
                    Remove TA
                  </button>
                )}
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

                  {mine ? (
                    <div className="mt-4 flex flex-col gap-2">
                      <Button className="w-full" onClick={onComplete}>
                        Complete
                      </Button>
                      {/* Called their name, nobody came. Takes them out, counting nothing. */}
                      <Button variant="secondary" className="w-full" onClick={() => onRemove(ta.current!.id)}>
                        Remove
                      </Button>
                    </div>
                  ) : (
                    /* Their TA walked off holding them: any TA can put them back in line. */
                    !ta.connected && (
                      <Button
                        variant="secondary"
                        className="mt-4 w-full"
                        onClick={() => onRequeue(ta.current!.id)}
                      >
                        Return to queue
                      </Button>
                    )
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
