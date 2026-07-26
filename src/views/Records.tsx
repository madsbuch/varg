import { useMemo, useState } from "react";
import type { Exercise, PersonalRecord, PRKind } from "../types";
import { useApp } from "../lib/app-context";
import { addManualPR, deletePR, uid } from "../lib/store";
import type { PRRow } from "../lib/prs";
import { collapsePRs, prKindLabel, prKindsFor } from "../lib/prs";
import { ConfirmSheet, Field, Sheet } from "../components/ui";
import { IconPlus, IconTrash, IconTrophy } from "../components/icons";
import {
  formatDate,
  formatSeconds,
  kmFromMeters,
  metersFromKm,
  parseDecimal,
  parseTime,
  roundW,
} from "../lib/units";

function formatPR(pr: PersonalRecord): string {
  switch (pr.kind) {
    case "1rm":
    case "weight":
      return `${roundW(pr.value)} kg${pr.reps ? ` × ${pr.reps}` : ""}`;
    case "reps":
      return `${pr.value} reps`;
    case "time":
      return formatSeconds(pr.value);
    case "distance":
      return `${kmFromMeters(pr.value)} km`;
  }
}

export default function Records() {
  const { data } = useApp();
  const [adding, setAdding] = useState(false);

  // One row per (exercise, kind) — the stored list can hold an auto record and
  // a manual one for the same lift, and showing both reads as two conflicting
  // answers to the same question.
  const grouped = useMemo(() => {
    const exById = new Map(data.exercises.map((e) => [e.id, e]));
    const byExercise = new Map<string, PRRow[]>();
    for (const row of collapsePRs(data.prs)) {
      if (!exById.has(row.exerciseId)) continue;
      const arr = byExercise.get(row.exerciseId) ?? [];
      arr.push(row);
      byExercise.set(row.exerciseId, arr);
    }
    return [...byExercise.entries()]
      .flatMap(([exId, rows]) => {
        const exercise = exById.get(exId);
        if (!exercise) return [];
        return [{ exercise, rows: rows.sort((a, b) => a.kind.localeCompare(b.kind)) }];
      })
      .sort((a, b) => a.exercise.name.localeCompare(b.exercise.name));
  }, [data.prs, data.exercises]);

  const recordCount = grouped.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="screen">
      <div className="eyebrow">Records</div>
      <h2 className="screen-title">Personal records</h2>

      <button className="btn primary" onClick={() => { setAdding(true); }}>
        <IconPlus /> Log a PR manually
      </button>

      <div className="section-label">
        {recordCount} record{recordCount === 1 ? "" : "s"}
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
        grouped.map(({ exercise, rows }) => (
          <PRGroup key={exercise.id} exercise={exercise} rows={rows} />
        ))
      )}

      {adding && <AddPRSheet onClose={() => { setAdding(false); }} />}
    </div>
  );
}

function PRGroup({
  exercise,
  rows,
}: {
  exercise: Exercise;
  rows: PRRow[];
}) {
  const { update } = useApp();
  const [deleting, setDeleting] = useState<PersonalRecord | null>(null);
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="row">
        <h3 style={{ fontSize: 17 }}>{exercise.name}</h3>
      </div>
      <div style={{ marginTop: 8 }}>
        {rows.map(({ kind, best, superseded }) => (
          <div key={`${best.exerciseId}:${kind}`}>
            <div className="row" style={{ padding: "8px 0" }}>
              <div>
                <div style={{ fontWeight: 700, color: "var(--gold)" }}>
                  {formatPR(best)}
                </div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {prKindLabel(best.kind)} · {formatDate(best.date)}
                  {best.manual ? " · manual" : ""}
                </div>
              </div>
              {best.manual && (
                <button
                  className="check"
                  aria-label="Delete PR"
                  onClick={() => { setDeleting(best); }}
                >
                  <IconTrash />
                </button>
              )}
            </div>
            {/* A manual entry the logged sets beat. Shown rather than dropped:
                it may be a deliberate correction of an inflated 1RM estimate,
                and deleting it has to be the athlete's call. */}
            {superseded.map((pr) => (
              <div
                key={pr.id}
                className="row"
                style={{ padding: "0 0 8px 10px" }}
              >
                <div className="faint" style={{ fontSize: 12 }}>
                  {formatPR(pr)} · manual, {formatDate(pr.date)} · superseded
                </div>
                <button
                  className="check"
                  aria-label="Delete superseded PR"
                  onClick={() => { setDeleting(pr); }}
                >
                  <IconTrash />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
      {deleting && (
        <ConfirmSheet
          title="Delete record"
          message={`Delete ${formatPR(deleting)} (${prKindLabel(deleting.kind)})?`}
          confirmLabel="Delete"
          onConfirm={() => { update((d) => deletePR(d, deleting.id)); }}
          onClose={() => { setDeleting(null); }}
        />
      )}
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
  const [error, setError] = useState<string | null>(null);

  const valuePlaceholder =
    kind === "time"
      ? "mm:ss"
      : kind === "distance"
        ? "km"
        : kind === "reps"
          ? "reps"
          : "kg";

  const onExerciseChange = (id: string) => {
    setExerciseId(id);
    const ex = data.exercises.find((e) => e.id === id);
    const k = ex ? prKindsFor(ex) : [];
    setKind(k[0] ?? "1rm");
  };

  const submit = () => {
    if (!exercise) return;
    let canonical: number | undefined;
    if (kind === "time") {
      canonical = parseTime(value);
    } else {
      // A Danish keypad puts "," on the decimal key. Number("102,5") is NaN,
      // which used to make this button a silent no-op.
      const n = parseDecimal(value);
      if (n != null) canonical = kind === "distance" ? metersFromKm(n) : n;
    }
    if (canonical == null || canonical <= 0) {
      setError(
        kind === "time"
          ? "Enter a time as mm:ss."
          : `Enter a ${valuePlaceholder} value above zero.`,
      );
      return;
    }

    const repCount = parseDecimal(reps);
    if (reps.trim() !== "" && (repCount == null || repCount <= 0)) {
      setError("Reps must be a number above zero, or left blank.");
      return;
    }

    const pr: PersonalRecord = {
      id: uid("pr"),
      exerciseId: exercise.id,
      kind,
      value: canonical,
      reps: repCount != null ? Math.round(repCount) : undefined,
      date: new Date().toISOString(),
      manual: true,
    };
    update((d) => addManualPR(d, pr));
    onClose();
  };

  return (
    <Sheet title="Log a PR" onClose={onClose}>
      <Field label="Exercise">
        <select
          value={exerciseId}
          onChange={(e) => { onExerciseChange(e.target.value); }}
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
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as PRKind);
              setError(null);
            }}
          >
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
          onChange={(e) => { setValue(e.target.value); setError(null); }}
        />
      </Field>

      {(kind === "1rm" || kind === "weight") && (
        <Field label="Reps (optional context)">
          <input
            inputMode="numeric"
            value={reps}
            placeholder="e.g. 5"
            onChange={(e) => { setReps(e.target.value); setError(null); }}
          />
        </Field>
      )}

      {error && (
        <p style={{ color: "var(--danger)", fontSize: 13, margin: "4px 0 0" }}>
          {error}
        </p>
      )}

      <button className="btn primary" style={{ marginTop: 8 }} onClick={submit}>
        Save record
      </button>
    </Sheet>
  );
}
