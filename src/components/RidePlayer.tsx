/**
 * Fullscreen indoor-bike ride: segments against live power, cadence and
 * kcal from the bike over Bluetooth.
 *
 * Timing is wall-clock anchored like the other players. The bike is polled
 * twice a second; every packet feeds the RideMeter, and the RideRun turns
 * the clock and the meter into segment changes. A kcal segment ends itself
 * on the bike's numbers — and when there are no numbers (no bike, a
 * dropout), the player says so in red and offers Done, never a silent stall.
 *
 * The screen is split: the top half is the instruction (block, time left,
 * live power against the target) and never moves; the bottom half is a
 * card that swipes between the ride's numbers, the plan and the zones.
 * ◀ / ▶ restart and skip blocks like the interval player — a ride with
 * either is logged as completed, not finished, so it never sets a best.
 *
 * A free ride (the bike console) is the same player with one open block:
 * no lead-in, no cues, no targets, the clock counting up until Finish.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../lib/app-context";
import { deleteSession, upsertSession } from "../lib/store";
import { useBackHandler } from "../lib/back";
import { cueFinish, cueTick, cueWork, unlockAudio } from "../lib/beep";
import { formatSeconds } from "../lib/units";
import {
  RideMeter, connectBike, loadBike, readBike, sendCueAudio, startRideService, stopRideService, updateRideSchedule,
} from "../lib/bike";
import type { BikeRead } from "../lib/bike";
import {
  announceLead, bestRide, COUNTDOWN, fit, loadFtp, musicPlan, recordedRide, rideLine, RideRun, rideLeft, rideSchedule, rideSeconds, shownAmount, speechSeconds, targetWatts, zoneOf, zoneTable,
} from "../lib/ride";
import type { RideConfig, SegmentResult } from "../lib/ride";
import { EX } from "../lib/seed";
import { loadVoiceOn, saveVoiceOn, speak } from "../lib/voice";
import { clipBlob, playClip, prepareClips } from "../lib/voice-clips";
import { IconCheck, IconClose, IconMusic, IconSkipBack, IconSkipNext, IconVoice } from "./icons";
import { useBattleTrack, useWorkoutWakeLock } from "./battle-track";
import { useAdaptiveTrack } from "./adaptive-track";
import { loadMixChoice, resolveMix } from "../lib/music-choice";
import { INTENSITY_NAMES } from "../lib/songs";
import { musicProfileFor } from "../lib/music";
import { HrLine, useHeartRate } from "./HeartRate";
import type { HrLive } from "./HeartRate";
import { HR_ZONE_NAMES, hrZoneOf, hrZoneRange, loadHrZones } from "../lib/hr";

const LEAD_IN = 10;

interface Clock {
  anchor: number;
  pausedAt: number | null;
  /** Seconds of lead-in: LEAD_IN, or 0 for a free ride, which starts at once. */
  lead: number;
}
const rideTime = (c: Clock, now: number) => Math.max(0, ((c.pausedAt ?? now) - c.anchor) / 1000 - c.lead);
const rawTime = (c: Clock, now: number) => ((c.pausedAt ?? now) - c.anchor) / 1000;

/** What the screen shows; a snapshot taken by the poll loop, not computed in render. */
interface View {
  raw: number;
  t: number;
  idx: number;
  segElapsed: number;
  segKcal: number;
  segAvg: number;
  segOnTarget: number | null;
  power: number;
  cadence: number;
  kcal: number;
  kj: number;
  maxPower: number;
  bike: BikeRead["state"] | "none";
  bikeName: string;
  bikeError?: string | undefined;
  live: boolean;
}

