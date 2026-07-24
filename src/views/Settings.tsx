import { useCallback, useEffect, useMemo, useState } from "react";
import type { Tab } from "../App";
import type { MusicProfile } from "../types";
import {
  SUNO_MODELS,
  clearProfileOverride,
  deleteCachedTrack,
  ensureAllTracks,
  generateTrack,
  getCachedTrack,
  loadMusicSettings,
  onEnsureStatus,
  saveMusicSettings,
  saveProfileOverride,
  workoutMusicList,
  type CachedTrack,
  type EnsureStatus,
  type WorkoutMusic,
} from "../lib/music";
import { ConfirmSheet, Field, Sheet } from "../components/ui";
import { IconChevron, IconMusic } from "../components/icons";

export default function Settings({ goto }: { goto: (t: Tab) => void }) {
  const [settings, setSettings] = useState(loadMusicSettings);
  const [status, setStatus] = useState<EnsureStatus | null>(null);
  const [workouts, setWorkouts] = useState<WorkoutMusic[]>(workoutMusicList);
  const [cached, setCached] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<WorkoutMusic | null>(null);

  useEffect(() => onEnsureStatus(setStatus), []);

  const refresh = useCallback(() => {
    void (async () => {
      const list = workoutMusicList();
      const have = new Set<string>();
      for (const w of list) {
        if (await getCachedTrack(w.key)) have.add(w.key);
      }
      setWorkouts(list);
      setCached(have);
    })();
  }, []);

  // Re-check the cache whenever the background composer reports progress.
  useEffect(() => {
    refresh();
  }, [refresh, status?.ready, status?.running]);

  const save = () => {
    saveMusicSettings(settings);
    void ensureAllTracks();
  };

  return (
    <div className="screen">
      <div className="eyebrow">Settings</div>
      <h2 className="screen-title">Settings</h2>

      <div className="section-label">Suno</div>
      <div className="card">
        <Field label="API key">
          <input
            spellCheck={false}
            value={settings.apiKey}
            placeholder="Your gateway API key"
            onChange={(e) => {
              setSettings({ ...settings, apiKey: e.target.value });
            }}
          />
        </Field>
        <Field label="Gateway URL">
          <input
            spellCheck={false}
            value={settings.baseUrl}
            onChange={(e) => {
              setSettings({ ...settings, baseUrl: e.target.value });
            }}
          />
        </Field>
        <Field label="Model">
          <select
            value={settings.model}
            onChange={(e) => {
              setSettings({ ...settings, model: e.target.value });
            }}
          >
            {SUNO_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <div className="muted" style={{ fontSize: 13, margin: "4px 0 10px" }}>
          Suno has no official public API — generation goes through a gateway
          (default: sunoapi.org) with your own key. Tracks are composed in the
          background and cached on this device, one generation per workout.
        </div>
        <button className="btn primary" onClick={save}>
          Save & compose missing tracks
        </button>
      </div>

      <ComposerStatus status={status} />

      <div className="section-label">
        Battle tracks · {cached.size}/{workouts.length} ready
      </div>
      {workouts.map((w) => (
        <button
          key={w.key}
          className="list-item"
          onClick={() => {
            setEditing(w);
          }}
        >
          <div>
            <div className="title">{w.name}</div>
            <div className="sub">
              {w.profile.bpm} BPM · {w.profile.style}
              {w.isCustom ? " · customised" : ""}
            </div>
          </div>
          <span
            className={`chip ${cached.has(w.key) ? "accent" : ""}`}
            style={{ flexShrink: 0 }}
          >
            {cached.has(w.key) ? "Ready" : "No track"}
          </span>
        </button>
      ))}

      <div className="section-label">Navigation</div>
      <button className="list-item" onClick={() => { goto("home"); }}>
        <div className="title">Back to Den</div>
        <IconChevron />
      </button>

      {editing && (
        <WorkoutMusicSheet
          workout={editing}
          hasTrack={cached.has(editing.key)}
          onClose={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** Composer state, loudly: progress while running, red error when broken. */
function ComposerStatus({ status }: { status: EnsureStatus | null }) {
  if (!status || status.total === 0) return null;
  if (status.running) {
    return (
      <div className="card" style={{ marginTop: 10 }}>
        <div className="muted" style={{ fontSize: 13 }}>
          Composing tracks: {status.ready}/{status.total} ready
          {status.current ? ` — now: ${status.current}` : ""}…
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
  return null;
}

function ErrorText({ text }: { text: string }) {
  return (
    <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>
      {text}
    </div>
  );
}

function WorkoutMusicSheet({
  workout,
  hasTrack,
  onClose,
}: {
  workout: WorkoutMusic;
  hasTrack: boolean;
  onClose: () => void;
}) {
  const [bpm, setBpm] = useState(String(workout.profile.bpm));
  const [style, setStyle] = useState(workout.profile.style);
  const [theme, setTheme] = useState(workout.profile.theme);
  const [track, setTrack] = useState<CachedTrack | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    const n = Number(bpm);
    if (!Number.isFinite(n) || n < 40 || n > 260) {
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
      setError("No API key set — add it in the Suno section first.");
      return;
    }
    saveProfileOverride(workout.key, p);
    setBusy(true);
    try {
      await deleteCachedTrack(workout.key);
      setTrack(null);
      setTrack(
        await generateTrack(workout.key, workout.name, p, settings, setStatusMsg),
      );
    } catch (e) {
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
    <Sheet title={workout.name} onClose={onClose}>
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
          {hasTrack ? "Loading track…" : "No track composed yet."}
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
          {statusMsg || "Composing — usually takes 1–3 minutes…"}
        </div>
      ) : (
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn grow" onClick={saveProfile}>
            Save profile
          </button>
          <button
            className="btn primary grow"
            onClick={() => {
              void regenerate();
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
    </Sheet>
  );
}
