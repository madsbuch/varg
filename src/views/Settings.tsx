import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SUNO_MODELS,
  ensureAllTracks,
  loadMusicSettings,
  onEnsureStatus,
  saveMusicSettings,
  type EnsureStatus,
} from "../lib/music";
import { SETS } from "../lib/songs";
import { MusicScreen, type MusicRoute } from "./Music";
import { choiceLabel } from "../components/MusicPicker";
import { loadDefaultChoice } from "../lib/music-choice";
import { useBackHandler } from "../lib/back";
import { scrollContentTop } from "../lib/scroll";
import type { VoiceRole } from "../lib/wod";
import { loadFtp, saveFtp, targetWatts } from "../lib/ride";
import { loadBike, saveBike } from "../lib/bike";
import { BikePicker } from "../components/BikeConnect";
import { StrapPicker } from "../components/HeartRate";
import { disconnectStrap, HR_ZONE_NAMES, hrZonesProblem, loadHrZones, loadStrap, saveHrZones, saveStrap, stopHrService, zonesFromMax } from "../lib/hr";
import type { HrZones } from "../lib/hr";
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
import { Field, Segmented } from "../components/ui";
import { loadTheme, saveTheme, type ThemeChoice } from "../lib/theme";
import { loadGarminKey, saveGarminKey, setFollowFtp, syncGarmin, useGarmin } from "../lib/garmin";
import { formatDate, formatRelative } from "../lib/units";
import { IconCheck } from "../components/icons";

export default function Settings() {
  const [settings, setSettings] = useState(loadMusicSettings);
  const [status, setStatus] = useState<EnsureStatus | null>(null);
  // The music screens, as a stack on top of this page: Back pops one.
  const [stack, setStack] = useState<MusicRoute[]>([]);
  const push = useCallback((r: MusicRoute) => { setStack((s) => [...s, r]); }, []);
  const pop = useCallback(() => { setStack((s) => s.slice(0, -1)); }, []);
  useBackHandler(stack.length > 0, useCallback(() => { pop(); return true; }, [pop]));
  const route = stack[stack.length - 1];
  useEffect(() => { scrollContentTop(); }, [route]);

  useEffect(() => onEnsureStatus(setStatus), []);

  const save = () => {
    saveMusicSettings(settings);
    void ensureAllTracks();
    // The voice lines use the same key; their errors show in the Voice card.
    ensureVoiceClips().catch(() => undefined);
  };

  if (route) return <MusicScreen route={route} push={push} pop={pop} />;

  return (
    <div className="screen">
      <div className="eyebrow">Skipan · Old Norse for order</div>
      <h2 className="screen-title">Settings</h2>

      <ThemeSetting />

      <div className="section-label">Music</div>
      <button className="list-item" onClick={() => { push({ page: "music" }); }}>
        <div>
          <div className="title">Music</div>
          <div className="sub">
            Default · {choiceLabel(loadDefaultChoice())} · {SETS.map((s) => s.name).join(" · ")} · own tracks
            {status?.running ? ` · composing ${String(status.ready)}/${String(status.total)}` : ""}
          </div>
        </div>
        {status?.error ? <span className="chip danger">Error</span> : <span className="chip">›</span>}
      </button>

      <GpsSetting />

      <GarminSetting />

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
    </div>
  );
}

/**
 * Garmin Connect through the Personal API key. Everything it pulls is
 * read-only and cached; failures stay on screen in red until a sync works.
 */