export default function RidePlayer({ config, onClose }: { config: RideConfig; onClose: () => void }) {
  const { data, update } = useApp();
  const [ftp] = useState(loadFtp);
  const [zones] = useState(loadHrZones);
  const [clock, setClock] = useState<Clock>(() => ({ anchor: Date.now(), pausedAt: null, lead: config.free ? 0 : LEAD_IN }));
  const clockRef = useRef(clock);
  useEffect(() => { clockRef.current = clock; }, [clock]);
  const [startedAt] = useState(() => new Date().toISOString());
  const meter = useRef(new RideMeter());
  // What the screen shows: every packet, the lead-in and pauses included,
  // so the watts confirm the bike before the ride starts. Only `meter`
  // counts towards the ride.
  const shown = useRef(new RideMeter());
  const run = useRef(new RideRun(config.segments, ftp, zones));
  const [view, setView] = useState<View>({ raw: 0, t: 0, idx: 0, segElapsed: 0, segKcal: 0, segAvg: 0, segOnTarget: null, power: 0, cadence: 0, kcal: 0, kj: 0, maxPower: 0, bike: "none", bikeName: "", live: false });
  const [stopped, setStopped] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const loggedId = useRef<string | null>(null);
  const [discarded, setDiscarded] = useState(false);
  const [voiceOn, setVoiceOn] = useState(loadVoiceOn);
  // The pre-ride step already connected the bike (or the rider skipped it).
  const saved = useMemo(() => (config.withBike ? loadBike() : null), [config.withBike]);
  const [bikeBusy, setBikeBusy] = useState(false);

  const paused = clock.pausedAt !== null;
  const free = config.free === true;
  const finished = view.idx >= config.segments.length;
  const done = finished || stopped;
  const ready = view.raw < clock.lead;
  // The strap: shown in every ride, and the target of heart-rate blocks.
  const hr = useHeartRate(config.title, done, config.withHr);
  const { pull: hrPull, at: hrAt } = hr;
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
  /** Reconnect after a dropout mid-ride. */
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
  const tickedFor = useRef(""); // "block:n" of the last 3-2-1 tick
  /** How long a line takes to say, so it ends right before the 3-2-1. */
  const speechFor = useRef<(text: string) => number>((text) => speechSeconds(text));
  useEffect(() => {
    if (done) return;
    let alive = true;
    const loop = async () => {
      let read: BikeRead | null = null;
      // Heart rate first, so every bike packet replayed below finds the
      // beat that went with it.
      await hrPull();
      try {
        read = await readBike();
      } catch (e) {
        if (alive) setView((v) => ({ ...v, bike: "none", bikeError: e instanceof Error ? e.message : String(e) }));
      }
      if (!alive) return;
      const now = Date.now();
      const c = clockRef.current;
      const r = run.current;
      const visible = document.visibilityState === "visible";
      const before = r.idx;
      // Replay every packet at its own time — after a stretch in the
      // background there can be thousands — so blocks end, kcal counts and
      // time on target come out exactly as if Varg had been on screen.
      // Paused, or still in the lead-in: show the packets, count nothing.
      for (const p of read?.packets ?? []) {
        shown.current.add(p);
        if (pausedRef.current || rawTime(c, p.t) < c.lead) continue;
        meter.current.add(p);
        r.tick(rideTime(c, p.t), meter.current, true, p.t, hrAt(p.t));
      }
      const t = rideTime(c, now);
      const live = read?.state === "connected" && now - meter.current.lastAt < 3000;
      const showLive = read?.state === "connected" && now - shown.current.lastAt < 3000;
      if (rawTime(c, now) >= c.lead && !pausedRef.current) {
        r.tick(t, meter.current, live, now, hrAt(now));
        // Off screen, the background service beeps and speaks instead.
        if (r.idx !== before && visible) {
          if (r.done) cueFinish();
          else cueWork();
        }
        // Into every change: the voice names the next block, then 3-2-1,
        // then the change beep. A timed block counts seconds; a kcal block
        // counts its last 3 kcal, and is named a little before that.
        const cur = r.segment;
        const next = config.segments[r.idx + 1];
        if (cur) {
          const timed = cur.seconds !== undefined;
          const left = timed
            ? (cur.seconds ?? 0) - r.elapsed(t)
            : (cur.kcal ?? 0) - r.kcalIn(meter.current);
          if (next && spokenFor.current !== r.idx) {
            const line = rideLine(next, false);
            const soon = timed
              ? left <= announceLead(speechFor.current(line))
              : left <= Math.max(COUNTDOWN + 5, (cur.kcal ?? 0) * 0.05);
            if (soon) {
              spokenFor.current = r.idx;
              if (visible) say.current(line);
            }
          }
          const n = Math.ceil(left);
          const key = `${String(r.idx)}:${String(n)}`;
          if (n >= 1 && n <= COUNTDOWN && tickedFor.current !== key) {
            tickedFor.current = key;
            if (visible) cueTick();
          }
        }
      }
      setView({
        raw: rawTime(c, now),
        t,
        idx: r.idx,
        segElapsed: r.elapsed(t),
        segKcal: r.kcalIn(meter.current),
        segAvg: r.avgPowerIn(t, meter.current),
        segOnTarget: r.onTarget,
        power: shown.current.power,
        cadence: shown.current.cadence,
        kcal: meter.current.kcal,
        kj: meter.current.kj,
        maxPower: meter.current.maxPower,
        bike: read?.state ?? "none",
        bikeName: read?.name ?? "",
        bikeError: read?.error ?? read?.serviceError,
        live: showLive,
      });
    };
    void loop();
    // Four times a second, so the 3-2-1 lands on the second.
    const id = setInterval(() => { void loop(); }, 250);
    return () => { alive = false; clearInterval(id); };
  }, [done, config.segments, hrPull, hrAt]);

  // --- Voice: the workout voice names each segment ahead of it ---------------
  const [clips, setClips] = useState<Map<string, AudioBuffer> | null>(null);
  useEffect(() => {
    let alive = true;
    // A free ride has nothing to announce.
    const lines = config.free ? [] : config.segments.map((s, i) => rideLine(s, i === 0));
    prepareClips("workout", lines).then(
      (r) => { if (alive) setClips(r.buffers); },
      () => { if (alive) setClips(new Map()); },
    );
    return () => { alive = false; };
  }, [config.segments, config.free]);
  useEffect(() => {
    speechFor.current = (text: string) => speechSeconds(text, clips?.get(text)?.duration);
    say.current = (text: string) => {
      if (!voiceOn) return;
      const clip = clips?.get(text);
      if (clip && playClip(clip)) return;
      void speak(text).catch(() => undefined);
    };
  }, [voiceOn, clips]);
  // --- Background: keep riding while another app is on screen ---------------
  // The native service holds the bike, records packets, shows the ride in a
  // notification and plays the cues while Varg is away. Start it with the
  // ride, hand it the voice clips, keep its schedule current, stop it at the end.
  const [serviceError, setServiceError] = useState<string | null>(null);
  const scheduleNow = useCallback(() => {
    const r = run.current;
    const c = clockRef.current;
    return rideSchedule(
      config.segments, r.idx, c.anchor + (c.lead + r.segmentStart) * 1000, c.pausedAt !== null,
      (text) => speechFor.current(text),
    );
  }, [config.segments]);
  useEffect(() => {
    // No paired bike, nothing to keep connected: the ride stays on screen.
    if (!saved) return;
    startRideService(config.title, scheduleNow())
      .then(async () => {
        if (config.free) return;
        for (const [i, seg] of config.segments.entries()) {
          const text = rideLine(seg, i === 0);
          const blob = await clipBlob("workout", text);
          if (blob) await sendCueAudio(text, blob);
        }
      })
      .catch((e: unknown) => { setServiceError(e instanceof Error ? e.message : String(e)); });
    return () => { void stopRideService().catch(() => undefined); };
  }, [config.title, config.segments, config.free, scheduleNow, saved]);
  // A new block, a restart, a pause or a resume moves every future cue.
  const [jumps, setJumps] = useState(0);
  useEffect(() => {
    if (done) {
      void stopRideService().catch(() => undefined);
      return;
    }
    void updateRideSchedule(scheduleNow()).catch(() => undefined);
  }, [view.idx, jumps, clock, done, scheduleNow]);

  const spokeFirst = useRef(false);
  useEffect(() => {
    if (spokeFirst.current || !clips || !config.segments[0] || config.free) return;
    spokeFirst.current = true;
    say.current(rideLine(config.segments[0], true));
  }, [clips, config.segments, config.free]);
  // Lead-in countdown, then the start.
  const leadRemain = Math.ceil(clock.lead - view.raw);
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
    setClock((c) => (c.pausedAt === null ? { ...c, pausedAt: now } : { ...c, anchor: c.anchor + (now - c.pausedAt), pausedAt: null }));
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

  /** Re-snapshot the block after a jump, without waiting for the next poll. */
  const afterJump = () => {
    const r = run.current;
    const t = rideTime(clockRef.current, Date.now());
    setJumps((n) => n + 1);
    setView((v) => ({
      ...v, idx: r.idx, segElapsed: r.elapsed(t), segKcal: r.kcalIn(meter.current),
      segAvg: r.avgPowerIn(t, meter.current), segOnTarget: r.onTarget,
    }));
  };

  /**
   * ▶: in the lead-in, start now; mid-ride, end this block and start the
   * next. Not on the last block — that would end the ride on one stray tap;
   * the X (Stop & save) is the way out there.
   */
  const skip = () => {
    unlockAudio();
    const now = Date.now();
    if (ready) {
      setClock((c) => ({ ...c, anchor: (c.pausedAt ?? now) - c.lead * 1000 }));
      return;
    }
    const r = run.current;
    if (r.idx >= config.segments.length - 1) return;
    r.skip(rideTime(clockRef.current, now), meter.current);
    cueWork();
    afterJump();
  };

  /** ◀: restart this block, or go back one if it only just began. */
  const back = () => {
    unlockAudio();
    if (ready) return;
    run.current.back(rideTime(clockRef.current, Date.now()), meter.current);
    spokenFor.current = -1;
    cueWork();
    afterJump();
  };

  const stopAndSave = () => {
    const now = Date.now();
    const r = run.current;
    if (r.segment && r.elapsed(rideTime(clockRef.current, now)) > 0) r.complete(rideTime(clockRef.current, now), meter.current);
    setConfirmStop(false);
    setStopped(true);
  };

  // An adaptive ride mixes songs from the collection block by block; any
  // other ride plays its one track under the cues.
  const adaptive = config.segments.some((x) => x.intensity !== undefined);
  // Where this ride starts in each intensity's rotation (and which set a
  // shuffle plays): rides differ.
  const [seed] = useState(() => Math.floor(Date.now() / 1000) % 997);
  // The owner's music choice for this workout, fixed for the ride.
  const [mix] = useState(() =>
    adaptive ? resolveMix(loadMixChoice(config.templateId, musicProfileFor(config.templateId).set ?? "techno"), seed).mix : undefined);
  const single = useBattleTrack(adaptive ? undefined : config.templateId, paused, done);
  const mixed = useAdaptiveTrack(mix, seed, done);
  // A custom choice can leave an intensity the ride uses without songs:
  // its blocks would be silent, so say so.
  const gap = mix ? ([1, 2, 3] as const).filter((l) => config.segments.some((sg) => sg.intensity === l) && mix[l].length === 0) : [];
  const musicProblem = mixed.problem ?? (gap.length ? `Music · no ${gap.map((l) => INTENSITY_NAMES[l]).join(" or ")} songs` : null);
  const musicButton = adaptive ? mixed.musicButton : single.musicButton;
  useWorkoutWakeLock(done);
  // Hand the mixer every move of the clock and the blocks: it books the
  // changes ahead on the audio clock and keeps the music on ride time.
  const { setPlan } = mixed;
  useEffect(() => {
    if (!adaptive) return;
    const r = run.current;
    const c = clockRef.current;
    setPlan(musicPlan(config.segments, r.idx, c.anchor + c.lead * 1000, r.segmentStart, c.pausedAt !== null));
  }, [adaptive, view.idx, jumps, clock, done, config.segments, setPlan]);
  const attachHr = hr.attach;

  // --- Logging ---------------------------------------------------------------
  const logSession = useCallback(() => {
    const results = run.current.results;
    if (results.length === 0) return null;
    const session = attachHr(recordedRide(config, results, startedAt, EX.spinBike, ftp, run.current.done, run.current.restarts));
    update((d) => upsertSession(d, session));
    return session.id;
  }, [config, startedAt, ftp, update, attachHr]);
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
    const skipped = results.filter((r) => r.skipped).length;
    const asWritten = skipped === 0 && run.current.restarts === 0;
    return (
      <div className="wod">
        <div className="wod-top">
          <span className="eyebrow">{free ? "Ride finished" : !finished ? "Ride stopped" : asWritten ? "Ride complete" : "Ride completed"}</span>
          <button className="check" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>
        <div className="wod-center fortime-result">
          <div className="wod-phase" style={{ color: "var(--gold)" }}>{config.title}</div>
          <div className="wod-time">{formatSeconds(seconds)}</div>
          {config.race && finished && (
            <div className="muted" style={{ textAlign: "center" }}>
              {!asWritten
                ? "Blocks skipped or restarted, so not counted as a best time."
                : previousBest == null
                  ? "First recorded ride. This is the time to beat."
                  : seconds < previousBest
                    ? `New best: ${formatSeconds(previousBest - seconds)} faster than ${formatSeconds(previousBest)}.`
                    : `${formatSeconds(seconds - previousBest)} behind your best of ${formatSeconds(previousBest)}.`}
            </div>
          )}
          <div className="ride-stats">
            <div><strong>{Math.round(kcal)}</strong><span>kcal</span></div>
            <div><strong>{Math.round(avg)}</strong><span>avg W</span></div>
            {free
              ? <div><strong>{Math.round(view.maxPower)}</strong><span>max W</span></div>
              : <div><strong>{Math.round(onTarget * 100)}%</strong><span>on target</span></div>}
          </div>
          {!free && <ol className="fortime-splits">
            {results.map((r, i) => (
              <li key={i}>
                <span>{config.segments[i]?.label}{r.skipped ? " · skipped" : ""}</span>
                <span className="fortime-split">
                  {formatSeconds(r.seconds)} · {Math.round(r.avgPower)} W · {Math.round(r.inTarget * 100)}%
                </span>
              </li>
            ))}
          </ol>}
        </div>
        <div className="wod-controls">
          {results.length === 0 ? (
            <div className="muted">Nothing ridden, nothing logged.</div>
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
  // A heart-rate block is steered by the strap; its watts are where to start.
  const hrTarget = seg.hrZone !== undefined && zones ? hrZoneRange(zones, seg.hrZone) : null;
  const f = hrTarget
    ? hr.bpm !== null ? fit(hr.bpm, hrTarget) : null
    : view.live ? fit(view.power, target) : null;
  const remaining = seg.seconds !== undefined
    ? formatSeconds(Math.max(0, seg.seconds - view.segElapsed))
    : `${String(Math.max(0, Math.ceil((seg.kcal ?? 0) - view.segKcal)))} kcal`;
  const segFrac = ready
    ? 0
    : seg.seconds !== undefined
      ? view.segElapsed / seg.seconds
      : view.segKcal / Math.max(1, seg.kcal ?? 1);
  // Whole-ride progress by time when every block is timed, else by blocks.
  const total = rideSeconds(config.segments);
  const before = config.segments.slice(0, view.idx);
  const rideFrac = ready
    ? 0
    : total
      ? ((rideSeconds(before) ?? 0) + view.segElapsed) / total
      : (view.idx + Math.min(1, segFrac)) / config.segments.length;
  const last = view.idx >= config.segments.length - 1;
  // The whole ride's time left, lead-in included; a kcal block adds its kcal.
  const left = rideLeft(config.segments, view.idx, ready ? 0 : view.segElapsed, ready ? 0 : view.segKcal);
  const leftSecs = left.seconds + (ready ? Math.max(0, leadRemain) : 0);
  const totalLeft = left.kcal > 0
    ? leftSecs > 0 ? `${formatSeconds(leftSecs)} + ${String(Math.ceil(left.kcal))} kcal` : `${String(Math.ceil(left.kcal))} kcal`
    : formatSeconds(leftSecs);
  const bikeProblem = !saved
    ? null
    : view.bikeError
      ? `Bike: ${view.bikeError}`
      : view.bike !== "connected"
        ? `Bike ${saved.name}: ${bikeBusy || view.bike === "connecting" || view.bike === "discovering" ? "connecting…" : "not connected."}`
        : !view.live
          ? "Bike connected, but no data. Start pedalling."
          : null;

  if (free) {
    const zone = view.live ? zoneOf(view.power, ftp) : null;
    return (
      <div className="wod ride">
        <div className="wod-top">
          <span className="chip">{config.title}</span>
          {musicButton}
          <button className="check" onClick={openConfirmStop} aria-label="Stop"><IconClose /></button>
        </div>
        <HrLine hr={hr} />

        {/* Top half: the clock since the start and the bike's live power. */}
        <div className="ride-now">
          <div className="wod-phase">{paused ? "Paused" : "Riding"}</div>
          <div className="wod-time">{formatSeconds(view.t)}</div>
          <div className={`ride-power ${zone ? "in" : "none"}`}>
            <span className="ride-watts">{view.live ? Math.round(view.power) : 0}</span>
            <span className="ride-unit">W</span>
          </div>
          <div className={`ride-fit ${zone ? "in" : "none"}`}>
            {zone ? `Zone ${String(zone.zone)} · ${zone.name}` : "No power"}
          </div>
          <div className="ride-target">
            {view.live ? Math.round(view.cadence) : 0} rpm · {Math.round(view.kcal)} kcal{hrText(hr)}
          </div>
          {serviceError && (
            <div className="fortime-gps bad">
              Can't keep riding in the background: {serviceError} Keep Varg on screen.
            </div>
          )}
          {!saved && (
            <div className="fortime-gps bad">No bike · clock only</div>
          )}
          {bikeProblem && (
            <div className="fortime-gps bad">
              {bikeProblem}
              {saved && view.bike !== "connected" && !bikeBusy && (
                <button className="btn sm" style={{ width: "auto", marginLeft: 8 }} onClick={connect}>Connect</button>
              )}
            </div>
          )}
        </div>

        {/* Bottom half: the ride's numbers and the zones. */}
        <RideDeck pages={[
          {
            title: "Ride",
            body: (
              <div className="ride-grid">
                <Stat value={view.live ? Math.round(view.cadence) : 0} unit="rpm" />
                <Stat value={Math.round(view.kcal)} unit="kcal" />
                <Stat value={view.t >= 1 ? Math.round((view.kj * 1000) / view.t) : 0} unit="avg W" />
                <Stat value={Math.round(view.maxPower)} unit="max W" />
                <Stat value={Math.round(view.kj)} unit="kJ" />
                <Stat value={zone ? `Z${String(zone.zone)}` : "0"} unit="zone" />
              </div>
            ),
          },
          {
            title: "Zones",
            body: (
              <ol className="ride-zones">
                {zoneTable(ftp).map((z) => (
                  <li key={z.zone} className={zone?.zone === z.zone ? "live" : ""}>
                    <span className="ride-plan-mark">Z{z.zone}</span>
                    <span className="ride-plan-name">{z.name}</span>
                    <span className="ride-plan-amt">{z.to == null ? `${String(z.from)}+ W` : `${String(z.from)}–${String(z.to)} W`}</span>
                  </li>
                ))}
                <li className="ride-zones-ftp muted">FTP {ftp} W (Settings)</li>
              </ol>
            ),
          },
        ]} />

        {single.audioElement}

        <div className="wod-controls">
          <div className="btn-row">
            <button className="btn grow" onClick={togglePause}>{paused ? "Resume" : "Pause"}</button>
            <button className="btn primary grow" onClick={openConfirmStop}>Finish</button>
          </div>
        </div>

        {confirmStop && (
          <div className="wod-confirm">
            <div className="card">
              <h3 style={{ fontSize: 17 }}>Finish the ride?</h3>
              <p className="muted" style={{ fontSize: 14 }}>
                Saves {formatSeconds(view.t)} of riding with its kcal and average watts.
              </p>
              <button className="btn primary" style={{ marginTop: 12 }} onClick={stopAndSave}>Finish &amp; save</button>
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

  return (
    <div className={`wod ride ${ready ? "resting" : ""}`}>
      <div className="wod-top">
        <span className="chip">{config.title}</span>
        <button
          className={`check music ${voiceOn ? "on" : ""}`}
          aria-label={voiceOn ? "Stop the spoken cues" : "Speak the cues"}
          onClick={() => { const n = !voiceOn; setVoiceOn(n); saveVoiceOn(n); }}
        >
          <IconVoice />
        </button>
        {musicButton}
        <button className="check" onClick={openConfirmStop} aria-label="Stop"><IconClose /></button>
      </div>
      <HrLine hr={hr} />
      {musicProblem && (
        <div className="hr-line bad" role="alert">
          <IconMusic />
          <span className="hr-line-text">{musicProblem}</span>
        </div>
      )}
      <div className="ride-total">
        <div className="ride-total-row">
          <span className="ride-total-label">Total left</span>
          <span className="ride-total-time">{totalLeft}</span>
        </div>
        <div className="wod-progress" aria-hidden>
          <div style={{ width: `${String(Math.min(1, rideFrac) * 100)}%` }} />
        </div>
      </div>

      {/* Top half: what to do now. */}
      <div className="ride-now">
        <div className="wod-phase">
          {ready ? "Get ready" : paused ? "Paused" : `Block ${String(view.idx + 1)} / ${String(config.segments.length)}`}
        </div>
        <div className="ride-label">{ready ? `First: ${seg.label}` : seg.label}</div>
        <div className="wod-time">{ready ? formatSeconds(leadRemain) : remaining}</div>
        <div className="wod-stepbar" aria-hidden>
          <div style={{ width: `${String(Math.min(1, segFrac) * 100)}%` }} />
        </div>
        {hrTarget ? (
          <>
            {/* Three short lines, like the watt view: the reading, the target,
                the verdict. Watts and cadence live in the Ride card below. */}
            <div className={`ride-power ${f ?? "none"}`}>
              {hr.bpm !== null
                ? <><span className="ride-watts">{hr.bpm}</span><span className="ride-unit">bpm</span></>
                : <span className="ride-watts ride-noreading">No HR</span>}
            </div>
            <div className="ride-target">
              {hrTarget[0]}–{hrTarget[1]} bpm{seg.cadence ? ` · ${String(seg.cadence[0])}–${String(seg.cadence[1])} rpm` : ""}
            </div>
            <div className={`ride-fit ${f ?? "none"}`}>
              {f === "in" ? `In zone ${String(seg.hrZone)}` : f === "below" ? "Push" : f === "above" ? "Ease off" : "No HR"}
            </div>
          </>
        ) : (
          <>
            <div className={`ride-power ${f ?? "none"}`}>
              <span className="ride-watts">{view.live ? Math.round(view.power) : 0}</span>
              <span className="ride-unit">W</span>
            </div>
            <div className="ride-target">
              {target[0]}–{target[1]} W{seg.cadence ? ` · ${String(seg.cadence[0])}–${String(seg.cadence[1])} rpm` : ""}
              {hrText(hr)}
            </div>
            <div className={`ride-fit ${f ?? "none"}`}>
              {f === "in" ? "On target" : f === "below" ? "Push" : f === "above" ? "Ease off" : "No power"}
            </div>
          </>
        )}
        {serviceError && (
          <div className="fortime-gps bad">
            Can't keep riding in the background: {serviceError} Keep Varg on screen.
          </div>
        )}
        {!saved && !ready && (
          <div className="ride-note">
            No bike · keep on screen{config.segments.some((x) => x.kcal !== undefined) ? " · Done ends kcal" : ""}
          </div>
        )}
        {bikeProblem && (
          <div className="fortime-gps bad">
            {bikeProblem}
            {saved && view.bike !== "connected" && !bikeBusy && (
              <button className="btn sm" style={{ width: "auto", marginLeft: 8 }} onClick={connect}>Connect</button>
            )}
          </div>
        )}
      </div>

      {/* Bottom half: swipe between the numbers, the plan and the zones. */}
      <RideDeck pages={[
        {
          title: "Ride",
          body: (
            <div className="ride-grid">
              <Stat value={view.live ? Math.round(view.cadence) : 0} unit="rpm" />
              <Stat value={Math.round(view.kcal)} unit="kcal" />
              <Stat value={formatSeconds(view.t)} unit="ride time" />
              {hrTarget
                ? <Stat value={view.live ? Math.round(view.power) : 0} unit="W now" />
                : <Stat value={ready || view.segElapsed < 1 ? 0 : Math.round(view.segAvg)} unit="block avg W" />}
              <Stat value={view.segOnTarget == null ? "0%" : `${String(Math.round(view.segOnTarget * 100))}%`} unit={hrTarget ? "block in zone" : "block on target"} />
              <Stat value={view.t >= 1 ? Math.round((view.kj * 1000) / view.t) : 0} unit="ride avg W" />
            </div>
          ),
        },
        {
          title: "Plan",
          body: (
            <ol className="ride-plan">
              {config.segments.map((s, i) => {
                const r: SegmentResult | undefined = run.current.results[i];
                const state = i < view.idx ? "done" : i === view.idx ? "now" : "later";
                return (
                  <li key={i} className={state}>
                    <span className="ride-plan-mark">{state === "done" ? (r?.skipped ? "»" : "✓") : String(i + 1)}</span>
                    <span className="ride-plan-name">{s.label}</span>
                    <span className="ride-plan-amt">
                      {state === "done" && r
                        ? r.skipped ? `skipped · ${formatSeconds(r.seconds)}` : `${formatSeconds(r.seconds)} · ${String(Math.round(r.avgPower))} W`
                        : state === "now" && !ready
                          ? `${remaining} left`
                          : s.hrZone !== undefined && zones
                            ? `${shownAmount(s)} · HR Z${String(s.hrZone)} ${hrZoneRange(zones, s.hrZone).join("–")}`
                            : `${shownAmount(s)} · ${targetWatts(s, ftp).join("–")} W`}
                    </span>
                  </li>
                );
              })}
            </ol>
          ),
        },
        ...(hrTarget && zones ? [{
          title: "HR",
          body: (
            <ol className="ride-zones compact">
              {HR_ZONE_NAMES.map((name, i) => {
                const z = i + 1;
                const [lo, hi] = hrZoneRange(zones, z);
                return (
                  <li key={z} className={`${hr.bpm !== null && hrZoneOf(hr.bpm, zones) === z ? "live" : ""} ${seg.hrZone === z ? "target" : ""}`}>
                    <span className="ride-plan-mark">Z{z}</span>
                    <span className="ride-plan-name">{name}</span>
                    <span className="ride-plan-amt">{lo}–{hi} bpm</span>
                  </li>
                );
              })}
            </ol>
          ),
        }] : []),
        {
          title: "Zones",
          body: (
            <ol className="ride-zones">
              {zoneTable(ftp).map((z) => {
                const live = view.live && zoneOf(view.power, ftp).zone === z.zone;
                const inTarget = (z.to ?? Infinity) >= target[0] && z.from <= target[1];
                return (
                  <li key={z.zone} className={`${live ? "live" : ""} ${inTarget ? "target" : ""}`}>
                    <span className="ride-plan-mark">Z{z.zone}</span>
                    <span className="ride-plan-name">{z.name}</span>
                    <span className="ride-plan-amt">{z.to == null ? `${String(z.from)}+ W` : `${String(z.from)}–${String(z.to)} W`}</span>
                  </li>
                );
              })}
              <li className="ride-zones-ftp muted">FTP {ftp} W · target {seg.ftp[0]}–{seg.ftp[1]} %</li>
            </ol>
          ),
        },
      ]} />

      {single.audioElement}

      <div className="wod-controls">
        {seg.kcal !== undefined && !ready && !view.live && (
          <button className="btn primary fortime-done" style={{ marginBottom: 10 }} onClick={completeSegment}>
            <IconCheck /> Done: {seg.kcal} kcal reached
          </button>
        )}
        {/* Labelled, with media-player icons, so they read as "the workout"
            and not as arrows for the card above. */}
        <div className="btn-row ride-transport">
          <button className="btn ghost" onClick={back} disabled={ready}>
            <IconSkipBack /><span>Restart</span>
          </button>
          <button className="btn grow" onClick={togglePause}>{paused ? "Resume" : "Pause"}</button>
          <button className="btn ghost" onClick={skip} disabled={!ready && last}>
            <IconSkipNext /><span>{ready ? "Start now" : last ? "Last block" : "Skip block"}</span>
          </button>
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

/** The live heart rate appended to a ride's target line: " · ♥ 125 Z2". */
function hrText(hr: HrLive): string {
  if (!hr.paired || hr.problem) return "";
  if (hr.bpm === null) return " · ♥ …";
  return ` · ♥ ${String(hr.bpm)}${hr.zone ? ` Z${String(hr.zone)}` : ""}`;
}

function Stat({ value, unit }: { value: string | number; unit: string }) {
  return (
    <div className="ride-stat">
      <strong>{value}</strong>
      <span>{unit}</span>
    </div>
  );
}

const DECK_KEY = "varg.rideDeck.v1";
function loadDeckPage(): number {
  try {
    return Number(localStorage.getItem(DECK_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * The bottom card: pages side by side in a scroll-snapped strip, so a
 * swipe flips them natively; the tabs above it jump straight to one. The
 * last page viewed is remembered for the next ride.
 */
function RideDeck({ pages }: { pages: { title: string; body: React.ReactNode }[] }) {
  const strip = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(() => Math.min(loadDeckPage(), pages.length - 1));
  const initial = useRef(page);
  useEffect(() => {
    const el = strip.current;
    if (el) el.scrollLeft = initial.current * el.clientWidth;
  }, []);
  const onScroll = () => {
    const el = strip.current;
    if (!el || el.clientWidth === 0) return;
    const p = Math.round(el.scrollLeft / el.clientWidth);
    if (p === page) return;
    setPage(p);
    try { localStorage.setItem(DECK_KEY, String(p)); } catch { /* this ride only */ }
  };
  const go = (p: number) => {
    const el = strip.current;
    if (el) el.scrollTo({ left: p * el.clientWidth, behavior: "smooth" });
  };
  return (
    <div className="ride-deck">
      <div className="ride-tabs" role="tablist">
        {pages.map((p, i) => (
          <button key={p.title} role="tab" aria-selected={i === page} className={i === page ? "on" : ""} onClick={() => { go(i); }}>
            {p.title}
          </button>
        ))}
      </div>
      <div className="ride-strip" ref={strip} onScroll={onScroll}>
        {pages.map((p) => (
          <section key={p.title} className="ride-page" aria-label={p.title}>{p.body}</section>
        ))}
      </div>
    </div>
  );
}
