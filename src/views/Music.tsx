/**
 * Music, in Skipan: proper screens, not sheets stacked on the settings page.
 *
 *   Music ── default for every workout, the sets, the workouts' own
 *   │        tracks, and the composer's state and log
 *   ├─ Set ── its songs by intensity: play, check the beat, regenerate
 *   │  └─ New song
 *   └─ Workout tracks ── every workout's own track and whether it is ready
 *      └─ Track ── play it, tune its profile, compose it again
 *
 * Settings owns the stack (so the tab bar and Back work as everywhere
 * else); this module draws whichever screen is on top. The kie.ai key
 * stays on the settings page itself: the voice uses it too.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Intensity, MusicProfile } from "../types";
import {
  MAX_FAILED_ATTEMPTS,
  clearMusicLog,
  clearProfileOverride,
  clearTrackFailure,
  deleteCachedTrack,
  ensureAllTracks,
  generateTrack,
  getCachedTrack,
  loadMusicSettings,
  loadTrackFailures,
  onEnsureStatus,
  onMusicLog,
  putCachedTrack,
  readMusicLog,
  saveProfileOverride,
  workoutMusicList,
  type CachedTrack,
  type EnsureStatus,
  type MusicLogEntry,
  type TrackFailure,
  type WorkoutMusic,
} from "../lib/music";
import {
  addUserSong, allSongs, deleteUserSong, INTENSITY_NAMES, LIBRARY_KEY, newSongProblem, onSongsChange, SETS, setById, songKey,
} from "../lib/songs";
import type { SetId, Song } from "../lib/songs";
import { loadDefaultChoice, saveDefaultChoice } from "../lib/music-choice";
import type { MixChoice } from "../lib/music-choice";
import { parseDecimal } from "../lib/units";
import { BattleTrack } from "../components/BattleTrack";
import { choiceLabel } from "../components/MusicPicker";
import { useSongStates } from "../components/song-status";
import { ConfirmSheet, Field } from "../components/ui";
import { IconMusic } from "../components/icons";

export type MusicRoute =
  | { page: "music" }
  | { page: "set"; set: SetId }
  | { page: "new-song"; set: SetId }
  | { page: "tracks" }
  | { page: "track"; key: string };

/** The screen on top of the music stack. */
export function MusicScreen({ route, push, pop }: {
  route: MusicRoute;
  push: (r: MusicRoute) => void;
  pop: () => void;
}) {
  switch (route.page) {
    case "music": return <MusicHome push={push} pop={pop} />;
    case "set": return <SetScreen set={route.set} push={push} pop={pop} />;
    case "new-song": return <NewSongScreen set={route.set} pop={pop} />;
    case "tracks": return <TracksScreen push={push} pop={pop} />;
    case "track": return <TrackRoute trackKey={route.key} pop={pop} />;
  }
}

/** A screen's head: back, where it sits, and its name. */
function PageHead({ eyebrow, title, onBack }: { eyebrow: string; title: string; onBack: () => void }) {
  return (
    <div className="page-head">
      <button className="check page-back" onClick={onBack} aria-label="Back">‹</button>
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="screen-title">{title}</h2>
      </div>
    </div>
  );
}

function useSongs(): Song[] {
  const [songs, setSongs] = useState(allSongs);
  useEffect(() => onSongsChange(() => { setSongs(allSongs()); }), []);
  return songs;
}

/** Which workouts' own tracks are composed; refreshed as the composer reports. */
function useTrackCache() {
  const [status, setStatus] = useState<EnsureStatus | null>(null);
  const [workouts, setWorkouts] = useState<WorkoutMusic[]>(() => workoutMusicList().filter((w) => !w.key.startsWith("song:")));
  const [cached, setCached] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<Record<string, TrackFailure>>(loadTrackFailures);
  useEffect(() => onEnsureStatus(setStatus), []);
  const refresh = useCallback(() => {
    void (async () => {
      const list = workoutMusicList().filter((w) => !w.key.startsWith("song:"));
      const have = new Set<string>();
      for (const w of list) {
        if (await getCachedTrack(w.key)) have.add(w.key);
      }
      setWorkouts(list);
      setCached(have);
      setFailures(loadTrackFailures());
    })();
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh, status?.ready, status?.running, status?.error]);
  return { status, workouts, cached, failures, refresh };
}