function GarminSetting() {
  const garmin = useGarmin();
  const [key, setKey] = useState(loadGarminKey);
  const saved = loadGarminKey();
  const dirty = key.trim() !== saved;

  return (
    <>
      <div className="section-label">Garmin</div>
      <div className="card">
        <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
          Create a personal API key in Garmin Connect (Settings, Personal API
          Key) and paste it here. Varg reads your FTP, watch activities, heart
          rate and last night's sleep, HRV and Body Battery. It never writes to
          Garmin. Keys expire after the period you chose there.
        </div>
        <Field label="Personal API key">
          <input
            spellCheck={false}
            autoComplete="off"
            value={key}
            placeholder="Garmin personal API key"
            onChange={(e) => { setKey(e.target.value); }}
          />
        </Field>
        <div className="btn-row">
          <button
            className="btn primary"
            disabled={!dirty && (!saved || garmin.syncing)}
            onClick={() => {
              if (dirty) saveGarminKey(key);
              void syncGarmin(true);
            }}
          >
            {dirty ? (key.trim() ? "Save & sync" : "Disconnect") : garmin.syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
        {saved && (
          <div style={{ fontSize: 13, marginTop: 10 }}>
            {garmin.error ? (
              <div style={{ color: "var(--danger)" }}>
                Sync failed: {garmin.error}
                {garmin.lastSync && ` Showing data from ${formatRelative(garmin.lastSync)}.`}
              </div>
            ) : garmin.lastSync ? (
              <div className="muted">
                Synced {formatRelative(garmin.lastSync)} · {garmin.activities.length} watch activities
              </div>
            ) : (
              <div className="muted">{garmin.syncing ? "First sync, fetching a year of activities…" : "Not synced yet."}</div>
            )}
            {garmin.readiness && garmin.readiness.errors.length > 0 && (
              <div style={{ color: "var(--danger)", marginTop: 4 }}>
                {garmin.readiness.errors.join(" · ")}
              </div>
            )}
          </div>
        )}
      </div>
    </>
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
  const garmin = useGarmin();
  const hasGarmin = loadGarminKey() !== "";
  const fromGarmin = hasGarmin && garmin.followFtp && garmin.ftp;
  const [ftpText, setFtpText] = useState(() => String(loadFtp()));
  const [bike, setBike] = useState(loadBike);
  const [changing, setChanging] = useState(false);
  const ftp = Number(ftpText);
  const ftpValid = Number.isInteger(ftp) && ftp >= 50 && ftp <= 600;

  return (
    <>
      <div className="section-label">Cycling</div>
      <div className="card">
        {fromGarmin ? (
          <Field label="FTP (watts)">
            <div className="btn-row">
              <div style={{ flex: 1, alignSelf: "center" }}>
                <strong style={{ fontSize: 20 }}>{garmin.ftp?.watts} W</strong>
                <div className="muted" style={{ fontSize: 13 }}>
                  From Garmin: {garmin.ftp?.activityName}, {formatDate(new Date(garmin.ftp?.rideStart ?? 0).toISOString())}
                </div>
              </div>
              <button
                className="btn sm ghost"
                style={{ width: "auto" }}
                onClick={() => {
                  setFollowFtp(false);
                  setFtpText(String(loadFtp()));
                }}
              >
                Set by hand
              </button>
            </div>
          </Field>
        ) : (
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
          {hasGarmin && !garmin.followFtp && (
            <button
              className="btn sm ghost"
              style={{ marginTop: 8 }}
              onClick={() => {
                setFollowFtp(true);
                setFtpText(String(loadFtp()));
              }}
            >
              Take FTP from Garmin
            </button>
          )}
        </Field>
        )}
        {fromGarmin === false && hasGarmin && garmin.followFtp && garmin.ftpError && (
          <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 8 }}>
            No FTP from Garmin: {garmin.ftpError}. Rides use {loadFtp()} W.
          </div>
        )}
        {!fromGarmin && !ftpValid && (
          <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 8 }}>
            FTP must be a whole number of watts between 50 and 600; rides use {loadFtp()} W until then.
          </div>
        )}
        <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
          Every ride target is a share of this.
          {!hasGarmin
            ? " Connect Garmin above to have it follow your watch, or change it here when your FTP changes."
            : garmin.followFtp
              ? " It follows the FTP on your newest ride on Garmin."
              : " Set by hand: Garmin's FTP is not used."}
          {" "}Zone 2 is
          {fromGarmin || ftpValid
            ? ` ${targetWatts({ label: "Zone 2", ftp: [56, 75], seconds: 1 }, fromGarmin ? (garmin.ftp?.watts ?? ftp) : ftp).join("–")} W.`
            : " 56–75 %."}
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
        <Field label="Source">
          <div className="btn-row">
            <div style={{ flex: 1, alignSelf: "center" }}>
              {strap ? <strong>{strap.name}</strong> : <span className="muted">None paired</span>}
            </div>
            {strap && !changing && (
              <button className="btn sm" style={{ width: "auto" }} onClick={() => { setChanging(true); }}>Change</button>
            )}
            {strap && (
              <button className="btn sm ghost" style={{ width: "auto" }} onClick={() => {
                saveStrap(null);
                setStrap(null);
                setChanging(false);
                // Forgotten means released now, not after the idle timeout.
                void stopHrService().catch(() => undefined);
                void disconnectStrap().catch(() => undefined);
              }}>
                Forget
              </button>
            )}
          </div>
        </Field>
        {(!strap || changing) && (
          <StrapPicker onPicked={(s) => { setStrap(s); setChanging(false); }} />
        )}
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>Any Bluetooth heart rate: band or watch broadcast</div>
      </div>
      <HrZonesCard />
    </>
  );
}

