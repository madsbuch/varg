import { useCallback, useEffect, useMemo, useState } from "react";
import type { MusicProfile } from "../types";
import {
  MAX_FAILED_ATTEMPTS,
  SUNO_MODELS,
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
  saveMusicSettings,
  saveProfileOverride,
  workoutMusicList,
  type CachedTrack,
  type EnsureStatus,
  type MusicLogEntry,
  type TrackFailure,
  type WorkoutMusic,
} from "../lib/music";
import { parseDecimal } from "../lib/units";
import type { VoiceRole } from "../lib/wod";
import { loadFtp, saveFtp, targetWatts } from "../lib/ride";
import { loadBike, saveBike } from "../lib/bike";
import { BikePicker } from "../components/BikeConnect";
import { StrapPicker } from "../components/HeartRate";
import { loadStrap, saveStrap } from "../lib/hr";
import { gpsAvailable, loadGpsEnabled, requestGpsPermission, saveGpsEnabled } from "../lib/gps";
import {
  VOICE_MODELS,
  isGemini,
  previewLine,
  voicesFor,
  allVoiceLines,
  voiceIdFor,
  countReady,
  ensureVoiceClips,
  loadVoiceSettings,
  onVoiceProgress,
  previewUrl,
  saveVoiceSettings,
} from "../lib/voice-clips";
import { ConfirmSheet, Field, Segmented, Sheet } from "../components/ui";
import { loadTheme, saveTheme, type ThemeChoice } from "../lib/theme";
import { IconCheck, IconMusic } from "../components/icons";