/* ------------------------------- Music ---------------------------------- */

const DEFAULT_CHOICES: MixChoice[] = [
  { mode: "track" },
  ...SETS.map((s) => ({ mode: "set" as const, set: s.id })),
  { mode: "shuffle" },
];
const same = (a: MixChoice, b: MixChoice) =>
  a.mode === b.mode && (a.mode !== "set" || (b.mode === "set" && a.set === b.set));

function MusicHome({ push, pop }: { push: (r: MusicRoute) => void; pop: () => void }) {
  const [fallback, setFallback] = useState(loadDefaultChoice);
  const songs = useSongs();
  const states = useSongStates(songs.map((s) => s.id));
  const { status, workouts, cached } = useTrackCache();
  const hasKey = !!loadMusicSettings().apiKey;

  return (
    <div className="screen">
      <PageHead eyebrow="Skipan" title="Music" onBack={pop} />

      <div className="section-label" style={{ marginTop: 0 }}>Default for every workout</div>
      <div className="card">
        <div className="filter-row" role="group" aria-label="Default music" style={{ flexWrap: "wrap", paddingTop: 0 }}>
          {DEFAULT_CHOICES.map((c) => (
            <button
              key={choiceLabel(c)}
              className={`filter-chip ${same(c, fallback) ? "on" : ""}`}
              aria-pressed={same(c, fallback)}
              onClick={() => { setFallback(c); saveDefaultChoice(c); }}
            >
              {choiceLabel(c)}
            </button>
          ))}
        </div>
        <div className="faint" style={{ fontSize: 12 }}>
          {fallback.mode === "track" ? "Each workout its own track" : "Warm-up Low · the rest High · yoga Low"}
          {" · change it per workout on its page"}
        </div>
      </div>

      <div className="section-label">Song sets</div>
      {SETS.map((set) => {
        const inSet = songs.filter((s) => s.set === set.id);
        const ready = inSet.filter((s) => states[s.id] === "ready").length;
        const refused = inSet.filter((s) => states[s.id] === "refused").length;
        return (
          <button key={set.id} className="list-item" onClick={() => { push({ page: "set", set: set.id }); }}>
            <div>
              <div className="title">{set.name}</div>
              <div className="sub">{set.sound} · {ready}/{inSet.length} ready</div>
            </div>
            {refused > 0 ? <span className="chip danger">{refused} no beat</span> : <span className="chip">›</span>}
          </button>
        );
      })}

      <div className="section-label">Workout tracks</div>
      <button className="list-item" onClick={() => { push({ page: "tracks" }); }}>
        <div>
          <div className="title">Own tracks</div>
          <div className="sub">One composed track per workout · {workouts.filter((w) => cached.has(w.key)).length}/{workouts.length} ready</div>
        </div>
        <span className="chip">›</span>
      </button>

      {!hasKey && <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>Composing needs your kie.ai key · Skipan</div>}
      <ComposerStatus status={status} />
      <ComposerLog />
    </div>
  );
}

/* -------------------------------- Set ----------------------------------- */