/**
 * The heart-rate zones rides are steered by. Typed in from Garmin Connect
 * (User Settings → Heart Rate Zones), so Varg's zone 2 is the watch's zone 2
 * and time in zone agrees with Connect afterwards.
 */
function HrZonesCard() {
  const saved = loadHrZones();
  const [text, setText] = useState<string[]>(() =>
    saved ? [...saved.floors, saved.max].map(String) : ["", "", "", "", "", ""],
  );
  const zones: HrZones = {
    floors: [Number(text[0]), Number(text[1]), Number(text[2]), Number(text[3]), Number(text[4])],
    max: Number(text[5]),
  };
  const empty = text.every((t) => t.trim() === "");
  const problem = empty ? null : hrZonesProblem(zones);
  const set = (i: number, v: string) => {
    const next = text.map((t, k) => (k === i ? v.replace(/[^0-9]/g, "") : t));
    setText(next);
    const z: HrZones = {
      floors: [Number(next[0]), Number(next[1]), Number(next[2]), Number(next[3]), Number(next[4])],
      max: Number(next[5]),
    };
    if (hrZonesProblem(z) === null) saveHrZones(z);
  };
  const fromMax = () => {
    const max = Number(text[5]);
    if (!Number.isInteger(max) || max < 100 || max > 230) return;
    const z = zonesFromMax(max);
    setText([...z.floors, z.max].map(String));
    saveHrZones(z);
  };

  return (
    <div className="card" style={{ marginTop: 10 }}>
      <strong>Heart-rate zones</strong>
      <div className="muted" style={{ fontSize: 13, margin: "4px 0 10px" }}>From Garmin Connect → Heart Rate Zones</div>
      <div className="hr-zones-grid">
        {HR_ZONE_NAMES.map((name, i) => (
          <label key={name}>
            <span>Z{i + 1} {name}</span>
            <input inputMode="numeric" placeholder="from bpm" value={text[i]} onChange={(e) => { set(i, e.target.value); }} />
          </label>
        ))}
        <label>
          <span>Max HR</span>
          <input inputMode="numeric" placeholder="bpm" value={text[5]} onChange={(e) => { set(5, e.target.value); }} />
        </label>
      </div>
      {problem && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{problem}</div>}
      {empty && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>No zones · HR rides won't start</div>}
      <button className="btn sm ghost" style={{ width: "auto", marginTop: 8 }} disabled={!(Number(text[5]) >= 100 && Number(text[5]) <= 230)} onClick={fromMax}>
        Fill from max HR
      </button>
    </div>
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
