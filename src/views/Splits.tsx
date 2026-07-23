import { useState } from "react";
import type { Exercise, Split, SplitDay } from "../types";
import { useApp } from "../lib/app-context";
import { deleteSplit, uid, upsertSplit } from "../lib/store";
import ExercisePicker from "../components/ExercisePicker";
import { ConfirmSheet, Field, Sheet } from "../components/ui";
import { IconLayers, IconPlus, IconTrash } from "../components/icons";

export default function Splits() {
  const { data, update } = useApp();
  const [editing, setEditing] = useState<Split | null>(null);
  const [deleting, setDeleting] = useState<Split | null>(null);

  const newSplit = (): Split => ({
    id: uid("split"),
    name: "",
    description: "",
    builtIn: false,
    days: [{ id: uid("day"), name: "Day 1", exerciseIds: [] }],
  });

  return (
    <div className="screen">
      <div className="eyebrow">Splits</div>
      <h2 className="screen-title">Your splits</h2>

      <button className="btn primary" onClick={() => setEditing(newSplit())}>
        <IconPlus /> New split
      </button>

      <div className="section-label">All splits</div>
      {data.splits.map((s) => (
        <div key={s.id} className="list-item">
          <button
            className="grow"
            style={{ textAlign: "left", background: "none" }}
            onClick={() => setEditing(structuredClone(s))}
          >
            <div className="title">{s.name}</div>
            <div className="sub">
              {s.days.length} days ·{" "}
              {s.days.reduce((a, d) => a + d.exerciseIds.length, 0)} exercises
              {s.builtIn ? " · built-in" : ""}
            </div>
          </button>
          {!s.builtIn && (
            <button
              className="check"
              aria-label="Delete"
              onClick={() => setDeleting(s)}
            >
              <IconTrash />
            </button>
          )}
        </div>
      ))}

      {deleting && (
        <ConfirmSheet
          title="Delete split"
          message={`Delete split "${deleting.name}"?`}
          confirmLabel="Delete"
          onConfirm={() => update((d) => deleteSplit(d, deleting.id))}
          onClose={() => setDeleting(null)}
        />
      )}

      {editing && (
        <SplitEditor
          key={editing.id}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(split) => {
            update((d) => upsertSplit(d, split));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function SplitEditor({
  initial,
  onSave,
  onClose,
}: {
  initial: Split;
  onSave: (s: Split) => void;
  onClose: () => void;
}) {
  const { data } = useApp();
  const [split, setSplit] = useState<Split>(initial);
  const [pickerDay, setPickerDay] = useState<string | null>(null);
  const exById = new Map(data.exercises.map((e) => [e.id, e]));

  const patchDay = (dayId: string, fn: (d: SplitDay) => SplitDay) =>
    setSplit((s) => ({
      ...s,
      days: s.days.map((d) => (d.id === dayId ? fn({ ...d }) : d)),
    }));

  const addDay = () =>
    setSplit((s) => ({
      ...s,
      days: [
        ...s.days,
        { id: uid("day"), name: `Day ${s.days.length + 1}`, exerciseIds: [] },
      ],
    }));

  const removeDay = (dayId: string) =>
    setSplit((s) => ({ ...s, days: s.days.filter((d) => d.id !== dayId) }));

  const addExerciseToDay = (dayId: string, ex: Exercise) => {
    patchDay(dayId, (d) => ({
      ...d,
      exerciseIds: d.exerciseIds.includes(ex.id)
        ? d.exerciseIds
        : [...d.exerciseIds, ex.id],
    }));
    setPickerDay(null);
  };

  const canSave = split.name.trim().length > 0;

  return (
    <Sheet title={initial.name ? "Edit split" : "New split"} onClose={onClose}>
      <Field label="Name">
        <input
          autoFocus
          value={split.name}
          placeholder="e.g. Ranger Prep"
          onChange={(e) => setSplit({ ...split, name: e.target.value })}
        />
      </Field>
      <Field label="Description">
        <input
          value={split.description ?? ""}
          placeholder="Optional"
          onChange={(e) =>
            setSplit({ ...split, description: e.target.value })
          }
        />
      </Field>

      {split.days.map((day) => (
        <div key={day.id} className="card" style={{ marginTop: 12 }}>
          <div className="row">
            <input
              value={day.name}
              onChange={(e) =>
                patchDay(day.id, (d) => ({ ...d, name: e.target.value }))
              }
              style={{ fontWeight: 700 }}
            />
            {split.days.length > 1 && (
              <button
                className="check"
                aria-label="Remove day"
                style={{ marginLeft: 8 }}
                onClick={() => removeDay(day.id)}
              >
                <IconTrash />
              </button>
            )}
          </div>

          <div style={{ marginTop: 10 }}>
            {day.exerciseIds.length === 0 && (
              <div className="faint" style={{ fontSize: 13 }}>
                No exercises yet.
              </div>
            )}
            {day.exerciseIds.map((id) => (
              <div key={id} className="row" style={{ padding: "6px 0" }}>
                <span>{exById.get(id)?.name ?? "Unknown"}</span>
                <button
                  className="link faint"
                  style={{ fontSize: 12 }}
                  onClick={() =>
                    patchDay(day.id, (d) => ({
                      ...d,
                      exerciseIds: d.exerciseIds.filter((x) => x !== id),
                    }))
                  }
                >
                  remove
                </button>
              </div>
            ))}
          </div>

          <button
            className="btn sm ghost"
            style={{ marginTop: 8 }}
            onClick={() => setPickerDay(day.id)}
          >
            <IconPlus /> Add exercise
          </button>
        </div>
      ))}

      <button className="btn ghost" style={{ marginTop: 12 }} onClick={addDay}>
        <IconLayers /> Add day
      </button>

      <div className="divider" />
      <button
        className="btn primary"
        disabled={!canSave}
        onClick={() => onSave(split)}
      >
        Save split
      </button>

      {pickerDay && (
        <ExercisePicker
          exclude={
            split.days.find((d) => d.id === pickerDay)?.exerciseIds ?? []
          }
          onPick={(ex) => addExerciseToDay(pickerDay, ex)}
          onClose={() => setPickerDay(null)}
        />
      )}
    </Sheet>
  );
}
