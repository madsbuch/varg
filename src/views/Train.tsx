import { useEffect, useMemo, useState } from "react";
import type {
  Exercise,
  Session,
  SessionEntry,
  Template,
  WorkoutSet,
} from "../types";
import { useApp } from "../lib/app-context";
import {
  deleteSession,
  emptySet,
  newEntry,
  newSession,
  upsertSession,
} from "../lib/store";
import { seedTemplates } from "../lib/seed";
import { musicProfileFor } from "../lib/music";
import { BattleTrack } from "../components/BattleTrack";
import ExercisePicker from "../components/ExercisePicker";
import WodPlayer from "../components/WodPlayer";
import type { WodConfig } from "../components/WodPlayer";
import { unlockAudio } from "../lib/beep";
import { ConfirmSheet, EmptyState, Field, Sheet } from "../components/ui";
import {
  IconCheck,
  IconClock,
  IconDumbbell,
  IconFlag,
  IconMusic,
  IconPlus,
  IconTrash,
} from "../components/icons";
import {
  estimate1RM,
  formatRelative,
  formatSeconds,
  kmFromMeters,
  metersFromKm,
  parseTime,
  roundW,
} from "../lib/units";

/** A set counts as "filled" when the athlete entered any data for it. */
function setHasData(s: WorkoutSet): boolean {
  return (
    s.weight != null || s.reps != null || s.seconds != null || s.meters != null
  );
}

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
  const [wodSetup, setWodSetup] = useState(false);
  const [runningWod, setRunningWod] = useState<WodConfig | null>(null);
  const [musicFor, setMusicFor] = useState<Template | null>(null);
  const templates = useMemo(() => seedTemplates(), []);
  const history = data.sessions.filter((s) => s.finishedAt);

  const startBlank = () => {
    update((d) => upsertSession(d, newSession(defaultSessionName())));
  };

  const startFromTemplate = (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    if (tpl.interval) {
      // Circuit template: run it guided — exercises, timing, cues, music.
      const exById = new Map(data.exercises.map((e) => [e.id, e]));
      const exercises = tpl.exerciseIds
        .map((id) => exById.get(id))
        .filter((e): e is Exercise => !!e);
      if (exercises.length === 0) return;
      unlockAudio(); // must happen inside the tap gesture
      setRunningWod({
        exercises,
        ...tpl.interval,
        title: tpl.name,
        trackKey: tpl.id,
      });
      return;
    }
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
      <div className="eyebrow">Hunt</div>
      <h2 className="screen-title">Workout library</h2>

      <div className="btn-row" style={{ flexWrap: "wrap" }}>
        <button className="btn sm" onClick={startBlank}>
          <IconPlus /> Empty session
        </button>
        <button className="btn sm" onClick={() => setShowSplit(true)}>
          <IconDumbbell /> From a split
        </button>
        <button className="btn sm" onClick={() => setWodSetup(true)}>
          <IconClock /> Interval WOD
        </button>
      </div>

      <div className="section-label">History</div>
      {history.length === 0 ? (
        <EmptyState
          icon={<IconFlag />}
          title="No sessions yet"
          hint="Your logged sessions will appear here."
        />
      ) : (
        <>
          {history.slice(0, 5).map((s) => (
            <HistoryRow key={s.id} session={s} />
          ))}
          {history.length > 5 && (
            <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
              + {history.length - 5} older session
              {history.length - 5 === 1 ? "" : "s"}
            </div>
          )}
        </>
      )}

      <div className="section-label">Forsvaret</div>
      {templates
        .filter((t) => t.branch === "Forsvaret")
        .map((t) => (
          <TemplateCard
            key={t.id}
            t={t}
            onStart={() => startFromTemplate(t.id)}
            onMusic={() => setMusicFor(t)}
          />
        ))}

      <div className="section-label">Hero WODs & service tests</div>
      {templates
        .filter((t) => t.branch !== "Forsvaret")
        .map((t) => (
          <TemplateCard
            key={t.id}
            t={t}
            onStart={() => startFromTemplate(t.id)}
            onMusic={() => setMusicFor(t)}
          />
        ))}

      {musicFor && (
        <Sheet
          title={musicFor.name}
          onClose={() => setMusicFor(null)}
        >
          <BattleTrack
            cacheKey={musicFor.id}
            workoutName={musicFor.name}
            profile={musicFor.music}
          />
        </Sheet>
      )}

      {showSplit && <SplitPicker onClose={() => setShowSplit(false)} />}
      {wodSetup && (
        <WodConfigSheet
          onStart={(cfg) => {
            setWodSetup(false);
            setRunningWod(cfg);
          }}
          onClose={() => setWodSetup(false)}
        />
      )}
      {runningWod && (
        <WodPlayer config={runningWod} onClose={() => setRunningWod(null)} />
      )}
    </div>
  );
}

