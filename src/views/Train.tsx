import { useEffect, useMemo, useState } from "react";
import type {
  Exercise,
  Level,
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
import { bestPRFor } from "../lib/prs";
import { musicProfileFor } from "../lib/music";
import { scrollContentTop } from "../lib/scroll";
import { BattleTrack } from "../components/BattleTrack";
import { WorkoutDetails } from "../components/WorkoutDetails";
import WodPlayer from "../components/WodPlayer";
import ForTimePlayer from "../components/ForTimePlayer";
import RidePlayer from "../components/RidePlayer";
import { RideConnectSheet } from "../components/BikeConnect";
import { disconnectBike } from "../lib/bike";
import type { RideConfig } from "../lib/ride";
import { bestRide, FREE_RIDE } from "../lib/ride";
import type { WodConfig } from "../lib/wod";
import { configForTemplate } from "../lib/wod";
import type { ForTimeConfig } from "../lib/fortime";
import { bestForTime } from "../lib/fortime";
import { LENGTHS, LEVEL_LABEL, lengthBucket, templateLength } from "../lib/catalog";
import type { LengthId } from "../lib/catalog";
import { loadFavorites, saveFavorites } from "../lib/favorites";
import { unlockAudio } from "../lib/beep";
import { ConfirmSheet, Sheet } from "../components/ui";
import {
  IconCheck,
  IconClock,
  IconFlag,
  IconPlus,
  IconStar,
  IconTrash,
} from "../components/icons";
import {
  estimate1RM,
  formatSeconds,
  kmFromMeters,
  metersFromKm,
  parseDecimal,
  parseTime,
  roundW,
} from "../lib/units";

/** A set counts as "filled" when the athlete entered any data for it. */
function setHasData(s: WorkoutSet): boolean {
  return (
    s.weight != null || s.reps != null || s.seconds != null || s.meters != null
  );
}

/** How a template runs when started — the library's filter categories. */
type Kind = "interval" | "flow" | "forTime" | "ride" | "logged";
function kindOf(t: Template): Kind {
  return t.interval ? "interval" : t.flow ? "flow" : t.forTime ? "forTime" : t.ride ? "ride" : "logged";
}

type Filter = "all" | "favorites" | Kind;
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "favorites", label: "★ Favorites" },
  { id: "interval", label: "Intervals" },
  { id: "flow", label: "Yoga" },
  { id: "forTime", label: "For time" },
  { id: "ride", label: "Bike" },
  { id: "logged", label: "Logged" },
];
const FILTER_KEY = "varg.hunt.filter.v1";
const LEVEL_KEY = "varg.hunt.level.v1";
const LENGTH_KEY = "varg.hunt.length.v1";

const LEVELS: Level[] = ["beginner", "intermediate", "advanced"];

/** A remembered library choice, or the default when storage has none (or no storage). */
function loadChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveChoice(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // remembered for this session only
  }
}
const loadFilter = () => loadChoice<Filter>(FILTER_KEY, FILTERS.map((f) => f.id), "all");

export default function Train() {
  const { data } = useApp();
  const active = useMemo(
    () => data.sessions.find((s) => !s.finishedAt),
    [data.sessions],
  );

  // Reset scroll when flipping between the library and an active session.
  useEffect(() => {
    scrollContentTop();
  }, [active?.id]);

  if (active) return <ActiveSession key={active.id} session={active} />;
  return <StartScreen />;
}

/* ----------------------------- Start screen ----------------------------- */

