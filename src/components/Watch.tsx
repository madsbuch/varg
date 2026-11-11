import type { GarminActivity, GarminReadiness } from "../lib/garmin";
import { typeLabel } from "../lib/garmin";
import { formatSeconds, kmFromMeters } from "../lib/units";
import { formatWhen } from "./SessionDetails";
import { Sheet } from "./ui";
import { IconWatch } from "./icons";

/** "47 min", "1:12" style lengths for the Den card. */
function hoursMinutes(s: number): string {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h > 0 ? `${String(h)}h ${String(m).padStart(2, "0")}m` : `${String(m)} min`;
}

/** Time in heart-rate zones 1-5 as one bar, cool to hot. */
function ZoneBar({ zones }: { zones: number[] }) {
  const total = zones.reduce((a, z) => a + z, 0);
  if (total <= 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="zone-bar" role="img" aria-label="Time in heart-rate zones">
        {zones.map((z, i) => (
          z > 0 && <span key={i} className={`z${String(i + 1)}`} style={{ flexGrow: z }} />
        ))}
      </div>
      <div className="zone-legend">
        {zones.map((z, i) => (
          <span key={i}>Z{i + 1} {formatSeconds(z)}</span>
        ))}
      </div>
    </div>
  );
}

/** What the watch measured: heart rate, power, energy, distance, zones. */
export function WatchStats({ activity }: { activity: GarminActivity }) {
  const facts: [string, string][] = [];
  if (activity.avgHr != null) facts.push(["Avg HR", `${String(Math.round(activity.avgHr))} bpm`]);
  if (activity.maxHr != null) facts.push(["Max HR", `${String(Math.round(activity.maxHr))} bpm`]);
  if (activity.avgPower != null) facts.push(["Avg power", `${String(Math.round(activity.avgPower))} W`]);
  if (activity.normPower != null) facts.push(["NP", `${String(Math.round(activity.normPower))} W`]);
  if (activity.kcal != null) facts.push(["Energy", `${String(Math.round(activity.kcal))} kcal`]);
  if (activity.meters != null) facts.push(["Distance", `${String(kmFromMeters(activity.meters))} km`]);
  facts.push(["Watch time", formatSeconds(activity.seconds)]);
  return (
    <>
      <div className="watch-facts">
        {facts.map(([l, v]) => (
          <div key={l}>
            <div className="l">{l}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>
      {activity.hrZones && <ZoneBar zones={activity.hrZones} />}
    </>
  );
}

/** The watch's side of a Varg session, inside its details sheet. */
export function WatchCard({ activity }: { activity: GarminActivity }) {
  return (
    <>
      <div className="section-label">From the watch</div>
      <div className="card">
        <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
          {activity.name} · {typeLabel(activity.type)} · started {formatWhen(new Date(activity.start).toISOString())}
        </div>
        <WatchStats activity={activity} />
      </div>
    </>
  );
}

/** A Saga row for an activity recorded on the watch alone. */
export function WatchRow({ activity, onOpen }: { activity: GarminActivity; onOpen: () => void }) {
  const d = new Date(activity.start);
  const when = `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  return (
    <button className="list-item" onClick={onOpen}>
      <div style={{ minWidth: 0 }}>
        <div className="title">{activity.name}</div>
        <div className="sub">
          {when} · {typeLabel(activity.type)}
          {activity.avgHr != null && ` · ♥ ${String(Math.round(activity.avgHr))}`}
        </div>
      </div>
      <span className="chip watch" style={{ flexShrink: 0 }}>
        <IconWatch style={{ width: 13, height: 13 }} />
        {formatSeconds(activity.seconds)}
      </span>
    </button>
  );
}

export function WatchDetails({ activity, onClose }: { activity: GarminActivity; onClose: () => void }) {
  return (
    <Sheet title={activity.name} onClose={onClose}>
      <span className="row" style={{ gap: 6, justifyContent: "flex-start", flexWrap: "wrap" }}>
        <span className="chip watch"><IconWatch style={{ width: 13, height: 13 }} /> Garmin</span>
        <span className="chip">{typeLabel(activity.type)}</span>
      </span>
      <p className="muted">{formatWhen(new Date(activity.start).toISOString())}</p>
      <div className="card">
        <WatchStats activity={activity} />
      </div>
      <p className="faint" style={{ fontSize: 13 }}>
        Recorded on the watch with no Varg session alongside it. A Varg session
        that overlaps it in time shows these numbers in its own details instead.
      </p>
    </Sheet>
  );
}

const HRV_STATUS: Record<string, string> = {
  BALANCED: "balanced",
  UNBALANCED: "unbalanced",
  LOW: "low",
  POOR: "poor",
};

/**
 * Last night, from the watch: how rested the athlete is before picking a
 * hunt. Shows whatever arrived; parts that failed say so in red.
 */
export function ReadinessCard({ readiness, stale, error }: {
  readiness: GarminReadiness | undefined;
  /** The readiness is from an earlier day than today. */
  stale: boolean;
  error: string | undefined;
}) {
  const r = readiness;
  const tiles: [string, string, (string | undefined)?][] = [];
  if (r?.sleepSeconds != null) tiles.push(["Sleep", hoursMinutes(r.sleepSeconds), r.sleepScore != null ? `score ${String(r.sleepScore)}` : undefined]);
  if (r?.hrvLastNight != null) tiles.push(["HRV", `${String(Math.round(r.hrvLastNight))} ms`, r.hrvStatus ? (HRV_STATUS[r.hrvStatus] ?? r.hrvStatus.toLowerCase()) : undefined]);
  if (r?.bodyBatteryAtWake != null || r?.bodyBatteryNow != null) {
    tiles.push(["Body Battery", String(r.bodyBatteryAtWake ?? r.bodyBatteryNow), r.bodyBatteryAtWake != null ? (r.bodyBatteryNow != null ? `at wake · now ${String(r.bodyBatteryNow)}` : "at wake") : "now"]);
  }
  if (r?.restingHr != null) tiles.push(["Resting HR", `${String(r.restingHr)} bpm`]);

  return (
    <>
      <div className="section-label">Last night</div>
      <div className="card">
        {tiles.length > 0 ? (
          <div className="readiness">
            {tiles.map(([l, v, sub]) => (
              <div key={l}>
                <div className="l">{l}</div>
                <div className="v">{v}</div>
                {sub && <div className="s">{sub}</div>}
              </div>
            ))}
          </div>
        ) : (
          !error && <div className="muted">Nothing from the watch for last night yet.</div>
        )}
        {(error ?? stale) && (
          <div style={{ color: "var(--danger)", fontSize: 13, marginTop: tiles.length ? 10 : 0 }}>
            {error ? `Garmin sync failed: ${error}` : `This is from ${r?.date ?? "an earlier day"}; today's has not synced.`}
          </div>
        )}
        {r && r.errors.length > 0 && (
          <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{r.errors.join(" · ")}</div>
        )}
      </div>
    </>
  );
}
