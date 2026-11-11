import { useMemo, useState } from "react";
import type { Exercise, Session, WorkoutSet } from "../types";
import { useApp } from "../lib/app-context";
import { seedTemplates } from "../lib/seed";
import { deleteSession } from "../lib/store";
import { formatPR, prKindLabel } from "../lib/prs";
import { formatDate, formatSeconds, kmFromMeters, roundW } from "../lib/units";
import { ConfirmSheet, Sheet } from "./ui";
import { HeartRateCard } from "./HeartRate";
import { IconTrash, IconTrophy } from "./icons";

/** Wall-clock length of a finished session, or undefined if it never finished. */
export function sessionSeconds(s: Session): number | undefined {
  if (!s.finishedAt) return undefined;
  const ms = new Date(s.finishedAt).getTime() - new Date(s.date).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms / 1000 : undefined;
}

/** "Tue 11 Nov 2026, 18:42" */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} ${formatDate(iso)}, ${time}`;
}

/** One logged set in its own units, whatever the exercise measures. */
export function formatSet(set: WorkoutSet, ex: Exercise | undefined): string {
  const parts: string[] = [];
  if (set.weight != null) parts.push(`${roundW(set.weight)} kg`);
  if (set.reps != null) parts.push(set.weight != null ? `× ${set.reps}` : `${set.reps} reps`);
  if (set.meters != null) parts.push(`${kmFromMeters(set.meters)} km`);
  if (set.seconds != null) {
    const t = formatSeconds(set.seconds);
    parts.push(set.meters != null || set.reps != null ? `in ${t}` : t);
  }
  if (set.rpe != null) parts.push(`@ RPE ${set.rpe}`);
  if (parts.length === 0) return ex?.metric === "weight_reps" ? "bodyweight" : "done";
  return parts.join(" ");
}

/**
 * Everything a logged session holds: when, how long, the summary the
 * player wrote, every exercise with every set, and the records it set.
 */
export function SessionDetails({ session, onClose }: { session: Session; onClose: () => void }) {
  const { data, update } = useApp();
  const [deleting, setDeleting] = useState(false);

  const exById = useMemo(() => new Map(data.exercises.map((e) => [e.id, e])), [data.exercises]);
  const template = useMemo(
    () => (session.templateId ? seedTemplates().find((t) => t.id === session.templateId) : undefined),
    [session.templateId],
  );
  const prs = useMemo(
    () => data.prs.filter((p) => p.sessionId === session.id),
    [data.prs, session.id],
  );

  const seconds = sessionSeconds(session);
  const noteParts = session.note ? session.note.split(" · ").filter(Boolean) : [];

  return (
    <>
      <Sheet title={session.name} onClose={onClose}>
        <span className="row" style={{ gap: 6, justifyContent: "flex-start", flexWrap: "wrap" }}>
          {template && <span className="chip gold">{template.branch}</span>}
          {seconds != null && <span className="chip">{formatSeconds(seconds)}</span>}
          {!session.finishedAt && <span className="chip accent">In progress</span>}
        </span>
        <p className="muted" style={{ marginBottom: 0 }}>{formatWhen(session.date)}</p>

        {noteParts.length > 0 && (
          <div className="card" style={{ marginTop: 12 }}>
            {noteParts.length === 1 ? (
              <p style={{ margin: 0 }}>{noteParts[0]}</p>
            ) : (
              <>
                <p style={{ margin: 0, fontWeight: 700 }}>{noteParts[0]}</p>
                <ul className="muted" style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 14 }}>
                  {noteParts.slice(1).map((part, i) => <li key={i}>{part}</li>)}
                </ul>
              </>
            )}
          </div>
        )}

        {session.heartRate && <HeartRateCard hr={session.heartRate} />}

        {prs.length > 0 && (
          <>
            <div className="section-label">Records set</div>
            {prs.map((pr) => (
              <div key={pr.id} className="list-item">
                <div>
                  <div className="title">{exById.get(pr.exerciseId)?.name ?? "Unknown exercise"}</div>
                  <div className="sub">{prKindLabel(pr.kind)}</div>
                </div>
                <span className="chip gold" style={{ flexShrink: 0 }}>
                  <IconTrophy style={{ width: 14, height: 14 }} />
                  {formatPR(pr)}
                </span>
              </div>
            ))}
          </>
        )}

        <div className="section-label">
          {session.entries.length} exercise{session.entries.length === 1 ? "" : "s"}
        </div>
        {session.entries.length === 0 ? (
          <div className="card muted">Nothing was logged.</div>
        ) : (
          session.entries.map((entry) => {
            const ex = exById.get(entry.exerciseId);
            return (
              <div key={entry.id} className="card" style={{ marginBottom: 8 }}>
                <div className="title" style={{ fontWeight: 700 }}>{ex?.name ?? "Unknown exercise"}</div>
                <ol style={{ margin: "6px 0 0", paddingLeft: 22, fontSize: 14 }}>
                  {entry.sets.map((set) => (
                    <li key={set.id}>{formatSet(set, ex)}</li>
                  ))}
                </ol>
                {entry.note && <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>{entry.note}</p>}
              </div>
            );
          })
        )}

        {session.finishedAt && (
          <button
            className="btn ghost"
            style={{ marginTop: 16 }}
            onClick={() => { setDeleting(true); }}
          >
            <IconTrash /> Delete session
          </button>
        )}
      </Sheet>
      {deleting && (
        <ConfirmSheet
          title="Delete session?"
          message={`${session.name}, ${formatWhen(session.date)}. Records it set are recalculated from what remains.`}
          confirmLabel="Delete"
          onConfirm={() => {
            update((d) => deleteSession(d, session.id));
            onClose();
          }}
          onClose={() => { setDeleting(false); }}
        />
      )}
    </>
  );
}