function StartScreen() {
  const { data, update } = useApp();
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [runningWod, setRunningWod] = useState<WodConfig | null>(null);
  const [runningForTime, setRunningForTime] = useState<ForTimeConfig | null>(null);
  const [runningRide, setRunningRide] = useState<RideConfig | null>(null);
  /** A ride waiting on its connect-the-bike step. */
  const [pendingRide, setPendingRide] = useState<Omit<RideConfig, "withBike"> | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // Alphabetical, Danish collation so æ/ø/å sort where a Dane expects, and
  // numeric so "Mobility 5" comes before "Mobility 20".
  const templates = useMemo(
    () => seedTemplates().sort((a, b) => a.name.localeCompare(b.name, "da", { numeric: true })),
    [],
  );
  const [favorites, setFavorites] = useState(loadFavorites);
  const [filter, setFilter] = useState<Filter>(loadFilter);
  const [level, setLevel] = useState<Level | "any">(() => loadChoice<Level | "any">(LEVEL_KEY, ["any", ...LEVELS], "any"));
  const [length, setLength] = useState<LengthId | "any">(() =>
    loadChoice<LengthId | "any">(LENGTH_KEY, ["any", ...LENGTHS.map((l) => l.id)], "any"));
  const [query, setQuery] = useState("");

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavorites(next);
      return next;
    });
  };
  const chooseFilter = (f: Filter) => {
    setFilter(f);
    saveChoice(FILTER_KEY, f);
  };
  const chooseLevel = (l: Level | "any") => {
    setLevel(l);
    saveChoice(LEVEL_KEY, l);
  };
  const chooseLength = (l: LengthId | "any") => {
    setLength(l);
    saveChoice(LENGTH_KEY, l);
  };

  const q = query.trim().toLowerCase();
  const shown = templates.filter((t) => {
    if (filter === "favorites" && !favorites.has(t.id)) return false;
    if (filter !== "all" && filter !== "favorites" && kindOf(t) !== filter) return false;
    if (level !== "any" && t.level !== level) return false;
    if (length !== "any" && lengthBucket(t) !== length) return false;
    if (!q) return true;
    return [t.name, t.branch, t.scheme, t.description].some((x) => x.toLowerCase().includes(q));
  });

  const startFromTemplate = (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    if (tpl.forTime) {
      // For-time template: stopwatch, stages in order, Done per stage.
      const exById = new Map(data.exercises.map((e) => [e.id, e]));
      const stages = tpl.forTime.stages;
      const exercises = stages
        .map((st) => exById.get(st.exerciseId))
        .filter((e): e is Exercise => !!e);
      // Same rule as a circuit: never run a workout with a stage missing.
      if (exercises.length !== stages.length) {
        setStartError(
          `${tpl.name} has ${String(stages.length)} stages but only ` +
            `${String(exercises.length)} of their exercises exist on this device. ` +
            `Reinstalling or updating the app restores the built-in exercises.`,
        );
        return;
      }
      unlockAudio(); // must happen inside the tap gesture
      setSelectedTemplate(null);
      setRunningForTime({ title: tpl.name, templateId: tpl.id, stages, exercises });
      return;
    }
    if (tpl.ride) {
      // Indoor bike: connect the bike first (or skip), then ride.
      setSelectedTemplate(null);
      setPendingRide({
        title: tpl.name,
        templateId: tpl.id,
        segments: tpl.ride.free ? [FREE_RIDE] : tpl.ride.segments,
        race: tpl.ride.race === true,
        free: tpl.ride.free === true,
      });
      return;
    }
    if (tpl.flow || tpl.interval) {
      // Guided: a circuit or a yoga flow — timing, cues, voice, music.
      const cfg = configForTemplate(tpl, new Map(data.exercises.map((e) => [e.id, e])));
      if (typeof cfg === "string") {
        setStartError(cfg);
        return;
      }
      unlockAudio(); // must happen inside the tap gesture
      setSelectedTemplate(null);
      setRunningWod(cfg);
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

      <input
        className="hunt-search"
        type="search"
        placeholder="Search workouts"
        aria-label="Search workouts"
        value={query}
        onChange={(e) => { setQuery(e.target.value); }}
      />
      <div className="filter-row" role="group" aria-label="Filter workouts">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`filter-chip ${filter === f.id ? "on" : ""}`}
            aria-pressed={filter === f.id}
            onClick={() => { chooseFilter(f.id); }}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="filter-row tight" role="group" aria-label="Filter by level">
        {(["any", ...LEVELS] as const).map((l) => (
          <button
            key={l}
            className={`filter-chip ${level === l ? "on" : ""}`}
            aria-pressed={level === l}
            onClick={() => { chooseLevel(l); }}
          >
            {l === "any" ? "Any level" : LEVEL_LABEL[l]}
          </button>
        ))}
      </div>
      <div className="filter-row tight" role="group" aria-label="Filter by length">
        {([{ id: "any", label: "Any length" }, ...LENGTHS] as const).map((l) => (
          <button
            key={l.id}
            className={`filter-chip ${length === l.id ? "on" : ""}`}
            aria-pressed={length === l.id}
            onClick={() => { chooseLength(l.id); }}
          >
            {l.label}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="muted" style={{ textAlign: "center", marginTop: 24 }}>
          {filter === "favorites" && favorites.size === 0
            ? "No favorites yet. Tap the star on a workout to add it."
            : "No workouts match."}
        </p>
      )}
      {shown.map((t) => (
        <TemplateCard
          key={t.id}
          t={t}
          favorite={favorites.has(t.id)}
          best={t.forTime
            ? bestForTime(data.sessions, t.id, t.forTime.stages.length)
            : t.ride?.race ? bestRide(data.sessions, t.id, t.ride.segments.length) : undefined}
          onOpen={() => { setSelectedTemplate(t); }}
          onStart={() => { startFromTemplate(t.id); }}
          onToggleFavorite={() => { toggleFavorite(t.id); }}
        />
      ))}

      {selectedTemplate && (
        <WorkoutDetails
          key={selectedTemplate.id}
          template={selectedTemplate}
          exercises={data.exercises}
          onStart={() => { startFromTemplate(selectedTemplate.id); }}
          onClose={() => { setSelectedTemplate(null); }}
        />
      )}
      {startError && (
        <Sheet title="Can't start" onClose={() => { setStartError(null); }}>
          <p className="muted" style={{ marginTop: 0 }}>{startError}</p>
          <button className="btn" onClick={() => { setStartError(null); }}>
            OK
          </button>
        </Sheet>
      )}
      {runningWod && (
        <WodPlayer config={runningWod} onClose={() => { setRunningWod(null); }} />
      )}
      {runningForTime && (
        <ForTimePlayer config={runningForTime} onClose={() => { setRunningForTime(null); }} />
      )}
      {pendingRide && (
        <RideConnectSheet
          title={pendingRide.title}
          onCancel={() => { void disconnectBike().catch(() => undefined); setPendingRide(null); }}
          onStart={(withBike) => {
            unlockAudio(); // inside the Start tap: unlocks cues and music
            // Riding without it means not reading it either.
            if (!withBike) void disconnectBike().catch(() => undefined);
            setRunningRide({ ...pendingRide, withBike });
            setPendingRide(null);
          }}
        />
      )}
      {runningRide && (
        <RidePlayer
          config={runningRide}
          onClose={() => {
            // Release the bike so Body Bike or Mowl can have it back.
            void disconnectBike().catch(() => undefined);
            setRunningRide(null);
          }}
        />
      )}
    </div>
  );
}

