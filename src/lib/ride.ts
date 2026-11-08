/**
 * Indoor-bike rides: zones from FTP, the ride's live progress, and what a
 * finished ride logs. Pure — the ride player feeds it the clock and the
 * bike's meter.
 */
import type { RideSegment, Session } from "../types";
import { newSession, uid } from "./store";
import { formatSeconds } from "./units";

const FTP_KEY = "varg.ftp.v1";
/** The owner's FTP when rides shipped (Garmin estimate). Changed in Settings. */
export const DEFAULT_FTP = 283;

export function loadFtp(): number {
  try {
    const v = Number(localStorage.getItem(FTP_KEY));
    return Number.isFinite(v) && v >= 50 && v <= 600 ? Math.round(v) : DEFAULT_FTP;
  } catch {
    return DEFAULT_FTP;
  }
}

export function saveFtp(ftp: number): void {
  try {
    localStorage.setItem(FTP_KEY, String(Math.round(ftp)));
  } catch {
    // remembered for this session only
  }
}

/** Coggan power zones, as % of FTP: the upper bound of each. */
const ZONES = [
  { zone: 1, name: "Recovery", upTo: 55 },
  { zone: 2, name: "Endurance", upTo: 75 },
  { zone: 3, name: "Tempo", upTo: 90 },
  { zone: 4, name: "Threshold", upTo: 105 },
  { zone: 5, name: "VO2 max", upTo: 120 },
  { zone: 6, name: "Anaerobic", upTo: Infinity },
] as const;

export function zoneOf(watts: number, ftp: number): { zone: number; name: string } {
  const pct = (watts / ftp) * 100;
  const z = ZONES.find((x) => pct <= x.upTo) ?? ZONES[5];
  return { zone: z.zone, name: z.name };
}

/** A segment's target in watts for this FTP, rounded to 5 W. */
export function targetWatts(seg: RideSegment, ftp: number): [number, number] {
  const r = (pct: number) => Math.round((ftp * pct) / 100 / 5) * 5;
  return [r(seg.ftp[0]), r(seg.ftp[1])];
}

export type Fit = "below" | "in" | "above";
export function fit(watts: number, target: [number, number]): Fit {
  return watts < target[0] ? "below" : watts > target[1] ? "above" : "in";
}

/** "40 minutes", "3 minutes 30 seconds", "20 seconds", "200 kilocalories". */
export function spokenAmount(seg: RideSegment): string {
  if (seg.kcal !== undefined) return `${String(seg.kcal)} kilocalories`;
  const s = seg.seconds ?? 0;
  const m = Math.floor(s / 60), r = s % 60;
  const part = (n: number, unit: string) => `${String(n)} ${unit}${n === 1 ? "" : "s"}`;
  if (m && r) return `${part(m, "minute")} ${part(r, "second")}`;
  return m ? part(m, "minute") : part(r, "second");
}

/** The amount on screen: "40:00" or "200 kcal". */
export function shownAmount(seg: RideSegment): string {
  return seg.kcal !== undefined ? `${String(seg.kcal)} kcal` : formatSeconds(seg.seconds ?? 0);
}

/** What the voice says for a segment, as the lead-in or ahead of it. */
export function rideLine(seg: RideSegment, first: boolean): string {
  return `${first ? "First" : "Next"}: ${seg.label}, ${spokenAmount(seg)}`;
}

/** Seconds a ride's timed segments take; undefined if any is a kcal target. */
export function rideSeconds(segments: RideSegment[]): number | undefined {
  let total = 0;
  for (const s of segments) {
    if (s.seconds === undefined) return undefined;
    total += s.seconds;
  }
  return total;
}

export interface RideConfig {
  title: string;
  templateId: string;
  segments: RideSegment[];
  race: boolean;
  /** Connected in the pre-ride step; false when the rider chose to ride without it. */
  withBike: boolean;
}

/** One segment as ridden: how long it took, its average power and kcal. */
export interface SegmentResult {
  seconds: number;
  kcal: number;
  avgPower: number;
  /** Share of the segment's measured seconds spent inside the target. */
  inTarget: number;
}

const FINISHED = "Ride · finished";

/**
 * The session a ride logs: one unchecked Spin Bike set per segment ridden,
 * carrying its time, and a note with the numbers that matter — time,
 * average power, kcal, and how much of it was on target.
 */
export function recordedRide(
  cfg: RideConfig,
  results: SegmentResult[],
  startedAt: string,
  exerciseId: string,
  ftp: number,
  finished: boolean,
): Session {
  const session = newSession(cfg.title);
  session.date = startedAt;
  session.finishedAt = new Date().toISOString();
  session.templateId = cfg.templateId;
  session.entries = results.length
    ? [{ id: uid("entry"), exerciseId, sets: results.map((r) => ({ id: uid("set"), done: false, seconds: Math.round(r.seconds) })) }]
    : [];
  const seconds = results.reduce((a, r) => a + r.seconds, 0);
  const kcal = results.reduce((a, r) => a + r.kcal, 0);
  const work = results.reduce((a, r) => a + r.avgPower * r.seconds, 0);
  const onTarget = seconds > 0 ? results.reduce((a, r) => a + r.inTarget * r.seconds, 0) / seconds : 0;
  const parts = [
    `${finished ? FINISHED : "Ride · stopped"} in ${formatSeconds(seconds)}`,
    `${String(Math.round(kcal))} kcal`,
    `avg ${String(Math.round(seconds > 0 ? work / seconds : 0))} W`,
    `${String(Math.round(onTarget * 100))}% on target`,
    `FTP ${String(ftp)}`,
  ];
  session.note = parts.join(" · ");
  return session;
}

