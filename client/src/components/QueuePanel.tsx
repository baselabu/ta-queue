import type { QueueType, StudentView } from "@shared/types";

const STYLES: Record<QueueType, { rail: string; block: string; heading: string }> = {
  approval: { rail: "border-t-approval", block: "bg-approval text-paper", heading: "text-approval" },
  help: { rail: "border-t-help", block: "bg-help text-paper", heading: "text-help" },
};

export function QueuePanel({
  queue,
  title,
  students,
  canTake,
  onTake,
}: {
  queue: QueueType;
  title: string;
  students: StudentView[];
  canTake: boolean;
  onTake: (studentId: string) => void;
}) {
  const style = STYLES[queue];

  return (
    <section className={`rounded-2xl bg-paper border border-line border-t-4 ${style.rail} overflow-hidden`}>
      <div className="flex items-baseline justify-between px-5 sm:px-6 py-4 border-b border-line">
        <h2 className={`text-2xl sm:text-3xl font-black tracking-tight ${style.heading}`}>{title}</h2>
        <span className="num text-2xl font-bold text-muted">{students.length}</span>
      </div>

      {students.length === 0 ? (
        <p className="px-6 py-10 text-center text-muted text-lg">Nobody waiting.</p>
      ) : (
        <ul className="divide-y divide-line">
          {students.map((student) => (
            <li key={student.id}>
              <button
                onClick={() => onTake(student.id)}
                disabled={!canTake}
                aria-label={`Take number ${student.ticket}, ${student.name}`}
                className="group w-full flex items-stretch text-left transition-colors
                  enabled:hover:bg-wash disabled:cursor-default"
              >
                <span
                  className={`num ${style.block} grid place-items-center min-w-[5.5rem] sm:min-w-[7rem]
                    px-4 py-5 text-4xl sm:text-5xl font-black tracking-[-0.03em]`}
                >
                  {student.ticket}
                </span>
                <span className={`stub-edge ${style.heading}`} />
                <span className="flex-1 flex items-center justify-between gap-4 px-5">
                  <span className="text-2xl sm:text-3xl font-semibold truncate">{student.name}</span>
                  {!student.connected && (
                    <span className="text-sm font-semibold text-muted shrink-0">Offline</span>
                  )}
                  {canTake && (
                    <span className="hidden sm:block text-base font-bold text-muted opacity-0 group-hover:opacity-100 shrink-0">
                      Take
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