function SetScreen({ set: setId, push, pop }: { set: SetId; push: (r: MusicRoute) => void; pop: () => void }) {
  const set = setById(setId);
  const songs = useSongs().filter((s) => s.set === setId);
  const [deleting, setDeleting] = useState<Song | null>(null);
  if (!set) return null;

  return (
    <div className="screen">
      <PageHead eyebrow="Music · song set" title={set.name} onBack={pop} />
      <div className="muted" style={{ fontSize: 13 }}>{set.sound}</div>
      {([1, 2, 3] as const).map((l: Intensity) => (
        <div key={l}>
          <div className="section-label">{INTENSITY_NAMES[l]} · {set.bpm[l]} BPM</div>
          {songs.filter((s) => s.intensity === l).map((s) => (
            <div key={s.id} style={{ marginBottom: 10 }}>
              <BattleTrack
                cacheKey={songKey(s.id)}
                workoutName={s.name}
                profile={{ bpm: s.bpm, style: s.style, theme: "" }}
                label={s.user ? `${s.name} · yours` : s.name}
                songId={s.id}
              />
              {s.user && (
                <button className="link faint" style={{ fontSize: 12, marginTop: 4 }} onClick={() => { setDeleting(s); }}>
                  delete this song
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      <button className="btn" style={{ marginTop: 12 }} onClick={() => { push({ page: "new-song", set: setId }); }}>
        New {set.name} song
      </button>

      {deleting && (
        <ConfirmSheet
          title="Delete song"
          message={`Delete "${deleting.name}" from ${set.name}? Its composed track goes too; workouts stop playing it.`}
          confirmLabel="Delete"
          onConfirm={() => {
            void deleteCachedTrack(songKey(deleting.id)).catch(() => undefined);
            deleteUserSong(deleting.id);
          }}
          onClose={() => { setDeleting(null); }}
        />
      )}
    </div>
  );
}

/** Make a song: its sound and words; the set fixes tempo, key and beat. */
function NewSongScreen({ set: initialSet, pop }: { set: SetId; pop: () => void }) {
  const [name, setName] = useState("");
  const [set, setSet] = useState<SetId>(initialSet);
  const [intensity, setIntensity] = useState<Intensity>(1);
  const [style, setStyle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [error, setError] = useState("");
  const draft = { name, set, intensity, style, lyrics };
  const problem = newSongProblem(draft);
  const bpm = setById(set)?.bpm[intensity] ?? 144;
  const hasKey = !!loadMusicSettings().apiKey;

  const create = () => {
    setError("");
    try {
      addUserSong(draft);
      // The composer requests every song without a track: this one now.
      void ensureAllTracks();
      pop();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="screen">
      <PageHead eyebrow={`Music · ${setById(initialSet)?.name ?? ""}`} title="New song" onBack={pop} />
      <Field label="Name">
        <input value={name} maxLength={40} placeholder="Midnight brass" onChange={(e) => { setName(e.target.value); }} />
      </Field>
      <Field label="Set">
        <div className="filter-row" role="group" aria-label="Set" style={{ paddingTop: 0 }}>
          {SETS.map((x) => (
            <button key={x.id} className={`filter-chip ${set === x.id ? "on" : ""}`} aria-pressed={set === x.id} onClick={() => { setSet(x.id); }}>
              {x.name}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Intensity">
        <div className="segmented" role="group" aria-label="Intensity">
          {([1, 2, 3] as const).map((l) => (
            <button key={l} className={intensity === l ? "on" : ""} aria-pressed={intensity === l} onClick={() => { setIntensity(l); }}>
              {INTENSITY_NAMES[l]}
            </button>
          ))}
        </div>
      </Field>
      <div className="faint" style={{ fontSize: 12, margin: "-4px 0 10px" }}>
        {bpm} BPM · {LIBRARY_KEY} · kick on every beat · from the set
      </div>
      <Field label="Sound">
        <textarea
          rows={3}
          value={style}
          maxLength={400}
          placeholder="Genre, instruments, mood: e.g. deep house, warm saxophone, rolling bass, smoky"
          onChange={(e) => { setStyle(e.target.value); }}
        />
      </Field>
      <Field label="Lyrics (optional)">
        <textarea
          rows={4}
          value={lyrics}
          maxLength={2000}
          placeholder={"[Chorus]\nCome on! Come on!"}
          onChange={(e) => { setLyrics(e.target.value); }}
        />
      </Field>
      {(error || (problem && (name || style))) && (
        <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{error || problem}</div>
      )}
      <button className="btn primary" disabled={problem !== null || !hasKey} onClick={create}>
        {hasKey ? "Create · one Suno generation" : "Needs your kie.ai key (Skipan)"}
      </button>
    </div>
  );
}

/* --------------------------- Workout tracks ----------------------------- */

function TracksScreen({ push, pop }: { push: (r: MusicRoute) => void; pop: () => void }) {
  const { workouts, cached, failures, refresh } = useTrackCache();
  return (
    <div className="screen">
      <PageHead eyebrow="Music" title="Own tracks" onBack={pop} />
      <div className="section-label" style={{ marginTop: 0 }}>
        {workouts.filter((w) => cached.has(w.key)).length}/{workouts.length} ready
      </div>
      {workouts.map((w) => {
        const ready = cached.has(w.key);
        const failure = ready ? undefined : failures[w.key];
        return (
          <div key={w.key}>
            <button className="list-item" onClick={() => { push({ page: "track", key: w.key }); }}>
              <div>
                <div className="title">{w.name}</div>
                <div className="sub">
                  {w.profile.bpm} BPM · {w.profile.style}
                  {w.isCustom ? " · customised" : ""}
                </div>
              </div>
              <span className={`chip ${ready ? "accent" : failure ? "danger" : ""}`} style={{ flexShrink: 0 }}>
                {ready ? "Ready" : failure ? "Failed" : "No track"}
              </span>
            </button>
            {failure && (
              <TrackFailureCard
                failure={failure}
                onRetry={() => {
                  clearTrackFailure(w.key);
                  refresh();
                  void ensureAllTracks();
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TrackRoute({ trackKey, pop }: { trackKey: string; pop: () => void }) {
  const workout = workoutMusicList().find((w) => w.key === trackKey);
  if (!workout) return null;
  return (
    <div className="screen">
      <PageHead eyebrow="Music · own track" title={workout.name} onBack={pop} />
      <TrackScreen key={trackKey} workout={workout} onClose={pop} />
    </div>
  );
}

/* ------------------------------ Composer -------------------------------- */

function ComposerStatus({ status }: { status: EnsureStatus | null }) {
  if (!status || status.total === 0) return null;
  if (status.running) {
    return (
      <div className="card" style={{ marginTop: 10 }}>
        <div className="muted" style={{ fontSize: 13 }}>
          Composing tracks: {status.ready}/{status.total} ready
          {status.pending ? ` · ${status.pending} composing on the server` : ""}
          {status.current ? `, requesting: ${status.current}` : ""}…
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
          Composing happens on Suno's servers. Locking your phone or leaving
          the app is fine. Finished tracks are picked up next time Varg is
          open.
        </div>
        {status.error && <ErrorText text={status.error} />}
      </div>
    );
  }
  if (status.error) {
    return (
      <div
        className="card"
        style={{ marginTop: 10, borderColor: "var(--danger)" }}
      >
        <ErrorText text={`Composing stopped: ${status.error}`} />
        <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
          Full details are in the composer log below.
        </div>
        <button
          className="btn sm"
          style={{ marginTop: 10 }}
          onClick={() => {
            void ensureAllTracks();
          }}
        >
          Retry now
        </button>
      </div>
    );
  }
  if (status.pending) {
    return (
      <div className="card" style={{ marginTop: 10 }}>
        <div className="muted" style={{ fontSize: 13 }}>
          {status.pending} track{status.pending === 1 ? " is" : "s are"} still
          composing on Suno's servers. They're picked up automatically while
          the app is open, or check right now.
        </div>
        <button
          className="btn sm"
          style={{ marginTop: 10 }}
          onClick={() => {
            void ensureAllTracks();
          }}
        >
          Check now
        </button>
      </div>
    );
  }
  return null;
}

/** The composer's full activity log — every request, response, poll status
 * and error body, timestamped — so failures can be diagnosed on-device
 * instead of guessed at. Newest entries first. */
function ComposerLog() {
  const [entries, setEntries] = useState<MusicLogEntry[]>(readMusicLog);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(
    () =>
      onMusicLog(() => {
        setEntries(readMusicLog());
      }),
    [],
  );

  const copy = () => {
    const text = entries.map((e) => `${e.at} ${e.msg}`).join("\n");
    try {
      void navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(true);
          setTimeout(() => {
            setCopied(false);
          }, 1500);
        })
        .catch(() => undefined);
    } catch {
      // clipboard unavailable (insecure context) — nothing to do
    }
  };

  return (
    <>
      <div className="section-label">Composer log</div>
      <div className="card">
        {entries.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>
            Nothing logged yet. The composer records every request, response
            and error here.
          </div>
        ) : (
          <>
            <div
              style={{
                maxHeight: expanded ? undefined : 200,
                overflowY: "auto",
              }}
            >
              {[...entries].reverse().map((e, i) => (
                <div
                  key={`${e.at}-${String(i)}`}
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 11,
                    lineHeight: 1.5,
                    overflowWrap: "anywhere",
                  }}
                >
                  <span className="faint">
                    {new Date(e.at).toLocaleTimeString()}
                  </span>{" "}
                  {e.msg}
                </div>
              ))}
            </div>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={copy}>
                {copied ? "Copied" : "Copy log"}
              </button>
              <button
                className="btn sm"
                onClick={() => {
                  setExpanded(!expanded);
                }}
              >
                {expanded ? "Collapse" : "Expand"}
              </button>
              <button
                className="link faint"
                style={{ fontSize: 12 }}
                onClick={() => {
                  clearMusicLog();
                }}
              >
                clear
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Why a workout has no track, and the only way back. Once a workout hits
 * the attempt ceiling the composer stops spending generations on it — that
 * has to be visible, or the user just sees "No track" forever. */
function TrackFailureCard({
  failure,
  onRetry,
}: {
  failure: TrackFailure;
  onRetry: () => void;
}) {
  const capped = failure.attempts >= MAX_FAILED_ATTEMPTS;
  return (
    <div
      className="card"
      style={{ marginTop: 6, borderColor: "var(--danger)" }}
    >
      <ErrorText text={`Failed: ${failure.reason}`} />
      <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
        {failure.attempts} attempt{failure.attempts === 1 ? "" : "s"}, last{" "}
        {new Date(failure.lastAt).toLocaleString()}.{" "}
        {capped
          ? "Automatic retries are paused so it stops costing a generation every time the app opens."
          : "The composer retries this one on its own in the background."}
      </div>
      <button className="btn sm" style={{ marginTop: 10 }} onClick={onRetry}>
        Retry this track
      </button>
    </div>
  );
}

function ErrorText({ text }: { text: string }) {
  return (
    <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>
      {text}
    </div>
  );
}

/** One workout's own battle track: play it, tune its profile, compose it again. */
function TrackScreen({ workout, onClose }: { workout: WorkoutMusic; onClose: () => void }) {
  const [bpm, setBpm] = useState(String(workout.profile.bpm));
  const [style, setStyle] = useState(workout.profile.style);
  const [theme, setTheme] = useState(workout.profile.theme);
  const [track, setTrack] = useState<CachedTrack | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  useEffect(() => {
    let alive = true;
    void getCachedTrack(workout.key).then((t) => {
      if (alive) setTrack(t ?? null);
    });
    return () => {
      alive = false;
    };
  }, [workout.key]);

  const url = useMemo(
    () => (track ? URL.createObjectURL(track.blob) : null),
    [track],
  );
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  const currentProfile = (): MusicProfile | null => {
    const n = parseDecimal(bpm);
    if (n === undefined || n < 40 || n > 260) {
      setError("BPM must be a number between 40 and 260.");
      return null;
    }
    if (!style.trim() || !theme.trim()) {
      setError("Style and theme must not be empty.");
      return null;
    }
    return { bpm: Math.round(n), style: style.trim(), theme: theme.trim() };
  };

  const saveProfile = () => {
    setError("");
    const p = currentProfile();
    if (!p) return;
    saveProfileOverride(workout.key, p);
    onClose();
  };

  const regenerate = async () => {
    setError("");
    const p = currentProfile();
    if (!p) return;
    const settings = loadMusicSettings();
    if (!settings.apiKey) {
      setError("No API key set. Add it in the Suno section first.");
      return;
    }
    saveProfileOverride(workout.key, p);
    setBusy(true);
    // The delete is load-bearing: leaving the old track cached makes the
    // background composer prune the new pending task, and generateTrack then
    // returns the old track as a success — a burned credit with no error.
    // So the paid track is stashed and restored if the new one never lands.
    const previous = track;
    try {
      await deleteCachedTrack(workout.key);
      setTrack(null);
      setTrack(
        await generateTrack(workout.key, workout.name, p, settings, setStatusMsg),
      );
    } catch (e) {
      if (previous) {
        await putCachedTrack(previous);
        setTrack(previous);
      }
      setError(e instanceof Error ? e.message : "Track generation failed.");
    } finally {
      setBusy(false);
      setStatusMsg("");
    }
  };

  const resetToDefault = () => {
    clearProfileOverride(workout.key);
    onClose();
  };

  return (
    <div className="card">
      {track && url && (
        <div style={{ marginBottom: 14 }}>
          <audio controls src={url} style={{ width: "100%" }} />
          <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
            "{track.title}" · composed {track.createdAt.slice(0, 10)}
          </div>
        </div>
      )}
      {!track && !busy && (
        <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          No track composed yet.
        </div>
      )}

      <Field label="BPM">
        <input
          inputMode="numeric"
          value={bpm}
          onChange={(e) => {
            setBpm(e.target.value);
          }}
        />
      </Field>
      <Field label="Style (genre, instrumentation)">
        <input
          value={style}
          onChange={(e) => {
            setStyle(e.target.value);
          }}
        />
      </Field>
      <Field label="Theme (what the track is about)">
        <textarea
          rows={3}
          value={theme}
          onChange={(e) => {
            setTheme(e.target.value);
          }}
        />
      </Field>

      {busy ? (
        <div className="muted" style={{ fontSize: 13, margin: "8px 0" }}>
          {statusMsg ||
            "Composing on Suno's servers, usually 1–3 minutes. Locking your phone is fine."}
        </div>
      ) : (
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn grow" onClick={saveProfile}>
            Save profile
          </button>
          <button
            className="btn primary grow"
            onClick={() => {
              // Validate before asking: a bad BPM should say so, not open a
              // dialog that promises to spend a generation.
              setError("");
              if (currentProfile()) setConfirmRegen(true);
            }}
          >
            <IconMusic /> Regenerate
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            color: "var(--danger)",
            fontSize: 13,
            fontWeight: 700,
            marginTop: 10,
          }}
        >
          {error}
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 14 }}>
        {workout.isCustom && (
          <button className="link faint" style={{ fontSize: 12 }} onClick={resetToDefault}>
            reset to default profile
          </button>
        )}
        {track && !busy && (
          <button
            className="link faint"
            style={{ fontSize: 12, color: "var(--danger)" }}
            onClick={() => {
              setConfirmDelete(true);
            }}
          >
            delete track
          </button>
        )}
      </div>

      {confirmRegen && (
        <ConfirmSheet
          title="Regenerate track"
          message={
            track
              ? `Compose a new track for "${workout.name}"? That costs one Suno generation and replaces the current track; the current one is kept if the new one fails.`
              : `Compose a track for "${workout.name}"? That costs one Suno generation.`
          }
          confirmLabel="Regenerate"
          danger={false}
          onConfirm={() => {
            void regenerate();
          }}
          onClose={() => {
            setConfirmRegen(false);
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmSheet
          title="Delete track"
          message={`Delete the composed track for "${workout.name}"? It will be re-composed on the next background run.`}
          confirmLabel="Delete"
          onConfirm={() => {
            void deleteCachedTrack(workout.key).then(() => {
              setTrack(null);
            });
          }}
          onClose={() => {
            setConfirmDelete(false);
          }}
        />
      )}
    </div>
  );
}
