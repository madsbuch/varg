/**
 * Fullscreen indoor-bike ride: segments against live power, cadence and
 * kcal from the bike over Bluetooth.
 *
 * Timing is wall-clock anchored like the other players. The bike is polled
 * twice a second; every packet feeds the RideMeter, and the RideRun turns
 * the clock and the meter into segment changes. A kcal segment ends itself
 * on the bike's numbers — and when there are no numbers (no bike, a
 * dropout), the player says so in red and offers Done, never a silent stall.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../lib/app-context";
import { deleteSession, upsertSession } from "../lib/store";
import { useBackHandler } from "../lib/back";
import { cueFinish, cueTick, cueWork, unlockAudio } from "../lib/beep";
import { formatSeconds } from "../lib/units";
import { RideMeter, connectBike, loadBike, readBike } from "../lib/bike";
import type { BikeRead } from "../lib/bike";
import {
  bestRide, fit, loadFtp, recordedRide, rideLine, RideRun, shownAmount, targetWatts, zoneOf,
} from "../lib/ride";
import type { RideConfig } from "../lib/ride";
import { EX } from "../lib/seed";
import { loadVoiceOn, saveVoiceOn, speak } from "../lib/voice";
import { playClip, prepareClips } from "../lib/voice-clips";
import ExerciseAnim from "./ExerciseAnim";
import { IconCheck, IconClose, IconVoice } from "./icons";
import { useBattleTrack, useWorkoutWakeLock } from "./battle-track";

const LEAD_IN = 10;
/** Speak the next segment this long before a timed segment ends. */
const ANNOUNCE_AHEAD = 10;

interface Clock {
  anchor: number;
  pausedAt: number | null;
}
const rideTime = (c: Clock, now: number) => Math.max(0, ((c.pausedAt ?? now) - c.anchor) / 1000 - LEAD_IN);
const rawTime = (c: Clock, now: number) => ((c.pausedAt ?? now) - c.anchor) / 1000;

/** What the screen shows; a snapshot taken by the poll loop, not computed in render. */
interface View {
  raw: number;
  t: number;
  idx: number;
  segElapsed: number;
  segKcal: number;
  power: number;
  cadence: number;
  kcal: number;
  bike: BikeRead["state"] | "none";
  bikeName: string;
  bikeError?: string | undefined;
  live: boolean;
}