/** Total time of a finished race of `segments` segments, if `s` is one. */
export function rideTime(s: Session, segments: number): number | undefined {
  if (!s.finishedAt || !s.note?.startsWith(FINISHED)) return undefined;
  const sets = s.entries.flatMap((e) => e.sets);
  if (sets.length !== segments) return undefined;
  return sets.reduce((a, x) => a + (x.seconds ?? 0), 0);
}

export function bestRide(sessions: Session[], templateId: string, segments: number, excludeStartedAt?: string): number | undefined {
  let best: number | undefined;
  for (const s of sessions) {
    if (s.templateId !== templateId || s.date === excludeStartedAt) continue;
    const t = rideTime(s, segments);
    if (t != null && (best == null || t < best)) best = t;
  }
  return best;
}

/** The bits of the bike meter a ride needs (RideMeter in bike.ts). */
export interface Meter {
  power: number;
  kcal: number;
  kj: number;
  /** Wall-clock ms of the last packet; 0 if none yet. */
  lastAt: number;
}

/**
 * A ride in progress. The player calls `tick` with the workout clock (ride
 * seconds, lead-in and pauses excluded) and the bike meter; segments end on
 * their time or their kcal, and each finished one is kept as a result.
 */
export class RideRun {
  idx = 0;
  results: SegmentResult[] = [];
  private segStart = 0;
  private kcalStart = 0;
  private kjStart = 0;
  private measured = 0;
  private inTarget = 0;
  private lastT = 0;

  constructor(readonly segments: RideSegment[], readonly ftp: number) {}

  get done(): boolean {
    return this.idx >= this.segments.length;
  }
  get segment(): RideSegment | undefined {
    return this.segments[this.idx];
  }
  /** Ride seconds at which the current segment started. */
  get segmentStart(): number {
    return this.segStart;
  }
  /** Seconds into the current segment. */
  elapsed(t: number): number {
    return Math.max(0, t - this.segStart);
  }
  /** kcal burned in the current segment. */
  kcalIn(meter: Meter): number {
    return Math.max(0, meter.kcal - this.kcalStart);
  }

  /**
   * Advance to `t`. `live` says whether the bike is sending data now; only
   * then does time count towards "on target". Returns the segments that
   * ended during this tick (usually none, at most a few on a long gap).
   */
  tick(t: number, meter: Meter, live: boolean, now: number): number {
    let ended = 0;
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    const seg = this.segment;
    if (seg && live && dt > 0 && now - meter.lastAt < 3000) {
      this.measured += dt;
      if (fit(meter.power, targetWatts(seg, this.ftp)) === "in") this.inTarget += dt;
    }
    for (;;) {
      const s = this.segment;
      if (!s) break;
      const timeUp = s.seconds !== undefined && t - this.segStart >= s.seconds;
      const kcalUp = s.kcal !== undefined && this.kcalIn(meter) >= s.kcal;
      if (!timeUp && !kcalUp) break;
      // A timed segment ends exactly on its time, so a long gap (standby)
      // is attributed segment by segment instead of all to one.
      this.finish(s.seconds !== undefined ? this.segStart + s.seconds : t, meter);
      ended++;
    }
    return ended;
  }

  /** End the current segment now — the manual Done for a kcal target. */
  complete(t: number, meter: Meter): void {
    if (this.segment) this.finish(t, meter);
  }

  private finish(at: number, meter: Meter): void {
    const seconds = Math.max(0, at - this.segStart);
    const kj = meter.kj - this.kjStart;
    this.results.push({
      seconds,
      kcal: this.kcalIn(meter),
      avgPower: seconds > 0 ? (kj * 1000) / seconds : 0,
      inTarget: this.measured > 0 ? this.inTarget / this.measured : 0,
    });
    this.idx++;
    this.segStart = at;
    this.kcalStart = meter.kcal;
    this.kjStart = meter.kj;
    this.measured = 0;
    this.inTarget = 0;
  }
}

/** Seconds before a timed block ends that the next one is announced. */
export const ANNOUNCE_AHEAD = 10;

export interface RideSchedule {
  paused: boolean;
  /** Remaining blocks; endAt 0 when it ends on kcal (unknowable ahead). */
  segments: { label: string; endAt: number }[];
  /** Wall-clock cues for the background service. */
  cues: { at: number; text?: string; beep?: "work" | "finish" }[];
}

/**
 * What the background service should do from now on, given where the ride
 * is: when each remaining timed block ends, when to announce the next one,
 * when to beep. A kcal block's end cannot be known ahead, so the schedule
 * stops there — the foreground app (or the replay on return) takes over.
 */
export function rideSchedule(
  segments: RideSegment[],
  idx: number,
  segmentStartWall: number,
  paused: boolean,
): RideSchedule {
  const out: RideSchedule = { paused, segments: [], cues: [] };
  if (paused) return out;
  let start = segmentStartWall;
  for (let i = idx; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) break;
    if (seg.seconds === undefined) {
      out.segments.push({ label: seg.label, endAt: 0 });
      break;
    }
    const end = start + seg.seconds * 1000;
    out.segments.push({ label: seg.label, endAt: end });
    const next = segments[i + 1];
    if (next) {
      out.cues.push({ at: end - ANNOUNCE_AHEAD * 1000, text: rideLine(next, false) });
      out.cues.push({ at: end, beep: "work" });
    } else {
      out.cues.push({ at: end, beep: "finish" });
    }
    start = end;
  }
  return out;
}
