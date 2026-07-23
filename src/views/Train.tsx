import { useMemo, useState } from "react";
import type { Exercise, Session, SessionEntry, WorkoutSet } from "../types";
import { useApp } from "../lib/app-context";
import {
  deleteSession,
  emptySet,
  newEntry,
  newSession,
  upsertSession,
} from "../lib/store";
import { seedTemplates } from "../lib/seed";
import ExercisePicker from "../components/ExercisePicker";
import { EmptyState, Sheet } from "../components/ui";
import {
  IconCheck,
  IconDumbbell,
  IconFlag,
  IconPlus,
  IconTrash,
} from "../components/icons";
import {
  displayToKg,
  displayToMeters,
  distanceLabel,
  estimate1RM,
  formatRelative,
  kgToDisplay,
  metersToDisplay,
  parseTime,
  roundW,
  weightLabel,
} from "../lib/units";

export default function Train() {
  const { data } = useApp();
  const active = useMemo(
    () => data.sessions.find((s) => !s.finishedAt),
    [data.sessions],
  );

  if (active) return <ActiveSession key={active.id} session={active} />;
  return <StartScreen />;
}

/* ----------------------------- Start screen ----------------------------- */

function StartScreen() {
  const { data, update } = useApp();
  const [showSplit, setShowSplit] = useState(false);
  const templates = useMemo(() => seedTemplates(), []);
  const history = data.sessions.filter((s) => s.finishedAt);

  const startBlank = () => {
    update((d) =>
      upsertSession(d, newSession(defaultSessionName())),
    );
  };

  const startFromTemplate = (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    update((d) => {
      const s = newSession(tpl.name);
      s.templateId = tpl.id;
      s.note = tpl.scheme;
      s.entries = tpl.exerciseIds.map((id) => newEntry(id, 1));
      return upsertSession(d, s);
    });
  };

  return (
    <div className="screen">
      <div className="eyebrow">Train</div>
      <h2 className="screen-title">Start a session</h2>

      <button className="btn primary" onClick={startBlank}>
        <IconPlus /> Empty session
      </button>
      <button
        className="btn"
        style={{ marginTop: 10 }}
        onClick={() => setShowSplit(true)}
      >
        <IconDumbbell /> From a split
      </button>

      <div className="section-label">Military templates</div>
      <div className="scroll-x">
        {templates.map((t) => (
          <div key={t.id} className="card tpl-card">
            <div className="row">
              <h3 style={{ fontSize: 16 }}>{t.name}</h3>
            </div>
            <div className="chip gold" style={{ marginTop: 6 }}>
              {t.branch}
            </div>
            <div className="sub muted" style={{ margin: "10px 0", fontSize: 13 }}>
              {t.scheme}
            </div>
            <button
              className="btn sm primary"
              style={{ width: "100%" }}
              onClick={() => startFromTemplate(t.id)}
            >
              Load
            </button>
          </div>
        ))}
      </div>

      <div className="section-label">History</div>
      {history.length === 0 ? (
        <EmptyState
          icon={<IconFlag />}
          title="No sessions yet"
          hint="Your logged sessions will appear here."
        />
      ) : (
        history.map((s) => <HistoryRow key={s.id} session={s} />)
      )}

      {showSplit && <SplitPicker onClose={() => setShowSplit(false)} />}
    </div>
  );
}

function SplitPicker({ onClose }: { onClose: () => void }) {
  const { data, update } = useApp();
  const [splitId, setSplitId] = useState<string | null>(null);
  const split = data.splits.find((s) => s.id === splitId);

  const startDay = (dayId: string) => {
    const sp = data.splits.find((s) => s.id === splitId);
    const day = sp?.days.find((d) => d.id === dayId);
    if (!sp || !day) return;
    update((d) => {
      const s = newSession(`${sp.name} — ${day.name}`);
      s.splitId = sp.id;
      s.splitDayId = day.id;
      s.entries = day.exerciseIds.map((id) => newEntry(id));
      return upsertSession(d, s);
    });
    onClose();
  };

  return (
    <Sheet title={split ? split.name : "Choose split"} onClose={onClose}>
      {!split ? (
        data.splits.map((s) => (
          <button
            key={s.id}
            className="list-item"
            onClick={() => setSplitId(s.id)}
          >
            <div>
              <div className="title">{s.name}</div>
              <div className="sub">{s.days.length} days</div>
            </div>
          </button>
        ))
      ) : (
        <>
          {split.days.map((day) => (
            <button
              key={day.id}
              className="list-item"
              onClick={() => startDay(day.id)}
            >
              <div>
                <div className="title">{day.name}</div>
                <div className="sub">{day.exerciseIds.length} exercises</div>
              </div>
            </button>
          ))}
          <button
            className="btn ghost"
            style={{ marginTop: 12 }}
            onClick={() => setSplitId(null)}
          >
            Back
          </button>
        </>
      )}
    </Sheet>
  );
}

