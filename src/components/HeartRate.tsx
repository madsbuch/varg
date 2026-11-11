/**
 * Heart rate in the players: the paired strap connects when a workout
 * starts, a foreground service keeps it recording with the phone locked,
 * and the session is saved with its average, maximum and trace.
 *
 * `useHeartRate` does all of that for one player. `HrLine` sits under the
 * player's top bar: the live bpm and zone, or, in red, whatever is wrong —
 * strap lost, no skin contact, nothing coming in, no permission — never a
 * quiet dash. `StrapPicker` pairs a strap (Settings). `StrapCard` connects the
 * paired strap and shows it live before a workout starts, the way the bike's
 * pre-ride step does — inside `HrConnectSheet` for guided workouts and
 * inside the ride's connect sheet. `HeartRateCard` shows a
 * saved session's heart rate — only when Garmin Connect, the record of
 * heart rate, has none for that session.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { HeartRate, Session } from "../types";
import {
  connectStrap, hrZoneOf, HrRecorder, loadHrZones, loadStrap, readHr, requestHrPermission, saveStrap, scanStraps,
  setHrWorkout, STALE_MS, startHrService, withHeartRate,
} from "../lib/hr";
import type { FoundStrap, HrRead } from "../lib/hr";
import { formatSeconds } from "../lib/units";
import { Sheet } from "./ui";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const NO_PERMISSION = "No Bluetooth permission";

export interface HrLive {
  paired: boolean;
  bpm: number | null;
  /** The live heart rate's zone of the rider's Garmin zones; null without either. */
  zone: number | null;
  /** Red, on the stage. Null when the strap is fine or still starting. */
  problem: string | null;
  /** Shown muted while there is nothing to show yet. */
  status: string;
  retry: () => void;
  /** Add the recorded heart rate to a session about to be logged. */
  attach: (s: Session) => Session;
  /**
   * Drain the strap's queue into the recording now. The ride calls it
   * before replaying the bike's packets, so `at` knows every beat first.
   */
  pull: () => Promise<void>;
  /** Heart rate at wall-clock ms `t`, or null without a fresh reading. */
  at: (t: number) => number | null;
}

/** A connected strap that has sent nothing for this long is a problem, not a wait. */
const SILENT_MS = 8000;

function problemOf(r: HrRead, rec: HrRecorder, now: number, connectedSince: number | null): string | null {
  if (r.serviceError) return "HR stops when locked";
  if (r.state === "reconnecting") return "HR lost · reconnecting";
  if (r.state === "disconnected") return "HR not connected";
  if (r.state !== "connected") return null;
  if (rec.noContact) return "No contact";
  if (rec.lastAt > 0 && now - rec.lastAt > STALE_MS) return "No HR data";
  if (rec.lastAt === 0 && connectedSince !== null && now - connectedSince > SILENT_MS) {
    return "No HR data";
  }
  return null;
}

/**
 * Connect the paired strap and record it for as long as the player runs.
 * Without a paired strap it does nothing and the chip is not shown.
 */
/**
 * `enabled` is the pre-workout step's answer: false when the athlete chose
 * to start without heart rate, and then the chip is not shown at all.
 */
export function useHeartRate(title: string, done: boolean, enabled: boolean): HrLive {
  const [strap] = useState(() => (enabled ? loadStrap() : null));
  const rec = useRef(new HrRecorder());
  const [bpm, setBpm] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [status, setStatus] = useState("Connecting");
  const [zones] = useState(loadHrZones);
  const [attempt, setAttempt] = useState(0);
  // Reads are chained, never concurrent: two drains in flight could feed
  // the recorder out of order.
  const chain = useRef<Promise<HrRead | null>>(Promise.resolve(null));
  const live = useRef(false);
  const read = useCallback((): Promise<HrRead | null> => {
    const next = chain.current.then(async () => {
      if (!live.current) return null;
      const r = await readHr();
      for (const p of r.packets) rec.current.add(p);
      return r;
    });
    chain.current = next.catch(() => null);
    return next;
  }, []);
  const pull = useCallback(() => read().then(() => undefined, () => undefined), [read]);
  const at = useCallback((t: number) => rec.current.at(t), []);

  useEffect(() => {
    if (!strap || done) return;
    let alive = true;
    live.current = true;
    let connectedSince: number | null = null;
    requestHrPermission()
      .then((ok) => {
        if (!ok) throw new Error(NO_PERMISSION);
        return connectStrap(strap.address);
      })
      .then(() => startHrService(title))
      .then(() => setHrWorkout(true))
      .catch((e: unknown) => { if (alive) setSetupError(errText(e)); });
    const id = setInterval(() => {
      read()
        .then((r) => {
          if (!alive || !r) return;
          const now = Date.now();
          if (r.state === "connected") connectedSince ??= now;
          else connectedSince = null;
          setBpm(rec.current.current(now));
          setProblem(problemOf(r, rec.current, now, connectedSince));
          setStatus(r.state === "connected" ? "Waiting" : "Connecting");
        })
        .catch((e: unknown) => { if (alive) setProblem(errText(e)); });
    }, 1000);
    return () => {
      alive = false;
      live.current = false;
      clearInterval(id);
      // The strap stays connected: the next workout, or a zone-2 ride after
      // a video, picks it straight up. The service lets go after 20 minutes
      // without a workout, or when Varg is closed.
      void setHrWorkout(false).catch(() => undefined);
    };
  }, [strap, done, title, attempt, read]);

  const retry = useCallback(() => {
    setSetupError(null);
    setProblem(null);
    setAttempt((a) => a + 1);
  }, []);
  const attach = useCallback((s: Session) => withHeartRate(s, strap ? rec.current : null), [strap]);

  const zone = bpm !== null && zones ? hrZoneOf(bpm, zones) : null;
  return { paired: strap !== null, bpm, zone, problem: setupError ?? problem, status, retry, attach, pull, at };
}