function TemplateCard({ t, favorite, best, onOpen, onStart, onToggleFavorite }: {
  t: Template;
  favorite: boolean;
  best: number | undefined;
  onOpen: () => void;
  onStart: () => void;
  onToggleFavorite: () => void;
}) {
  const len = templateLength(t);
  // The card body opens the details sheet; star and Start now are their own
  // buttons beside it, never nested inside it.
  return (
    <div className="card workout-card">
      <button
        className={`workout-star ${favorite ? "on" : ""}`}
        onClick={onToggleFavorite}
        aria-pressed={favorite}
        aria-label={favorite ? `Unstar ${t.name}` : `Star ${t.name}`}
      >
        <IconStar filled={favorite} />
      </button>
      <button className="workout-card-body" onClick={onOpen} aria-label={`View ${t.name}`}>
        <span className="row" style={{ paddingRight: 40 }}>
          <strong style={{ fontSize: 16 }}>{t.name}</strong>
          <span className="chip gold">{t.branch}</span>
        </span>
        <span className="sub muted" style={{ display: "block", marginTop: 6, fontSize: 13 }}>
          {t.description}
        </span>
        <span className="sub" style={{ display: "block", marginTop: 4, fontSize: 13 }}>
          {t.scheme}
        </span>
        <span className="workout-card-chips">
          <span className={`chip level-${t.level}`}>{LEVEL_LABEL[t.level]}</span>
          {len && (
            <span className="chip accent">
              <IconClock style={{ width: 14, height: 14 }} />{" "}
              {len.exact ? `${formatSeconds(len.seconds)} on the clock` : `≈ ${String(Math.round(len.seconds / 60))} min`}
            </span>
          )}
          {(t.forTime ?? t.ride?.race) && (
            <span className="chip accent">
              {best != null ? `Best ${formatSeconds(best)}` : "For time · no best yet"}
            </span>
          )}
        </span>
      </button>
      <div className="workout-card-actions">
        <button className="workout-card-link" onClick={onOpen}>
          Details & music →
        </button>
        <button className="btn primary sm workout-start-now" onClick={onStart} aria-label={`Start ${t.name} now`}>
          Start now
        </button>
      </div>
    </div>
  );
}