function TemplateCard({
  t,
  onStart,
  onMusic,
}: {
  t: Template;
  onStart: () => void;
  onMusic: () => void;
}) {
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="row">
        <h3 style={{ fontSize: 16 }}>{t.name}</h3>
        <span className="chip gold">{t.branch}</span>
      </div>
      <div className="sub muted" style={{ marginTop: 6, fontSize: 13 }}>
        {t.description}
      </div>
      <div className="sub" style={{ marginTop: 4, fontSize: 13 }}>
        {t.scheme}
      </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className="btn sm primary grow" onClick={onStart}>
          {t.interval ? "Start guided" : "Start"}
        </button>
        <button className="btn sm" onClick={onMusic} aria-label="Battle track">
          <IconMusic />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ WOD config ------------------------------ */

const WOD_PRESETS = [
  { label: "30/30 × 4", work: 30, rest: 30, rounds: 4 },
  { label: "Tabata 20/10 × 8", work: 20, rest: 10, rounds: 8 },
  { label: "40/20 × 5", work: 40, rest: 20, rounds: 5 },
];

function WodConfigSheet({
  onStart,
  onClose,
}: {
  onStart: (cfg: WodConfig) => void;
  onClose: () => void;
}) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [work, setWork] = useState("30");
  const [rest, setRest] = useState("30");
  const [rounds, setRounds] = useState("4");
  const [picking, setPicking] = useState(false);

  const num = (s: string, fallback: number) => {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
  };

  const start = () => {
    if (exercises.length === 0) return;
    unlockAudio(); // must happen inside the tap gesture
    onStart({
      exercises,
      work: num(work, 30),
      rest: Math.max(0, Number(rest) || 0),
      rounds: num(rounds, 4),
    });
  };

  return (
    <Sheet title="Interval WOD" onClose={onClose}>
      <div className="scroll-x">
        {WOD_PRESETS.map((p) => (
          <button
            key={p.label}
            className="chip"
            onClick={() => {
              setWork(String(p.work));
              setRest(String(p.rest));
              setRounds(String(p.rounds));
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="btn-row" style={{ marginTop: 12 }}>
        <Field label="Work (s)">
          <input inputMode="numeric" value={work} onChange={(e) => setWork(e.target.value)} />
        </Field>
        <Field label="Rest (s)">
          <input inputMode="numeric" value={rest} onChange={(e) => setRest(e.target.value)} />
        </Field>
        <Field label="Rounds">
          <input inputMode="numeric" value={rounds} onChange={(e) => setRounds(e.target.value)} />
        </Field>
      </div>

      <div className="section-label" style={{ marginTop: 4 }}>
        Exercises (in order)
      </div>
      {exercises.length === 0 && (
        <div className="faint" style={{ fontSize: 13, marginBottom: 8 }}>
          Add at least one exercise.
        </div>
      )}
      {exercises.map((ex, i) => (
        <div key={ex.id} className="row" style={{ padding: "6px 0" }}>
          <span>
            <span className="faint">{i + 1}. </span>
            {ex.name}
          </span>
          <button
            className="link faint"
            style={{ fontSize: 12 }}
            onClick={() =>
              setExercises((list) => list.filter((e) => e.id !== ex.id))
            }
          >
            remove
          </button>
        </div>
      ))}
      <button className="btn sm ghost" onClick={() => setPicking(true)}>
        <IconPlus /> Add exercise
      </button>

      <div className="divider" />
      <button
        className="btn primary"
        disabled={exercises.length === 0}
        onClick={start}
      >
        Start WOD
      </button>

      {picking && (
        <ExercisePicker
          exclude={exercises.map((e) => e.id)}
          onPick={(ex) => {
            setExercises((list) => [...list, ex]);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </Sheet>
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
  const [confirming, setConfirming] = useState(false);
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
        onClick={() => setConfirming(true)}
      >
        <IconTrash />
      </button>
      {confirming && (
        <ConfirmSheet
          title="Delete session"
          message={`Delete "${session.name}"? PRs will be recalculated.`}
          confirmLabel="Delete"
          onConfirm={() => update((d) => deleteSession(d, session.id))}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function defaultSessionName(): string {
  const now = new Date();
  const hour = now.getHours();
  const part = hour < 11 ? "Morning" : hour < 17 ? "Midday" : "Evening";
  return `${part} PT`;
}

/* ---------------------------- Active session ---------------------------- */

function ActiveSession({ session }: { session: Session }) {
  const { data, update } = useApp();
  const [picking, setPicking] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmEmptyFinish, setConfirmEmptyFinish] = useState(false);
  const exById = useMemo(
    () => new Map(data.exercises.map((e) => [e.id, e])),
    [data.exercises],
  );

  const patch = (fn: (s: Session) => Session) => {
    update((d) => upsertSession(d, fn(structuredClone(session))));
  };

  const addExercise = (ex: Exercise) => {
    patch((s) => {
      s.entries = [
        ...s.entries,
        newEntry(ex.id, ex.metric === "weight_reps" ? 3 : 1),
      ];
      return s;
    });
    setPicking(false);
  };

  const filledSets = session.entries.reduce(
    (a, e) => a + e.sets.filter((s) => s.done || setHasData(s)).length,
    0,
  );
  const doneSets = session.entries.reduce(
    (a, e) => a + e.sets.filter((s) => s.done).length,
    0,
  );

  /** Finish: any set with data counts — mark them done, then close out. */
  const finish = () => {
    if (filledSets === 0) {
      setConfirmEmptyFinish(true);
      return;
    }
    doFinish();
  };

  const doFinish = () => {
    update((d) => {
      const s = structuredClone(session);
      for (const entry of s.entries) {
        for (const set of entry.sets) {
          if (setHasData(set)) set.done = true;
        }
      }
      s.finishedAt = new Date().toISOString();
      return upsertSession(d, s);
    });
  };

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
          onChange={(e) => patch((s) => ({ ...s, name: e.target.value }))}
        />
      </div>
      {session.note && (
        <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
          {session.note}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <SessionTimer start={session.date} />
        <div className="chip accent">
          <IconCheck style={{ width: 14, height: 14 }} /> {doneSets} done ·{" "}
          {filledSets} logged
        </div>
      </div>

      <BattleTrack
        cacheKey={session.templateId ?? "freestyle"}
        workoutName={session.name}
        profile={musicProfileFor(session.templateId)}
      />

      <div style={{ marginTop: 14 }}>
        {session.entries.map((entry) => {
          const ex = exById.get(entry.exerciseId);
          if (!ex) return null;
          return (
            <EntryCard
              key={entry.id}
              entry={entry}
              exercise={ex}
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

      <button className="btn" style={{ marginTop: 12 }} onClick={() => setPicking(true)}>
        <IconPlus /> Add exercise
      </button>

      <div className="divider" />
      <button className="btn primary" onClick={finish}>
        <IconFlag /> Finish session
      </button>
      <button
        className="btn danger ghost"
        style={{ marginTop: 10 }}
        onClick={() => setConfirmDiscard(true)}
      >
        <IconTrash /> Discard
      </button>

      {picking && (
        <ExercisePicker onPick={addExercise} onClose={() => setPicking(false)} />
      )}
      {confirmDiscard && (
        <ConfirmSheet
          title="Discard session"
          message="Discard this session? Nothing will be saved."
          confirmLabel="Discard"
          onConfirm={() => update((d) => deleteSession(d, session.id))}
          onClose={() => setConfirmDiscard(false)}
        />
      )}
      {confirmEmptyFinish && (
        <ConfirmSheet
          title="Finish empty session"
          message="No sets have any data. Finish anyway?"
          confirmLabel="Finish"
          danger={false}
          onConfirm={doFinish}
          onClose={() => setConfirmEmptyFinish(false)}
        />
      )}
    </div>
  );
}

function SessionTimer({ start }: { start: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = (now - new Date(start).getTime()) / 1000;
  return (
    <div className="chip">
      <IconClock style={{ width: 14, height: 14 }} /> {formatSeconds(elapsed)}
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
  bestPr,
  onChange,
  onRemove,
}: {
  entry: SessionEntry;
  exercise: Exercise;
  bestPr: number;
  onChange: (fn: (e: SessionEntry) => SessionEntry) => void;
  onRemove: () => void;
}) {
  const cols = columnsFor(exercise.metric);

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
              key={s.id}
              className="set-row"
              style={{ gridTemplateColumns: gridTemplate(cols.length) }}
            >
              <div className="set-idx">{i + 1}</div>
              {cols.map((c) => (
                <NumInput
                  key={c.key}
                  initial={c.get(s)}
                  placeholder={c.placeholder}
                  onChange={(v) => setField(s.id, c.set(v))}
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
  get: (s: WorkoutSet) => string;
  set: (v: number | undefined) => Partial<WorkoutSet>;
}

const weightCol: Col = {
  key: "w",
  label: "kg",
  placeholder: "0",
  get: (s) => (s.weight == null ? "" : String(roundW(s.weight))),
  set: (v) => ({ weight: v }),
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
  label: "km",
  placeholder: "0",
  get: (s) => (s.meters == null ? "" : String(kmFromMeters(s.meters))),
  set: (v) => ({ meters: v == null ? undefined : metersFromKm(v) }),
};

const timeCol: Col = {
  key: "t",
  label: "time",
  placeholder: "mm:ss",
  get: (s) => {
    if (s.seconds == null) return "";
    const m = Math.floor(s.seconds / 60);
    const sec = Math.round(s.seconds % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  },
  set: (v) => ({ seconds: v }), // NumInput parses mm:ss into seconds
};

function columnsFor(metric: Exercise["metric"]): Col[] {
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
