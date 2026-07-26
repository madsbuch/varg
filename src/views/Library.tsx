import { useMemo, useState } from "react";
import type { Category, Exercise } from "../types";
import { useApp } from "../lib/app-context";
import { libraryFor } from "../lib/library";
import { collapsePRs, prKindLabel } from "../lib/prs";
import ExerciseAnim from "../components/ExerciseAnim";
import { Sheet } from "../components/ui";
import { formatSeconds, kmFromMeters, roundW } from "../lib/units";

const CATEGORIES: (Category | "all")[] = [
  "all",
  "strength",
  "bodyweight",
  "core",
  "conditioning",
  "cardio",
  "ruck",
];

const METRIC_LABEL: Record<Exercise["metric"], string> = {
  weight_reps: "kg × reps",
  reps: "reps",
  time: "time",
  distance_time: "km + time",
};

export default function Library() {
  const { data } = useApp();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "all">("all");
  const [open, setOpen] = useState<Exercise | null>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.exercises
      // See ExercisePicker: superseded built-ins are data, not choices.
      .filter((e) => !e.deprecated)
      .filter((e) => cat === "all" || e.category === cat)
      .filter(
        (e) =>
          !term ||
          e.name.toLowerCase().includes(term) ||
          e.muscles.some((m) => m.toLowerCase().includes(term)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data.exercises, q, cat]);

  return (
    <div className="screen">
      <div className="eyebrow">Field manual</div>
      <h2 className="screen-title">Exercise library</h2>

      <input
        placeholder="Search exercises or muscles…"
        value={q}
        onChange={(e) => { setQ(e.target.value); }}
      />

      <div className="scroll-x" style={{ marginTop: 10 }}>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className={`chip ${cat === c ? "accent" : ""}`}
            onClick={() => { setCat(c); }}
          >
            {c}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        {filtered.map((ex) => (
          <button key={ex.id} className="list-item" onClick={() => { setOpen(ex); }}>
            <div className="row" style={{ justifyContent: "flex-start", gap: 14 }}>
              <div className="anim-thumb">
                <ExerciseAnim anim={libraryFor(ex).anim} size={62} />
              </div>
              <div>
                <div className="title">{ex.name}</div>
                <div className="sub">
                  {ex.category}
                  {ex.muscles.length > 0 && ` · ${ex.muscles.join(", ")}`}
                </div>
              </div>
            </div>
          </button>
        ))}
        {filtered.length === 0 && <div className="empty">No matches.</div>}
      </div>

      {open && <ExerciseSheet exercise={open} onClose={() => { setOpen(null); }} />}
    </div>
  );
}

function ExerciseSheet({
  exercise,
  onClose,
}: {
  exercise: Exercise;
  onClose: () => void;
}) {
  const { data } = useApp();
  const lib = libraryFor(exercise);
  // Collapsed to the record that stands per kind — one row per stored PR
  // showed a superseded manual entry as a second, contradictory number.
  const rows = collapsePRs(data.prs).filter((r) => r.exerciseId === exercise.id);

  const prText = (kind: string, value: number, reps?: number): string => {
    switch (kind) {
      case "1rm":
      case "weight":
        return `${roundW(value)} kg${reps ? ` × ${reps}` : ""}`;
      case "reps":
        return `${value} reps`;
      case "time":
        return formatSeconds(value);
      case "distance":
        return `${kmFromMeters(value)} km`;
      default:
        return String(value);
    }
  };

  return (
    <Sheet title={exercise.name} onClose={onClose}>
      <div className="anim-stage">
        <ExerciseAnim anim={lib.anim} size={170} />
      </div>

      <div className="row" style={{ justifyContent: "flex-start", gap: 6, flexWrap: "wrap" }}>
        <span className="chip accent">{exercise.category}</span>
        <span className="chip">{METRIC_LABEL[exercise.metric]}</span>
        {exercise.muscles.map((m) => (
          <span key={m} className="chip">
            {m}
          </span>
        ))}
      </div>

      <div className="section-label">Execution</div>
      <ol className="cues">
        {lib.cues.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ol>

      {rows.length > 0 && (
        <>
          <div className="section-label">Your records</div>
          {rows.map(({ kind, best, superseded }) => (
            <div key={`${best.exerciseId}:${kind}`}>
              <div className="row" style={{ padding: "4px 0" }}>
                <span className="muted">{prKindLabel(kind)}</span>
                <span style={{ fontWeight: 700, color: "var(--gold)" }}>
                  {prText(kind, best.value, best.reps)}
                </span>
              </div>
              {/* A manual entry the logged sets beat — kept visible so the
                  athlete can act on it. Deleting is done on Records. */}
              {superseded.map((pr) => (
                <div key={pr.id} className="row" style={{ padding: "0 0 4px 10px" }}>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {prText(pr.kind, pr.value, pr.reps)} · manual · superseded
                  </span>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </Sheet>
  );
}