/* ---------------------------- Active session ---------------------------- */

function ActiveSession({ session }: { session: Session }) {
  const { data, update } = useApp();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmEmptyFinish, setConfirmEmptyFinish] = useState(false);
  const [confirmUnchecked, setConfirmUnchecked] = useState(false);
  const exById = useMemo(
    () => new Map(data.exercises.map((e) => [e.id, e])),
    [data.exercises],
  );

  const patch = (fn: (s: Session) => Session) => {
    update((d) => upsertSession(d, fn(structuredClone(session))));
  };

  const filledSets = session.entries.reduce(
    (a, e) => a + e.sets.filter((s) => s.done || setHasData(s)).length,
    0,
  );
  const doneSets = session.entries.reduce(
    (a, e) => a + e.sets.filter((s) => s.done).length,
    0,
  );

  const uncheckedWithData = session.entries.reduce(
    (a, e) => a + e.sets.filter((s) => !s.done && setHasData(s)).length,
    0,
  );

  const finish = () => {
    if (filledSets === 0) {
      setConfirmEmptyFinish(true);
      return;
    }
    // A set with data but no tick is how you record a missed attempt, so
    // ask before promoting them — never assume.
    if (uncheckedWithData > 0) {
      setConfirmUnchecked(true);
      return;
    }
    doFinish(false);
  };

  /**
   * Close out. The checkbox is the only gate on PR detection, so finishing
   * must not touch `done` unless the athlete explicitly asked for it.
   */
  const doFinish = (markUnchecked: boolean) => {
    update((d) => {
      const s = structuredClone(session);
      if (markUnchecked) {
        for (const entry of s.entries) {
          for (const set of entry.sets) {
            if (setHasData(set)) set.done = true;
          }
        }
      }
      // Empty planned sets and untouched exercises are not performed work.
      s.entries = s.entries
        .map((entry) => ({ ...entry, sets: entry.sets.filter((set) => set.done || setHasData(set)) }))
        .filter((entry) => entry.sets.length > 0);
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
          onChange={(e) => { patch((s) => ({ ...s, name: e.target.value })); }}
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
                { patch((s) => {
                  s.entries = s.entries.map((e) =>
                    e.id === entry.id ? fn(structuredClone(e)) : e,
                  );
                  return s;
                }); }
              }
              onRemove={() =>
                { patch((s) => {
                  s.entries = s.entries.filter((e) => e.id !== entry.id);
                  return s;
                }); }
              }
            />
          );
        })}
      </div>

      <div className="divider" />
      <button className="btn primary" onClick={finish}>
        <IconFlag /> Finish session
      </button>
      <button
        className="btn danger ghost"
        style={{ marginTop: 10 }}
        onClick={() => { setConfirmDiscard(true); }}
      >
        <IconTrash /> Discard
      </button>

      {confirmDiscard && (
        <ConfirmSheet
          title="Discard session"
          message="Discard this session? Nothing will be saved."
          confirmLabel="Discard"
          onConfirm={() => { update((d) => deleteSession(d, session.id)); }}
          onClose={() => { setConfirmDiscard(false); }}
        />
      )}
      {confirmEmptyFinish && (
        <ConfirmSheet
          title="Finish empty session"
          message="No sets have any data. Finish anyway?"
          confirmLabel="Finish"
          danger={false}
          onConfirm={() => { doFinish(false); }}
          onClose={() => { setConfirmEmptyFinish(false); }}
        />
      )}
      {confirmUnchecked && (
        // Two outcomes, so this can't be a ConfirmSheet: dismissing must
        // return to the session, not silently finish it — a finished
        // session can no longer be edited.
        <Sheet
          title="Unchecked sets"
          onClose={() => { setConfirmUnchecked(false); }}
        >
          <p className="muted" style={{ marginTop: 0 }}>
            {uncheckedWithData} set{uncheckedWithData === 1 ? " has" : "s have"}{" "}
            data but {uncheckedWithData === 1 ? "is" : "are"} not ticked.
            Unticked sets count as failed attempts: they stay out of your
            records.
          </p>
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button
              className="btn ghost"
              onClick={() => {
                setConfirmUnchecked(false);
                doFinish(false);
              }}
            >
              Finish as-is
            </button>
            <button
              className="btn primary"
              onClick={() => {
                setConfirmUnchecked(false);
                doFinish(true);
              }}
            >
              Mark them done
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function SessionTimer({ start }: { start: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(id); };
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
  // The standing record, not the first match: manual PRs used to be stored
  // ahead of the computed ones, so .find() let a single low manual entry
  // shadow the real best and flag every working set as "on pace".
  return bestPRFor(data.prs, exerciseId, "1rm")?.value ?? 0;
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
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmRemoveSet, setConfirmRemoveSet] = useState<string | null>(null);
  const logged = entry.sets.filter(setHasData).length;

  const setField = (setId: string, field: Partial<WorkoutSet>) =>
    { onChange((e) => {
      e.sets = e.sets.map((s) => (s.id === setId ? { ...s, ...field } : s));
      return e;
    }); };

  // Shape only. The previous set's numbers show up as placeholders instead,
  // so a failed attempt can't inherit the last good lift and be logged.
  const addSet = () =>
    { onChange((e) => {
      e.sets = [...e.sets, emptySet()];
      return e;
    }); };

  const removeSet = (setId: string) =>
    { onChange((e) => {
      e.sets = e.sets.filter((s) => s.id !== setId);
      return e;
    }); };

  const askRemoveSet = (s: WorkoutSet) => {
    if (setHasData(s)) setConfirmRemoveSet(s.id);
    else removeSet(s.id);
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row">
        <div>
          <h3 style={{ fontSize: 17 }}>{exercise.name}</h3>
          <div className="faint" style={{ fontSize: 12 }}>
            {exercise.category}
          </div>
        </div>
        {/* One tap to prune a station you're skipping; confirm once it
            holds logged work — deleting an entry drops its sets for good. */}
        <button
          className="check"
          onClick={() => {
            if (logged > 0) setConfirmRemove(true);
            else onRemove();
          }}
          aria-label="Remove"
        >
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
          const prev = entry.sets[i - 1];
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
              {cols.map((c) => {
                // The set above is a hint, not a value: it greys out and is
                // never logged unless the athlete types it.
                const hint = prev ? c.get(prev) : "";
                return (
                  <NumInput
                    key={c.key}
                    initial={c.get(s)}
                    placeholder={hint === "" ? c.placeholder : hint}
                    isTime={c.isTime ?? false}
                    onChange={(v) => { setField(s.id, c.set(v)); }}
                  />
                );
              })}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  className={`check ${s.done ? "on" : ""}`}
                  onClick={() => { setField(s.id, { done: !s.done }); }}
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
                    onClick={() => { askRemoveSet(s); }}
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

      {confirmRemove && (
        <ConfirmSheet
          title="Remove exercise"
          message={
            `Remove ${exercise.name}? Its ${String(logged)} logged ` +
            `${logged === 1 ? "set" : "sets"} will be deleted.`
          }
          confirmLabel="Remove"
          onConfirm={onRemove}
          onClose={() => { setConfirmRemove(false); }}
        />
      )}
      {confirmRemoveSet != null && (
        <ConfirmSheet
          title="Remove set"
          message="This set has data. Delete it?"
          confirmLabel="Remove"
          onConfirm={() => { removeSet(confirmRemoveSet); }}
          onClose={() => { setConfirmRemoveSet(null); }}
        />
      )}
    </div>
  );
}

/* ------------------------------- Set inputs ------------------------------ */

interface Col {
  key: string;
  label: string;
  placeholder: string;
  /** Takes mm:ss rather than a decimal. */
  isTime?: boolean;
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
  isTime: true,
  get: (s) => {
    if (s.seconds == null) return "";
    return formatSeconds(s.seconds);
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
 *
 * Text that doesn't parse leaves the stored value alone and turns the
 * field red. Writing undefined instead erased the number the athlete was
 * looking at — the buffer keeps rendering, so nothing said it was gone.
 */
function NumInput({
  initial,
  placeholder,
  isTime,
  onChange,
}: {
  initial: string;
  placeholder: string;
  isTime: boolean;
  onChange: (v: number | undefined) => void;
}) {
  const [text, setText] = useState(initial);
  const parse = isTime ? parseTime : parseDecimal;
  // "1:" is halfway to "1:30", not a mistake — judge a settled buffer only.
  const invalid =
    text.trim() !== "" && !/[.,:]$/.test(text) && parse(text) === undefined;

  return (
    <input
      className={invalid ? "invalid" : undefined}
      inputMode={isTime ? "text" : "decimal"}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const v = parse(t);
        if (v !== undefined || t.trim() === "") onChange(v);
      }}
    />
  );
}