export default function RidePlayer({ config, onClose }: { config: RideConfig; onClose: () => void }) {
  const { data, update } = useApp();
  const [ftp] = useState(loadFtp);
  const [clock, setClock] = useState<Clock>(() => ({ anchor: Date.now(), pausedAt: null }));
  const clockRef = useRef(clock);
  useEffect(() => { clockRef.current = clock; }, [clock]);
  const [startedAt] = useState(() => new Date().toISOString());
  const meter = useRef(new RideMeter());
  const run = useRef(new RideRun(config.segments, ftp));
  const [view, setView] = useState<View>({ raw: 0, t: 0, idx: 0, segElapsed: 0, segKcal: 0, power: 0, cadence: 0, kcal: 0, bike: "none", bikeName: "", live: false });
  const [stopped, setStopped] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const loggedId = useRef<string | null>(null);
  const [discarded, setDiscarded] = useState(false);
  const [voiceOn, setVoiceOn] = useState(loadVoiceOn);
  const saved = useMemo(loadBike, []);
  const [bikeBusy, setBikeBusy] = useState(saved !== null);

  const paused = clock.pausedAt !== null;
  const finished = view.idx >= config.segments.length;
  const done = finished || stopped;
  const ready = view.raw < LEAD_IN;
  const seg = config.segments[Math.min(view.idx, config.segments.length - 1)];

  // --- Bike ----------------------------------------------------------------
  const attach = useCallback(() => {
    if (!saved) return Promise.resolve();
    return connectBike(saved.address)
      .catch((e: unknown) => {
        setView((v) => ({ ...v, bikeError: e instanceof Error ? e.message : String(e) }));
      })
      .finally(() => { setBikeBusy(false); });
  }, [saved]);
  // Connect the paired bike as the ride opens; "busy" starts true for it.
  useEffect(() => { void attach(); }, [attach]);
  const connect = () => {
    setBikeBusy(true);
    setView((v) => ({ ...v, bikeError: undefined }));
    void attach();
  };

  // --- The loop: read the bike, advance the ride, snapshot for render --------
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const spokenFor = useRef(-1); // segment index whose "Next" line was spoken
  const say = useRef<(text: string) => void>(() => undefined);
  useEffect(() => {
    if (done) return;
    let alive = true;
    const loop = async () => {
      let read: BikeRead | null = null;
      try {
        read = await readBike();
      } catch (e) {
        if (alive) setView((v) => ({ ...v, bike: "none", bikeError: e instanceof Error ? e.message : String(e) }));
      }
      if (!alive) return;
      const now = Date.now();
      const c = clockRef.current;
      // Paused or still in the lead-in: drain the packets but count nothing.
      if (read && !pausedRef.current && rawTime(c, now) >= LEAD_IN) for (const p of read.packets) meter.current.add(p);
      const t = rideTime(c, now);
      const r = run.current;
      const live = read?.state === "connected" && now - meter.current.lastAt < 3000;
      if (rawTime(c, now) >= LEAD_IN && !pausedRef.current) {
        const before = r.idx;
        r.tick(t, meter.current, live, now);
        if (r.idx !== before) {
          if (r.done) cueFinish();
          else cueWork();
        }
        // Name the next segment ahead of the change.
        const cur = r.segment;
        const next = config.segments[r.idx + 1];
        if (cur && next && spokenFor.current !== r.idx) {
          const left = cur.seconds !== undefined
            ? cur.seconds - r.elapsed(t)
            : (cur.kcal ?? 0) - r.kcalIn(meter.current);
          const soon = cur.seconds !== undefined ? left <= ANNOUNCE_AHEAD : left <= Math.max(5, (cur.kcal ?? 0) * 0.05);
          if (soon) {
            spokenFor.current = r.idx;
            say.current(rideLine(next, false));
          }
        }
      }
      setView({
        raw: rawTime(c, now),
        t,
        idx: r.idx,
        segElapsed: r.elapsed(t),
        segKcal: r.kcalIn(meter.current),
        power: meter.current.power,
        cadence: meter.current.cadence,
        kcal: meter.current.kcal,
        bike: read?.state ?? "none",
        bikeName: read?.name ?? "",
        bikeError: read?.error,
        live,
      });
    };
    void loop();
    const id = setInterval(() => { void loop(); }, 500);
    return () => { alive = false; clearInterval(id); };
  }, [done, config.segments]);

  // --- Voice: the workout voice names each segment ahead of it ---------------
  const [clips, setClips] = useState<Map<string, AudioBuffer> | null>(null);
  useEffect(() => {
    let alive = true;
    const lines = config.segments.map((s, i) => rideLine(s, i === 0));
    prepareClips("workout", lines).then(
      (r) => { if (alive) setClips(r.buffers); },
      () => { if (alive) setClips(new Map()); },
    );
    return () => { alive = false; };
  }, [config.segments]);
  useEffect(() => {
    say.current = (text: string) => {
      if (!voiceOn) return;
      const clip = clips?.get(text);
      if (clip && playClip(clip)) return;
      void speak(text).catch(() => undefined);
    };
  }, [voiceOn, clips]);
  const spokeFirst = useRef(false);
  useEffect(() => {
    if (spokeFirst.current || !clips || !config.segments[0]) return;
    spokeFirst.current = true;
    say.current(rideLine(config.segments[0], true));
  }, [clips, config.segments]);
  // Lead-in countdown, then the start.
  const leadRemain = Math.ceil(LEAD_IN - view.raw);
  const tickedAt = useRef(0);
  useEffect(() => {
    if (!ready || paused || leadRemain > 3 || leadRemain < 1 || tickedAt.current === leadRemain) return;
    tickedAt.current = leadRemain;
    cueTick();
  }, [ready, paused, leadRemain]);
  const started = useRef(false);
  useEffect(() => {
    if (ready || started.current) return;
    started.current = true;
    cueWork();
  }, [ready]);

  // --- Transport -------------------------------------------------------------
  const togglePause = useCallback(() => {
    unlockAudio();
    const now = Date.now();
    setClock((c) => (c.pausedAt === null ? { ...c, pausedAt: now } : { anchor: c.anchor + (now - c.pausedAt), pausedAt: null }));
  }, []);
  const wasAutoPaused = useRef(false);
  const openConfirmStop = useCallback(() => {
    setConfirmStop(true);
    const now = Date.now();
    setClock((c) => {
      if (c.pausedAt !== null) return c;
      wasAutoPaused.current = true;
      return { ...c, pausedAt: now };
    });
  }, []);
  const keepGoing = useCallback(() => {
    setConfirmStop(false);
    if (!wasAutoPaused.current) return;
    wasAutoPaused.current = false;
    togglePause();
  }, [togglePause]);
  const onBack = useCallback(() => {
    if (done) onClose();
    else if (confirmStop) keepGoing();
    else openConfirmStop();
    return true;
  }, [done, confirmStop, keepGoing, openConfirmStop, onClose]);
  useBackHandler(true, onBack);

  /** Manual Done: a kcal target reached on the console with no bike link. */
  const completeSegment = () => {
    const now = Date.now();
    run.current.complete(rideTime(clockRef.current, now), meter.current);
    cueWork();
    setView((v) => ({ ...v, idx: run.current.idx }));
  };

  const stopAndSave = () => {
    const now = Date.now();
    const r = run.current;
    if (r.segment && r.elapsed(rideTime(clockRef.current, now)) > 0) r.complete(rideTime(clockRef.current, now), meter.current);
    setConfirmStop(false);
    setStopped(true);
  };

  const track = useBattleTrack(config.templateId, paused, done);
  useWorkoutWakeLock(done);

  // --- Logging ---------------------------------------------------------------
  const logSession = useCallback(() => {
    const results = run.current.results;
    if (results.length === 0) return null;
    const session = recordedRide(config, results, startedAt, EX.spinBike, ftp, run.current.done);
    update((d) => upsertSession(d, session));
    return session.id;
  }, [config, startedAt, ftp, update]);
  useEffect(() => {
    if (!done || loggedId.current !== null || discarded) return;
    loggedId.current = logSession();
  }, [done, discarded, logSession]);
  const removeLog = () => {
    const id = loggedId.current;
    if (id === null) return;
    update((d) => deleteSession(d, id));
    loggedId.current = null;
    setDiscarded(true);
  };
  const relog = () => {
    loggedId.current = logSession();
    setDiscarded(false);
  };
  const previousBest = useMemo(
    () => (done && config.race ? bestRide(data.sessions, config.templateId, config.segments.length, startedAt) : undefined),
    [done, config, data.sessions, startedAt],
  );

  // --- Completion screen -----------------------------------------------------
  if (done) {
    const results = run.current.results;
    const seconds = results.reduce((a, r) => a + r.seconds, 0);
    const kcal = results.reduce((a, r) => a + r.kcal, 0);
    const avg = seconds > 0 ? results.reduce((a, r) => a + r.avgPower * r.seconds, 0) / seconds : 0;
    const onTarget = seconds > 0 ? results.reduce((a, r) => a + r.inTarget * r.seconds, 0) / seconds : 0;
    return (
      <div className="wod">
        <div className="wod-top">
          <span className="eyebrow">{finished ? "Ride complete" : "Ride stopped"}</span>
          <button className="check" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>
        <div className="wod-center fortime-result">
          <div className="wod-phase" style={{ color: "var(--gold)" }}>{config.title}</div>
          <div className="wod-time">{formatSeconds(seconds)}</div>
          {config.race && finished && (
            <div className="muted" style={{ textAlign: "center" }}>
              {previousBest == null
                ? "First recorded ride — this is the time to beat."
                : seconds < previousBest
                  ? `New best — ${formatSeconds(previousBest - seconds)} faster than ${formatSeconds(previousBest)}.`
                  : `${formatSeconds(seconds - previousBest)} behind your best of ${formatSeconds(previousBest)}.`}
            </div>
          )}
          <div className="ride-stats">
            <div><strong>{Math.round(kcal)}</strong><span>kcal</span></div>
            <div><strong>{Math.round(avg)}</strong><span>avg W</span></div>
            <div><strong>{Math.round(onTarget * 100)}%</strong><span>on target</span></div>
          </div>
          <ol className="fortime-splits">
            {results.map((r, i) => (
              <li key={i}>
                <span>{config.segments[i]?.label}</span>
                <span className="fortime-split">
                  {formatSeconds(r.seconds)} · {Math.round(r.avgPower)} W · {Math.round(r.inTarget * 100)}%
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="wod-controls">
          {results.length === 0 ? (
            <div className="muted">Nothing ridden — nothing logged.</div>
          ) : discarded ? (
            <button className="btn primary" onClick={relog}>Log as session</button>
          ) : (
            <>
              <div className="chip accent" style={{ margin: "0 auto" }}>
                <IconCheck style={{ width: 14, height: 14 }} /> Logged to history
              </div>
              <button className="btn ghost" style={{ marginTop: 10 }} onClick={removeLog}>Remove from history</button>
            </>
          )}
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  if (!seg) return null;
  const target = targetWatts(seg, ftp);
  const f = view.live ? fit(view.power, target) : null;
  const remaining = seg.seconds !== undefined
    ? formatSeconds(Math.max(0, seg.seconds - view.segElapsed))
    : `${String(Math.max(0, Math.ceil((seg.kcal ?? 0) - view.segKcal)))} kcal`;
  const upNext = config.segments.slice(view.idx + 1, view.idx + 3);
  const bikeProblem = !saved
    ? "No bike paired — pair one in Settings → Cycling. Ride by feel; kcal targets need Done."
    : view.bikeError
      ? `Bike: ${view.bikeError}`
      : view.bike !== "connected"
        ? `Bike ${saved.name}: ${bikeBusy || view.bike === "connecting" || view.bike === "discovering" ? "connecting…" : "not connected."}`
        : !view.live && !ready
          ? "Bike connected, but no data — start pedalling."
          : null;

  return (
    <div className={`wod ${ready ? "resting" : ""}`}>
      <div className="wod-top">
        <span className="chip">{config.title} · {view.idx + 1}/{config.segments.length}</span>
        <span className="chip">{formatSeconds(view.t)}</span>
        <button
          className={`check music ${voiceOn ? "on" : ""}`}
          aria-label={voiceOn ? "Stop the spoken cues" : "Speak the cues"}
          onClick={() => { const n = !voiceOn; setVoiceOn(n); saveVoiceOn(n); }}
        >
          <IconVoice />
        </button>
        {track.musicButton}
        <button className="check" onClick={openConfirmStop} aria-label="Stop"><IconClose /></button>
      </div>

      <div className="wod-center ride-center">
        <div className="wod-phase">{ready ? "Get ready" : paused ? "Paused" : seg.label}</div>
        <div className="wod-time">{ready ? formatSeconds(leadRemain) : remaining}</div>
        <div className="ride-target">
          Target {target[0]}–{target[1]} W{seg.cadence ? ` · ${String(seg.cadence[0])}–${String(seg.cadence[1])} rpm` : ""}
          <span className="muted"> · {seg.ftp[0]}–{seg.ftp[1]} % of FTP {ftp}</span>
        </div>
        <div className={`ride-power ${f ?? "none"}`}>
          <span className="ride-watts">{view.live ? Math.round(view.power) : "—"}</span>
          <span className="ride-unit">W</span>
        </div>
        <div className="ride-fit">
          {f === "in" ? "On target" : f === "below" ? "Push — below target" : f === "above" ? "Ease off — above target" : "No power reading"}
          {view.live && <span className="muted"> · zone {zoneOf(view.power, ftp).zone}</span>}
        </div>
        <div className="ride-stats">
          <div><strong>{view.live ? Math.round(view.cadence) : "—"}</strong><span>rpm</span></div>
          <div><strong>{Math.round(view.kcal)}</strong><span>kcal</span></div>
          <div className="ride-anim"><ExerciseAnim anim="spinBike" size={56} /></div>
        </div>
        {bikeProblem && (
          <div className="fortime-gps bad">
            {bikeProblem}
            {saved && view.bike !== "connected" && !bikeBusy && (
              <button className="btn sm" style={{ width: "auto", marginLeft: 8 }} onClick={connect}>Connect</button>
            )}
          </div>
        )}
      </div>

      <div className="wod-queue">
        <div className="wod-queue-label">Up next</div>
        {upNext.length === 0 ? (
          <div className="wod-queue-row last"><span className="wod-queue-name">Last block — finish strong</span></div>
        ) : upNext.map((s, i) => (
          <div key={`${String(view.idx)}-${String(i)}`} className={`wod-queue-row ${i > 0 ? "dim" : ""}`}>
            <span className="wod-queue-name">{s.label}</span>
            <span className="wod-queue-secs">{shownAmount(s)} · {targetWatts(s, ftp).join("–")} W</span>
          </div>
        ))}
      </div>

      {track.audioElement}

      <div className="wod-controls">
        {seg.kcal !== undefined && !ready && !view.live && (
          <button className="btn primary fortime-done" onClick={completeSegment}>
            <IconCheck /> Done — {seg.kcal} kcal reached
          </button>
        )}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn grow" onClick={togglePause}>{paused ? "Resume" : "Pause"}</button>
        </div>
      </div>

      {confirmStop && (
        <div className="wod-confirm">
          <div className="card">
            <h3 style={{ fontSize: 17 }}>Stop the ride?</h3>
            <p className="muted" style={{ fontSize: 14 }}>
              Saves the blocks ridden so far, with their power and kcal.{config.race ? " A stopped race never counts as a best time." : ""}
            </p>
            <button className="btn primary" style={{ marginTop: 12 }} onClick={stopAndSave}>Stop &amp; save</button>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn ghost" onClick={keepGoing}>Keep going</button>
              <button className="btn danger" onClick={onClose}>Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