function HistoryRow({ session }: { session: Session }) {
  const { update } = useApp();
  const totalSets = session.entries.reduce((a, e) => a + e.sets.length, 0);
  return (
    <div className="list-item">
      <div>
        <div className="title">{session.name}</div>
        <div className="sub">
          {session.entries.length} exercises · {totalSets} sets ·{" "}
          {formatRelative(session.finishedAt ?? session.date)}
        </div>
      </div>
      <button
        className="check"
        aria-label="Delete session"
        onClick={() => {
          if (confirm(`Delete "${session.name}"?`)) {
            update((d) => deleteSession(d, session.id));
          }
        }}
      >
        <IconTrash />
      </button>
    </div>
  );
}

function defaultSessionName(): string {
  const now = new Date();
  const hour = now.getHours();
  const part =
    hour < 11 ? "Morning" : hour < 17 ? "Midday" : "Evening";
  return `${part} PT`;
}

/* ---------------------------- Active session ---------------------------- */

function ActiveSession({ session }: { session: Session }) {
  const { data, update } = useApp();
  const [pickerFor, setPickerFor] = useState<"session" | null>(null);
  const exById = useMemo(
    () => new Map(data.exercises.map((e) => [e.id, e])),
    [data.exercises],
  );

  const patch = (fn: (s: Session) => Session) => {
    update((d) => upsertSession(d, fn(structuredClone(session))));
  };

  const addExercise = (ex: Exercise) => {
    patch((s) => {
      s.entries = [...s.entries, newEntry(ex.id, ex.metric === "weight_reps" ? 3 : 1)];
      return s;
    });
    setPickerFor(null);
  };

  const finish = () => {
    update((d) =>
      upsertSession(d, { ...structuredClone(session), finishedAt: new Date().toISOString() }),
    );
  };

  const discard = () => {
    if (confirm("Discard this session? Nothing will be saved.")) {
      update((d) => deleteSession(d, session.id));
    }
  };

  const doneSets = session.entries.reduce(
    (a, e) => a + e.sets.filter((s) => s.done).length,
    0,
  );

  return (
    <div className="screen">
      <div className="eyebrow">In progress</div>
      <div className="row">
        <input
          className="screen-title"
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            textTransform: "uppercase",
            fontSize: 24,
            fontWeight: 800,
          }}
          value={session.name}
          onChange={(e) =>
            patch((s) => ({ ...s, name: e.target.value }))
          }
        />
      </div>
      {session.note && (
        <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
          {session.note}
        </div>
      )}
      <div className="chip accent">
        <IconCheck style={{ width: 14, height: 14 }} /> {doneSets} sets done
      </div>

      <div style={{ marginTop: 14 }}>
        {session.entries.map((entry) => {
          const ex = exById.get(entry.exerciseId);
          if (!ex) return null;
          return (
            <EntryCard
              key={entry.id}
              entry={entry}
              exercise={ex}
              units={data.units}
              bestPr={bestOneRm(data, ex.id)}
              onChange={(fn) =>
                patch((s) => {
                  s.entries = s.entries.map((e) =>
                    e.id === entry.id ? fn(structuredClone(e)) : e,
                  );
                  return s;
                })
              }
              onRemove={() =>
                patch((s) => {
                  s.entries = s.entries.filter((e) => e.id !== entry.id);
                  return s;
                })
              }
            />
          );
        })}
      </div>

      <button
        className="btn"
        style={{ marginTop: 12 }}
        onClick={() => setPickerFor("session")}
      >
        <IconPlus /> Add exercise
      </button>

      <div className="divider" />
      <button className="btn primary" onClick={finish} disabled={doneSets === 0}>
        <IconFlag /> Finish session
      </button>
      <button className="btn danger ghost" style={{ marginTop: 10 }} onClick={discard}>
        <IconTrash /> Discard
      </button>

      {pickerFor && (
        <ExercisePicker
          onPick={addExercise}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  );
}

function bestOneRm(
  data: ReturnType<typeof useApp>["data"],
  exerciseId: string,
): number {
  const pr = data.prs.find(
    (p) => p.exerciseId === exerciseId && p.kind === "1rm",
  );
  return pr?.value ?? 0;
}