const Heart = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden>
    <path d="M12 21s-7.5-4.6-9.5-9.6C1.2 8 3.3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.5 0 5.6 3.5 4.3 6.9C19.5 16.4 12 21 12 21z" />
  </svg>
);

/**
 * What is wrong with the heart rate: one red line under the top bar, shown
 * only while something is wrong, so a working strap costs the layout
 * nothing. The live value is an `HrBadge` on a row that is there anyway.
 */
export function HrLine({ hr }: { hr: HrLive }) {
  if (!hr.paired || !hr.problem) return null;
  return (
    <div className="hr-line bad" role="alert">
      <Heart />
      <span className="hr-line-text">{hr.problem}</span>
      <button className="btn sm ghost" onClick={hr.retry}>Retry</button>
    </div>
  );
}

/**
 * The live heart rate as a small badge: placed on the phase row of the
 * interval and for-time players, so it takes no height of its own (the
 * exercise figure is what would give it up). Nothing while HrLine shows a
 * problem, or without a strap.
 */
export function HrBadge({ hr }: { hr: HrLive }) {
  if (!hr.paired || hr.problem) return null;
  return (
    <span className={`hr-badge ${hr.bpm !== null ? "live" : ""}`} aria-label="Heart rate">
      <Heart />
      {hr.bpm !== null ? <><strong>{hr.bpm}</strong>{hr.zone ? <small>Z{hr.zone}</small> : null}</> : "…"}
    </span>
  );
}

interface Paired { address: string; name: string }