export default function Settings() {
  const [settings, setSettings] = useState(loadMusicSettings);
  const [status, setStatus] = useState<EnsureStatus | null>(null);
  const [workouts, setWorkouts] = useState<WorkoutMusic[]>(workoutMusicList);
  const [cached, setCached] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<Record<string, TrackFailure>>(
    loadTrackFailures,
  );
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
      setFailures(loadTrackFailures());
    })();
  }, []);

  // Re-check the cache whenever the background composer reports progress.
  useEffect(() => {
    refresh();
  }, [refresh, status?.ready, status?.running, status?.error]);

  const save = () => {
    saveMusicSettings(settings);
    void ensureAllTracks();
    // The voice lines use the same key; their errors show in the Voice card.
    ensureVoiceClips().catch(() => undefined);
  };

  return (
    <div className="screen">
      <div className="eyebrow">Skipan · Old Norse for order</div>
      <h2 className="screen-title">Settings</h2>

      <ThemeSetting />

      <GpsSetting />

      <CyclingSetting />

      <HeartRateSetting />

      <div className="section-label">kie.ai: music &amp; voice</div>
      <div className="card">
        <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
          One key from kie.ai pays for both the Suno battle tracks and the
          spoken cues in the guided workouts. Everything is generated once and
          kept on this device; workouts never need the network.
        </div>
        <Field label="kie.ai API key">
          <input
            spellCheck={false}
            value={settings.apiKey}
            placeholder="Your kie.ai API key"
            onChange={(e) => {
              setSettings({ ...settings, apiKey: e.target.value });
            }}
          />
        </Field>
        <Field label="Suno model">
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
          Tracks compose on kie.ai's servers: once the requests are sent you
          can lock your phone or leave the app, and finished tracks are picked
          up next time Varg is open. One generation per workout.
        </div>
        <button className="btn primary" onClick={save}>
          Save & generate what's missing
        </button>
      </div>

      <VoiceSetting
        hasKey={settings.apiKey.trim() !== ""}
        saveKey={() => { saveMusicSettings(settings); }}
      />

      <ComposerStatus status={status} />

      <div className="section-label">
        Battle tracks · {cached.size}/{workouts.length} ready
      </div>
      {workouts.map((w) => {
        const ready = cached.has(w.key);
        const failure = ready ? undefined : failures[w.key];
        return (
          <div key={w.key}>
            <button
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
                className={`chip ${ready ? "accent" : failure ? "danger" : ""}`}
                style={{ flexShrink: 0 }}
              >
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

      <ComposerLog />

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

/** Light, dark, or follow the phone. Applies at once. */
function ThemeSetting() {
  const [theme, setTheme] = useState<ThemeChoice>(loadTheme);
  return (
    <>
      <div className="section-label" style={{ marginTop: 0 }}>Appearance</div>
      <div className="card">
        <Segmented
          value={theme}
          options={[
            { value: "system", label: "Phone" },
            { value: "light", label: "Day" },
            { value: "dark", label: "Night" },
          ]}
          onChange={(v) => {
            setTheme(v);
            saveTheme(v);
          }}
        />
        <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          Phone follows the system setting: light by day, dark when the phone is.
        </div>
      </div>
    </>
  );
}

/**
 * The voice for spoken cues (Gemini by default), through the shared kie.ai key.
 * Lines are generated once and cached on the device; until they are, the
 * phone's own voice stands in.
 */
function VoiceSetting({ hasKey, saveKey }: { hasKey: boolean; saveKey: () => void }) {
  const [settings, setSettings] = useState(loadVoiceSettings);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState(0);
  const total = useMemo(() => allVoiceLines().length, []);

  const refreshCount = useCallback(() => {
    void countReady().then(setReady).catch(() => undefined);
  }, []);
  useEffect(() => { refreshCount(); }, [refreshCount, settings]);
  // Generation may be started by the key card's Save, or on app open.
  useEffect(() => onVoiceProgress((r) => { setReady(r); }), []);

  const change = (next: typeof settings) => {
    setSettings(next);
    saveVoiceSettings(next);
  };

  const generate = () => {
    // The key typed above counts even if its card was not saved first.
    saveKey();
    saveVoiceSettings(settings);
    setBusy("Generating lines on kie.ai…");
    setProblem(null);
    ensureVoiceClips((r) => { setReady(r); })
      .catch((e: unknown) => { setProblem(e instanceof Error ? e.message : String(e)); })
      .finally(() => { setBusy(null); refreshCount(); });
  };

  const play = (src: string, revoke = false) => {
    const a = new Audio(src);
    if (revoke) a.onended = () => { URL.revokeObjectURL(src); };
    return a.play();
  };
  const hear = (role: VoiceRole) => {
    setProblem(null);
    if (!isGemini(settings.model)) {
      // ElevenLabs voices have free samples on kie's CDN.
      play(previewUrl(voiceIdFor(settings, role))).catch((e: unknown) => {
        setProblem(`Could not play the sample: ${e instanceof Error ? e.message : String(e)}`);
      });
      return;
    }
    // Gemini has none: generate a real line (a fraction of a credit).
    saveKey();
    setBusy("Speaking a sample on kie.ai…");
    previewLine(settings, role, role === "yoga" ? "Next: Warrior two, left side" : "Next: Push-up")
      .then((blob) => play(URL.createObjectURL(blob), true))
      .catch((e: unknown) => { setProblem(e instanceof Error ? e.message : String(e)); })
      .finally(() => { setBusy(null); });
  };
  const { voices } = voicesFor(settings.model);

  const picker = (role: VoiceRole, label: string) => (
    <Field label={label}>
      <div className="btn-row">
        <select
          value={voiceIdFor(settings, role)}
          onChange={(e) => {
            change(role === "yoga" ? { ...settings, voiceId: e.target.value } : { ...settings, workoutVoiceId: e.target.value });
          }}
          style={{ flex: 1 }}
        >
          {voices.map((v) => (
            <option key={v.voiceId} value={v.voiceId}>
              {v.name}{v.description ? `: ${v.description}` : ""}
            </option>
          ))}
        </select>
        <button className="btn sm" style={{ width: "auto" }} disabled={busy !== null || (isGemini(settings.model) && !hasKey)} onClick={() => { hear(role); }}>
          Hear
        </button>
      </div>
    </Field>
  );

  return (
    <>
      <div className="section-label">Voice · {ready}/{total} lines ready</div>
      <div className="card">
        <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
          The guided workouts name what comes next: each pose in the yoga
          flows, each station in the interval workouts. Two voices: calm for
          yoga, firm for training. Lines not generated yet are read by the
          phone's own voice.
        </div>
        <Field label="Voice model">
          <select
            value={settings.model}
            onChange={(e) => {
              // Each model has its own voices; keep a voice only if it exists there.
              const model = e.target.value;
              const keep = (id: string, role: VoiceRole) => {
                const { voices: vs, fallback } = voicesFor(model, role);
                return vs.some((v) => v.voiceId === id) ? id : fallback;
              };
              change({ model, voiceId: keep(settings.voiceId, "yoga"), workoutVoiceId: keep(settings.workoutVoiceId, "workout") });
            }}
          >
            {VOICE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Field>
        {picker("yoga", "Yoga voice")}
        {picker("workout", "Workout voice")}
        <button className="btn primary" disabled={!hasKey || busy !== null} onClick={generate}>
          Generate voice lines
        </button>
        {!hasKey && (
          <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            Add and save your kie.ai key above first.
          </div>
        )}
        {busy && <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>{busy}</div>}
        {problem && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{problem}</div>}
      </div>
    </>
  );
}

/**
 * Cycling: the FTP every ride's watt targets are computed from, and the
 * paired bike. Pairing scans for bikes advertising FTMS or Cycling Power;
 * the chosen one connects automatically when a ride starts.
 */
function CyclingSetting() {
  const [ftpText, setFtpText] = useState(() => String(loadFtp()));
  const [bike, setBike] = useState(loadBike);
  const [changing, setChanging] = useState(false);
  const ftp = Number(ftpText);
  const ftpValid = Number.isInteger(ftp) && ftp >= 50 && ftp <= 600;

  return (
    <>
      <div className="section-label">Cycling</div>
      <div className="card">
        <Field label="FTP (watts)">
          <input
            inputMode="numeric"
            value={ftpText}
            onChange={(e) => {
              setFtpText(e.target.value);
              const v = Number(e.target.value);
              if (Number.isInteger(v) && v >= 50 && v <= 600) saveFtp(v);
            }}
          />
        </Field>
        {!ftpValid && (
          <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 8 }}>
            FTP must be a whole number of watts between 50 and 600; rides use {loadFtp()} W until then.
          </div>
        )}
        <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
          Every ride target is a share of this, so when your Garmin's FTP
          estimate changes, change it here. Zone 2 is
          {ftpValid ? ` ${targetWatts({ label: "Zone 2", ftp: [56, 75], seconds: 1 }, ftp).join("–")} W.` : " 56–75 %."}
        </div>
        <Field label="Bike">
          <div className="btn-row">
            <div style={{ flex: 1, alignSelf: "center" }}>
              {bike ? <strong>{bike.name}</strong> : <span className="muted">No bike paired</span>}
            </div>
            {bike && !changing && (
              <button className="btn sm" style={{ width: "auto" }} onClick={() => { setChanging(true); }}>Change</button>
            )}
            {bike && (
              <button className="btn sm ghost" style={{ width: "auto" }} onClick={() => { saveBike(null); setBike(null); setChanging(false); }}>
                Forget
              </button>
            )}
          </div>
        </Field>
        {(!bike || changing) && (
          <BikePicker onPicked={(b) => { setBike(b); setChanging(false); }} />
        )}
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          Varg reads power, cadence and kcal straight from the bike. Most
          bikes accept one app at a time, so close Body Bike or Mowl first.
        </div>
      </div>
    </>
  );
}

/**
 * Heart rate: the paired chest strap. Pairing scans for the standard Heart
 * Rate Service; the chosen strap connects whenever a guided workout or a
 * ride starts, and the session is saved with its heart rate.
 */
function HeartRateSetting() {
  const [strap, setStrap] = useState(loadStrap);
  const [changing, setChanging] = useState(false);
  return (
    <>
      <div className="section-label">Heart rate</div>
      <div className="card">
        <Field label="Strap">
          <div className="btn-row">
            <div style={{ flex: 1, alignSelf: "center" }}>
              {strap ? <strong>{strap.name}</strong> : <span className="muted">No strap paired</span>}
            </div>
            {strap && !changing && (
              <button className="btn sm" style={{ width: "auto" }} onClick={() => { setChanging(true); }}>Change</button>
            )}
            {strap && (
              <button className="btn sm ghost" style={{ width: "auto" }} onClick={() => { saveStrap(null); setStrap(null); setChanging(false); }}>
                Forget
              </button>
            )}
          </div>
        </Field>
        {(!strap || changing) && (
          <StrapPicker onPicked={(s) => { setStrap(s); setChanging(false); }} />
        )}
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          Any Bluetooth chest strap: Garmin HRM 600, HRM-Pro or HRM-Dual,
          Polar H10. ANT+-only straps such as the HRM-Tri cannot reach a
          phone. Your watch keeps reading the strap over ANT+ at the same
          time. Guided workouts and rides record heart rate while the phone
          is locked.
        </div>
      </div>
    </>
  );
}

/**
 * The optional GPS for run stages. Turning it on asks for location
 * permission there and then, so a refusal surfaces here — not mid-workout
 * as a run that silently never completes.
 */
function GpsSetting() {
  const [on, setOn] = useState(loadGpsEnabled);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const available = gpsAvailable();

  const toggle = () => {
    if (on) {
      setOn(false);
      saveGpsEnabled(false);
      setProblem(null);
      return;
    }
    setBusy(true);
    setProblem(null);
    requestGpsPermission()
      .then((state) => {
        if (state === "granted") {
          setOn(true);
          saveGpsEnabled(true);
        } else {
          setProblem(
            "Location permission was not granted, so GPS stays off. Allow location for Varg in Android settings, then try again.",
          );
        }
      })
      .catch((e: unknown) => {
        setProblem(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { setBusy(false); });
  };

  return (
    <>
      <div className="section-label">GPS</div>
      <div className="card">
        <div className="row" style={{ alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <strong>GPS for runs</strong>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              In for-time workouts (Murph's runs), measure distance and pace,
              and complete the run stage automatically when you reach the
              distance. Keeps measuring with the phone locked; a
              notification shows while it does, and the phone buzzes when
              the distance is reached.
            </div>
          </div>
          <button
            className={`check ${on ? "on" : ""}`}
            role="switch"
            aria-checked={on}
            aria-label="GPS for runs"
            disabled={!available || busy}
            onClick={toggle}
            style={{ flexShrink: 0 }}
          >
            {on && <IconCheck />}
          </button>
        </div>
        {!available && (
          <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            Only available in the Android app.
          </div>
        )}
        {problem && (
          <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{problem}</div>
        )}
      </div>
    </>
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
    </Sheet>
  );
}