function EntryCard({
  entry,
  exercise,
  units,
  bestPr,
  onChange,
  onRemove,
}: {
  entry: SessionEntry;
  exercise: Exercise;
  units: import("../types").Units;
  bestPr: number;
  onChange: (fn: (e: SessionEntry) => SessionEntry) => void;
  onRemove: () => void;
}) {
  const cols = columnsFor(exercise.metric, units);

  const setField = (setId: string, field: Partial<WorkoutSet>) =>
    onChange((e) => {
      e.sets = e.sets.map((s) => (s.id === setId ? { ...s, ...field } : s));
      return e;
    });

  const addSet = () =>
    onChange((e) => {
      const last = e.sets[e.sets.length - 1];
      const seed = last ? { ...last, id: emptySet().id, done: false } : emptySet();
      e.sets = [...e.sets, seed];
      return e;
    });

  const removeSet = (setId: string) =>
    onChange((e) => {
      e.sets = e.sets.filter((s) => s.id !== setId);
      return e;
    });

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row">
        <div>
          <h3 style={{ fontSize: 17 }}>{exercise.name}</h3>
          <div className="faint" style={{ fontSize: 12 }}>
            {exercise.category}
          </div>
        </div>
        <button className="check" onClick={onRemove} aria-label="Remove">
          <IconTrash />
        </button>
      </div>

      <div className="sets">
        <div
          className="set-head"
          style={{ gridTemplateColumns: gridTemplate(cols.length) }}
        >
          <span>Set</span>
          {cols.map((c) => (
            <span key={c.key}>{c.label}</span>
          ))}
          <span></span>
        </div>
        {entry.sets.map((s, i) => {
          const isPr =
            exercise.metric === "weight_reps" &&
            s.weight != null &&
            s.reps != null &&
            s.reps > 0 &&
            bestPr > 0 &&
            estimate1RM(s.weight, s.reps) > bestPr;
          return (
            <div
              key={`${s.id}-${units}`}
              className="set-row"
              style={{ gridTemplateColumns: gridTemplate(cols.length) }}
            >
              <div className="set-idx">{i + 1}</div>
              {cols.map((c) => (
                <NumInput
                  key={c.key}
                  initial={c.get(s, units)}
                  placeholder={c.placeholder}
                  onChange={(v) => setField(s.id, c.set(v, units))}
                />
              ))}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  className={`check ${s.done ? "on" : ""}`}
                  onClick={() => setField(s.id, { done: !s.done })}
                  aria-label="Toggle done"
                >
                  <IconCheck />
                </button>
              </div>
              {isPr && (
                <div className="pr-badge" style={{ gridColumn: "1 / -1", marginTop: 2 }}>
                  ★ On pace for a new 1RM
                </div>
              )}
              <div style={{ gridColumn: "1 / -1", textAlign: "right" }}>
                {entry.sets.length > 1 && (
                  <button
                    className="link faint"
                    style={{ fontSize: 12 }}
                    onClick={() => removeSet(s.id)}
                  >
                    remove set
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={addSet}>
        <IconPlus /> Add set
      </button>
    </div>
  );
}

/* ------------------------------- Set inputs ------------------------------ */

interface Col {
  key: string;
  label: string;
  placeholder: string;
  get: (s: WorkoutSet, units: import("../types").Units) => string;
  set: (v: number | undefined, units: import("../types").Units) => Partial<WorkoutSet>;
}

function columnsFor(
  metric: Exercise["metric"],
  units: import("../types").Units,
): Col[] {
  const weightCol: Col = {
    key: "w",
    label: weightLabel(units),
    placeholder: "0",
    get: (s, u) => (s.weight == null ? "" : String(roundW(kgToDisplay(s.weight, u)))),
    set: (v, u) => ({ weight: v == null ? undefined : displayToKg(v, u) }),
  };
  const repsCol: Col = {
    key: "r",
    label: "reps",
    placeholder: "0",
    get: (s) => (s.reps == null ? "" : String(s.reps)),
    set: (v) => ({ reps: v }),
  };
  const distCol: Col = {
    key: "d",
    label: distanceLabel(units),
    placeholder: "0",
    get: (s, u) =>
      s.meters == null ? "" : String(roundW(metersToDisplay(s.meters, u))),
    set: (v, u) => ({ meters: v == null ? undefined : displayToMeters(v, u) }),
  };

  switch (metric) {
    case "weight_reps":
      return [weightCol, repsCol];
    case "reps":
      return [repsCol];
    case "time":
      return [timeCol];
    case "distance_time":
      return [distCol, timeCol];
  }
}

const timeCol: Col = {
  key: "t",
  label: "time",
  placeholder: "mm:ss",
  get: (s) => {
    if (s.seconds == null) return "";
    const m = Math.floor(s.seconds / 60);
    const sec = s.seconds % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  },
  set: (v) => ({ seconds: v }), // NumInput parses mm:ss into seconds
};

function gridTemplate(numCols: number): string {
  // set index + N inputs + check
  return `28px ${"1fr ".repeat(numCols)}44px`;
}

/**
 * Numeric/text input with its own string buffer so partial entries
 * (e.g. "2." or "1:0") don't fight React's controlled value.
 */
function NumInput({
  initial,
  placeholder,
  onChange,
}: {
  initial: string;
  placeholder: string;
  onChange: (v: number | undefined) => void;
}) {
  const [text, setText] = useState(initial);
  const isTime = placeholder === "mm:ss" || placeholder === "time";

  return (
    <input
      inputMode={isTime ? "text" : "decimal"}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (isTime) {
          onChange(parseTime(t));
        } else {
          const n = t.trim() === "" ? undefined : Number(t);
          onChange(Number.isFinite(n as number) ? (n as number) : undefined);
        }
      }}
    />
  );
}
