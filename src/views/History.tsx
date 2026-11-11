import { useMemo, useState } from "react";
import type { Session } from "../types";
import { useApp } from "../lib/app-context";
import { formatSeconds } from "../lib/units";
import { SessionDetails, sessionSeconds } from "../components/SessionDetails";
import { Segmented, Stat } from "../components/ui";
import Records from "./Records";
import { IconScroll } from "../components/icons";
import { WatchDetails, WatchRow } from "../components/Watch";
import { matchSessions, useGarmin, type GarminActivity } from "../lib/garmin";

/** A list row for one finished session; tapping it opens the details. */
export function SessionRow({ session, watch, onOpen }: {
  session: Session;
  /** The watch activity it overlaps, if any. */
  watch?: GarminActivity | undefined;
  onOpen: () => void;
}) {
  const seconds = sessionSeconds(session);
  const n = session.entries.length;
  const d = new Date(session.date);
  const when = `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  return (
    <button className="list-item" onClick={onOpen}>
      <div style={{ minWidth: 0 }}>
        <div className="title">{session.name}</div>
        <div className="sub">
          {when} · {n} exercise{n === 1 ? "" : "s"}
          {watch?.avgHr != null && ` · ♥ ${String(Math.round(watch.avgHr))}`}
        </div>
      </div>
      {seconds != null && (
        <span className="chip" style={{ flexShrink: 0 }}>{formatSeconds(seconds)}</span>
      )}
    </button>
  );
}

export type SagaView = "sessions" | "records";

type Entry =
  | { kind: "session"; at: number; session: Session }
  | { kind: "watch"; at: number; activity: GarminActivity };

/**
 * Saga: the athlete's story. Every finished session, newest first and
 * grouped by month, and (under Afrek) the personal records they set.
 */
export default function History({ view, setView }: {
  view: SagaView;
  setView: (v: SagaView) => void;
}) {
  const { data } = useApp();
  const garmin = useGarmin();
  const [openId, setOpenId] = useState<string | null>(null);
  const [openWatch, setOpenWatch] = useState<GarminActivity | null>(null);

  const finished = useMemo(
    () =>
      data.sessions
        .filter((s) => s.finishedAt)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [data.sessions],
  );

  // A watch activity that overlaps a Varg session belongs to it; the rest
  // were recorded on the watch alone and get their own rows.
  const matches = useMemo(() => matchSessions(finished, garmin.activities), [finished, garmin.activities]);
  const watchOnly = useMemo(() => {
    const used = new Set([...matches.values()].map((a) => a.id));
    return garmin.activities.filter((a) => !used.has(a.id));
  }, [matches, garmin.activities]);

  const months = useMemo(() => {
    const entries: Entry[] = [
      ...finished.map((s): Entry => ({ kind: "session", at: new Date(s.date).getTime(), session: s })),
      ...watchOnly.map((a): Entry => ({ kind: "watch", at: a.start, activity: a })),
    ].sort((a, b) => b.at - a.at);
    const groups: { label: string; entries: Entry[] }[] = [];
    for (const e of entries) {
      const label = new Date(e.at).toLocaleDateString(undefined, { month: "long", year: "numeric" });
      const last = groups[groups.length - 1];
      if (last?.label === label) last.entries.push(e);
      else groups.push({ label, entries: [e] });
    }
    return groups;
  }, [finished, watchOnly]);

  const totalSeconds = useMemo(
    () =>
      finished.reduce((a, s) => a + (sessionSeconds(s) ?? 0), 0) +
      watchOnly.reduce((a, w) => a + w.seconds, 0),
    [finished, watchOnly],
  );

  // Looked up by id so a delete from the sheet closes it cleanly.
  const open = openId ? data.sessions.find((s) => s.id === openId) : undefined;

  return (
    <div className="screen">
      <div className="eyebrow">Saga · Old Norse for story</div>
      <h2 className="screen-title">{view === "records" ? "Great deeds" : "Every hunt"}</h2>

      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={view}
          options={[
            { value: "sessions", label: "Sessions" },
            { value: "records", label: "Afrek · Records" },
          ]}
          onChange={setView}
        />
      </div>

      {view === "records" ? <Records /> : <>

      <div className="stat-grid">
        <Stat n={finished.length + watchOnly.length} l="Sessions" />
        <Stat n={Math.round(totalSeconds / 3600)} l="Hours" />
        <Stat n={months.length} l="Months" />
      </div>

      {months.length === 0 ? (
        <div className="empty">
          <IconScroll />
          <div style={{ fontWeight: 700, color: "var(--text)" }}>No sessions yet</div>
          <div style={{ marginTop: 4 }}>Finish a hunt and it is written here.</div>
        </div>
      ) : (
        months.map((m) => (
          <div key={m.label}>
            <div className="section-label">
              {m.label} · {m.entries.length}
            </div>
            {m.entries.map((e) =>
              e.kind === "session" ? (
                <SessionRow
                  key={e.session.id}
                  session={e.session}
                  watch={matches.get(e.session.id)}
                  onOpen={() => { setOpenId(e.session.id); }}
                />
              ) : (
                <WatchRow key={`w${String(e.activity.id)}`} activity={e.activity} onOpen={() => { setOpenWatch(e.activity); }} />
              ),
            )}
          </div>
        ))
      )}
      </>}

      {open && <SessionDetails session={open} onClose={() => { setOpenId(null); }} />}
      {openWatch && <WatchDetails activity={openWatch} onClose={() => { setOpenWatch(null); }} />}
    </div>
  );
}
