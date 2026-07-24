import { useMemo, useState } from "react";
import type { Category, Exercise, Metric } from "../types";
import { useApp } from "../lib/app-context";
import { upsertExercise, uid } from "../lib/store";
import { Field, Segmented, Sheet } from "./ui";
import { IconPlus } from "./icons";

const METRICS: { value: Metric; label: string }[] = [
  { value: "weight_reps", label: "Weight×Reps" },
  { value: "reps", label: "Reps" },
  { value: "time", label: "Time/Hold" },
  { value: "distance_time", label: "Distance" },
];

const CATEGORIES: Category[] = [
  "strength",
  "bodyweight",
  "core",
  "conditioning",
  "cardio",
  "ruck",
];

export default function ExercisePicker({
  onPick,
  onClose,
  exclude = [],
}: {
  onPick: (ex: Exercise) => void;
  onClose: () => void;
  exclude?: string[];
}) {
  const { data, update } = useApp();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.exercises
      .filter((e) => !exclude.includes(e.id))
      .filter((e) => !term || e.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data.exercises, q, exclude]);

  return (
    <Sheet title="Add Exercise" onClose={onClose}>
      {creating ? (
        <NewExerciseForm
          initialName={q}
          onCancel={() => { setCreating(false); }}
          onCreate={(ex) => {
            update((d) => upsertExercise(d, ex));
            onPick(ex);
          }}
        />
      ) : (
        <>
          <input
            autoFocus
            placeholder="Search exercises…"
            value={q}
            onChange={(e) => { setQ(e.target.value); }}
          />
          <div style={{ marginTop: 12 }}>
            {filtered.map((e) => (
              <button
                key={e.id}
                className="list-item"
                onClick={() => { onPick(e); }}
              >
                <div>
                  <div className="title">{e.name}</div>
                  <div className="sub">
                    {e.category} · {e.muscles.join(", ")}
                  </div>
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="empty">No matches.</div>
            )}
          </div>
          <button
            className="btn"
            style={{ marginTop: 14 }}
            onClick={() => { setCreating(true); }}
          >
            <IconPlus /> Create custom exercise
          </button>
        </>
      )}
    </Sheet>
  );
}

function NewExerciseForm({
  initialName,
  onCreate,
  onCancel,
}: {
  initialName: string;
  onCreate: (ex: Exercise) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [metric, setMetric] = useState<Metric>("weight_reps");
  const [category, setCategory] = useState<Category>("strength");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({
      id: uid("ex"),
      name: trimmed,
      category,
      metric,
      muscles: [],
      builtIn: false,
    });
  };

  return (
    <>
      <Field label="Name">
        <input
          autoFocus
          value={name}
          onChange={(e) => { setName(e.target.value); }}
          placeholder="e.g. Sandbag Clean"
        />
      </Field>
      <Field label="Tracked as">
        <Segmented value={metric} options={METRICS} onChange={setMetric} />
      </Field>
      <Field label="Category">
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value as Category); }}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" onClick={submit}>
          Create
        </button>
      </div>
    </>
  );
}
