import { useMemo, useState } from "react";
import type { Exercise, PersonalRecord, PRKind, Units } from "../types";
import { useApp } from "../lib/app-context";
import { addManualPR, deletePR, uid } from "../lib/store";
import { prKindLabel, prKindsFor } from "../lib/prs";
import { Field, Sheet } from "../components/ui";
import { IconPlus, IconTrash, IconTrophy } from "../components/icons";
import {
  displayToKg,
  displayToMeters,
  distanceLabel,
  formatDate,
  formatSeconds,
  kgToDisplay,
  metersToDisplay,
  parseTime,
  roundW,
  weightLabel,
} from "../lib/units";

function formatPR(pr: PersonalRecord, units: Units): string {
  switch (pr.kind) {
    case "1rm":
    case "weight":
      return `${roundW(kgToDisplay(pr.value, units))} ${weightLabel(units)}${
        pr.reps ? ` × ${pr.reps}` : ""
      }`;
    case "reps":
      return `${pr.value} reps`;
    case "time":
      return formatSeconds(pr.value);
    case "distance":
      return `${roundW(metersToDisplay(pr.value, units))} ${distanceLabel(units)}`;
  }
}

export default function Records() {
  const { data } = useApp();
  const [adding, setAdding] = useState(false);

  const grouped = useMemo(() => {
    const exById = new Map(data.exercises.map((e) => [e.id, e]));
    const byExercise = new Map<string, PersonalRecord[]>();
    for (const pr of data.prs) {
      if (!exById.has(pr.exerciseId)) continue;
      const arr = byExercise.get(pr.exerciseId) ?? [];
      arr.push(pr);
      byExercise.set(pr.exerciseId, arr);
    }
    return [...byExercise.entries()]
      .map(([exId, prs]) => ({
        exercise: exById.get(exId)!,
        prs: prs.sort((a, b) => a.kind.localeCompare(b.kind)),
      }))
      .sort((a, b) => a.exercise.name.localeCompare(b.exercise.name));
  }, [data.prs, data.exercises]);

  return (
    <div className="screen">
      <div className="eyebrow">Records</div>
      <h2 className="screen-title">Personal records</h2>

      <button className="btn primary" onClick={() => setAdding(true)}>
        <IconPlus /> Log a PR manually
      </button>

      <div className="section-label">
        {data.prs.length} record{data.prs.length === 1 ? "" : "s"}
      </div>

      {grouped.length === 0 ? (
        <div className="empty">
          <IconTrophy />
          <div style={{ fontWeight: 700, color: "var(--text)" }}>
            No records yet
          </div>
          <div style={{ marginTop: 4 }}>
            Finish a session or log a PR — bests are detected automatically.
          </div>
        </div>
      ) : (
        grouped.map(({ exercise, prs }) => (
          <PRGroup key={exercise.id} exercise={exercise} prs={prs} />
        ))
      )}

      {adding && <AddPRSheet onClose={() => setAdding(false)} />}
    </div>
  );
}

function PRGroup({
  exercise,
  prs,
}: {
  exercise: Exercise;
  prs: PersonalRecord[];
}) {
  const { data, update } = useApp();
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="row">
        <h3 style={{ fontSize: 17 }}>{exercise.name}</h3>
      </div>
      <div style={{ marginTop: 8 }}>
        {prs.map((pr) => (
          <div key={pr.id} className="row" style={{ padding: "8px 0" }}>
            <div>
              <div style={{ fontWeight: 700, color: "var(--gold)" }}>
                {formatPR(pr, data.units)}
              </div>
              <div className="faint" style={{ fontSize: 12 }}>
                {prKindLabel(pr.kind)} · {formatDate(pr.date)}
                {pr.manual ? " · manual" : ""}
              </div>
            </div>
            {pr.manual && (
              <button
                className="check"
                aria-label="Delete PR"
                onClick={() => update((d) => deletePR(d, pr.id))}
              >
                <IconTrash />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AddPRSheet({ onClose }: { onClose: () => void }) {
  const { data, update } = useApp();
  const [exerciseId, setExerciseId] = useState<string>(
    data.exercises[0]?.id ?? "",
  );
  const exercise = data.exercises.find((e) => e.id === exerciseId);
  const kinds = exercise ? prKindsFor(exercise) : [];
  const [kind, setKind] = useState<PRKind>(kinds[0] ?? "1rm");
  const [value, setValue] = useState("");
  const [reps, setReps] = useState("");

  const onExerciseChange = (id: string) => {
    setExerciseId(id);
    const ex = data.exercises.find((e) => e.id === id);
    const k = ex ? prKindsFor(ex) : [];
    setKind(k[0] ?? "1rm");
  };

  const submit = () => {
    if (!exercise) return;
    let canonical: number | undefined;
    if (kind === "1rm" || kind === "weight") {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return;
      canonical = displayToKg(n, data.units);
    } else if (kind === "reps") {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return;
      canonical = n;
    } else if (kind === "time") {
      canonical = parseTime(value);
    } else if (kind === "distance") {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return;
      canonical = displayToMeters(n, data.units);
    }
    if (canonical == null || canonical <= 0) return;

    const pr: PersonalRecord = {
      id: uid("pr"),
      exerciseId: exercise.id,
      kind,
      value: canonical,
      reps: reps ? Number(reps) : undefined,
      date: new Date().toISOString(),
      manual: true,
    };
    update((d) => addManualPR(d, pr));
    onClose();
  };

  const valuePlaceholder =
    kind === "time"
      ? "mm:ss"
      : kind === "distance"
        ? distanceLabel(data.units)
        : kind === "reps"
          ? "reps"
          : weightLabel(data.units);

  return (
    <Sheet title="Log a PR" onClose={onClose}>
      <Field label="Exercise">
        <select
          value={exerciseId}
          onChange={(e) => onExerciseChange(e.target.value)}
        >
          {[...data.exercises]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
      </Field>

      {kinds.length > 1 && (
        <Field label="Record type">
          <select value={kind} onChange={(e) => setKind(e.target.value as PRKind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {prKindLabel(k)}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label={`Value (${valuePlaceholder})`}>
        <input
          autoFocus
          inputMode={kind === "time" ? "text" : "decimal"}
          value={value}
          placeholder={valuePlaceholder}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>

      {(kind === "1rm" || kind === "weight") && (
        <Field label="Reps (optional context)">
          <input
            inputMode="numeric"
            value={reps}
            placeholder="e.g. 5"
            onChange={(e) => setReps(e.target.value)}
          />
        </Field>
      )}

      <button className="btn primary" style={{ marginTop: 8 }} onClick={submit}>
        Save record
      </button>
    </Sheet>
  );
}