/** Find straps (asking for Bluetooth permission first) and remember the chosen one. */
export function StrapPicker({ onPicked }: { onPicked: (s: Paired) => void }) {
  const [found, setFound] = useState<FoundStrap[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const find = () => {
    setProblem(null);
    setFound(null);
    setBusy("Permission…");
    requestHrPermission()
      .then((ok) => {
        if (!ok) throw new Error(NO_PERMISSION);
        setBusy("Searching…");
        return scanStraps(8);
      })
      .then((list) => {
        setFound(list);
        if (list.length === 0) setProblem("Nothing found");
      })
      .catch((e: unknown) => { setProblem(errText(e)); })
      .finally(() => { setBusy(null); });
  };

  return (
    <div>
      <button className="btn sm" style={{ width: "auto" }} disabled={busy !== null} onClick={find}>
        Find heart rate
      </button>
      {found && found.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {found.map((s) => (
            <button
              key={s.address}
              className="list-item"
              onClick={() => {
                const chosen = { address: s.address, name: s.name };
                saveStrap(chosen);
                setFound(null);
                onPicked(chosen);
              }}
            >
              <div>
                <div className="title">{s.name}</div>
                <div className="sub">Heart rate · signal {s.rssi} dBm</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {busy && <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>{busy}</div>}
      {problem && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{problem}</div>}
    </div>
  );
}

/**
 * A saved session's heart rate: average and maximum, and the trace over
 * the session. Gaps (strap off, out of range) break the line.
 */
export function HeartRateCard({ hr }: { hr: HeartRate }) {
  const W = 300;
  const H = 70;
  const values = hr.trace.filter((v) => v > 0);
  const lo = Math.min(...values) - 5;
  const hi = Math.max(...values) + 5;
  const x = (k: number) => (hr.trace.length > 1 ? (k / (hr.trace.length - 1)) * W : W / 2);
  const y = (v: number) => H - ((v - lo) / Math.max(1, hi - lo)) * H;
  let d = "";
  hr.trace.forEach((v, k) => {
    if (v <= 0) return;
    const prev = hr.trace[k - 1] ?? 0;
    d += `${prev > 0 ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`;
  });
  const missing = hr.trace.filter((v) => v <= 0).length * hr.every;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row" style={{ alignItems: "baseline" }}>
        <strong>Heart rate</strong>
        <span className="muted" style={{ fontSize: 14 }}>
          avg <strong style={{ color: "var(--text)" }}>{hr.avg}</strong> · max <strong style={{ color: "var(--text)" }}>{hr.max}</strong> bpm
        </span>
      </div>
      {values.length > 1 && (
        <svg viewBox={`0 0 ${String(W)} ${String(H)}`} preserveAspectRatio="none" className="hr-trace" role="img" aria-label={`Heart rate from ${String(Math.min(...values))} to ${String(hr.max)} bpm`}>
          <line x1="0" x2={W} y1={y(hr.avg)} y2={y(hr.avg)} className="hr-avg" />
          <path d={d} />
        </svg>
      )}
      {missing >= 30 && (
        <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>
          {formatSeconds(missing)} without HR
        </div>
      )}
    </div>
  );
}

/**
 * Before a workout: connect the paired strap and show its live heart rate,
 * so the athlete knows it works before the clock starts — the bike's
 * pre-ride step, for the strap. `onLive` reports whether a fresh reading
 * is coming in. Without a paired strap it offers to pair one.
 */
export function StrapCard({ onLive }: { onLive?: (live: boolean) => void }) {
  const [strap, setStrap] = useState(loadStrap);
  const [read, setRead] = useState<HrRead | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);
  const [noContact, setNoContact] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (!strap) return;
    let alive = true;
    const rec = new HrRecorder();
    requestHrPermission()
      .then((ok) => {
        if (!ok) throw new Error(NO_PERMISSION);
        return connectStrap(strap.address);
      })
      // Held from here on, not just for the workout this sheet starts.
      .then(() => startHrService("Heart rate"))
      .catch((e: unknown) => { if (alive) setProblem(errText(e)); });
    const id = setInterval(() => {
      readHr()
        .then((r) => {
          if (!alive) return;
          for (const p of r.packets) rec.add(p);
          setRead(r);
          setBpm(rec.current(Date.now()));
          setNoContact(rec.noContact);
        })
        .catch((e: unknown) => { if (alive) setProblem(errText(e)); });
    }, 500);
    return () => { alive = false; clearInterval(id); };
  }, [strap, attempt]);

  const live = !!strap && read?.state === "connected" && bpm !== null;
  useEffect(() => { onLive?.(live); }, [live, onLive]);

  const reset = () => { setProblem(null); setRead(null); setBpm(null); };
  const connected = read?.state === "connected";
  const status = problem ?? (read?.state === "reconnecting" ? "Lost · reconnecting" : null) ?? (connected
    ? bpm !== null
      ? `${String(bpm)} bpm`
      : noContact
        ? "No contact"
        : "Waiting"
    : "Connecting");
  const bad = !!problem || read?.state === "reconnecting" || (connected && noContact);

  return strap ? (
    <div className="card">
      <div className="row" style={{ alignItems: "center" }}>
        <strong>{strap.name}</strong>
        <span style={{ fontSize: live ? 20 : 14, fontWeight: 800, color: bad ? "var(--danger)" : live ? "var(--accent)" : "var(--muted)" }}>
          {status}
        </span>
      </div>
      <div className="btn-row" style={{ marginTop: 8 }}>
        {problem && (
          <button className="btn sm" style={{ width: "auto" }} onClick={() => { reset(); setAttempt((a) => a + 1); }}>
            Retry
          </button>
        )}
        {!changing && (
          <button className="btn sm ghost" style={{ width: "auto" }} onClick={() => { setChanging(true); }}>Change</button>
        )}
      </div>
      {changing && <div style={{ marginTop: 8 }}><StrapPicker onPicked={(s) => { reset(); setChanging(false); setStrap(s); }} /></div>}
    </div>
  ) : (
    <div className="card">
      <div className="muted" style={{ marginBottom: 8 }}>No heart rate</div>
      <StrapPicker onPicked={(s) => { setStrap(s); }} />
    </div>
  );
}

/**
 * Between pressing Start on a guided workout and its clock starting:
 * connect the strap and see it live, then start — or start without it.
 * `onStart(true)` means with heart rate.
 */
export function HrConnectSheet({ title, onStart, onCancel }: {
  title: string;
  onStart: (withHr: boolean) => void;
  onCancel: () => void;
}) {
  const [live, setLive] = useState(false);
  return (
    <Sheet title={title} onClose={onCancel}>
      <StrapCard onLive={setLive} />
      <button className="btn primary" style={{ marginTop: 12 }} disabled={!live} onClick={() => { onStart(true); }}>
        Start
      </button>
      <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => { onStart(false); }}>
        Start without HR
      </button>
    </Sheet>
  );
}
