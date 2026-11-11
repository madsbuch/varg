import { useMemo, useState } from "react";
import type { Session } from "../types";
import { useApp } from "../lib/app-context";
import { formatSeconds } from "../lib/units";
import { SessionDetails, sessionSeconds } from "../components/SessionDetails";
import { Stat } from "../components/ui";
import { IconScroll } from "../components/icons";

/** A list row for one finished session; tapping it opens the details. */
export function SessionRow({ session, onOpen }: { session: Session; onOpen: () => void }) {
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
        </div>
      </div>
      {seconds != null && (
        <span className="chip" style={{ flexShrink: 0 }}>{formatSeconds(seconds)}</span>
      )}
    </button>
  );
}

/** Saga: every finished session, newest first, grouped by month. */
export default function History() {
  const { data } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);

  const finished = useMemo(
    () =>
      data.sessions
        .filter((s) => s.finishedAt)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [data.sessions],
  );

  const months = useMemo(() => {
    const groups: { label: string; sessions: Session[] }[] = [];
    for (const s of finished) {
      const label = new Date(s.date).toLocaleDateString(undefined, { month: "long", year: "numeric" });
      const last = groups[groups.length - 1];
      if (last?.label === label) last.sessions.push(s);
      else groups.push({ label, sessions: [s] });
    }
    return groups;
  }, [finished]);

  const totalSeconds = useMemo(
    () => finished.reduce((a, s) => a + (sessionSeconds(s) ?? 0), 0),
    [finished],
  );

  // Looked up by id so a delete from the sheet closes it cleanly.
  const open = openId ? data.sessions.find((s) => s.id === openId) : undefined;

  return (
    <div className="screen">
      <div className="eyebrow">Saga · Old Norse for story</div>
      <h2 className="screen-title">Every hunt</h2>

      <div className="stat-grid">
        <Stat n={finished.length} l="Sessions" />
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
              {m.label} · {m.sessions.length}
            </div>
            {m.sessions.map((s) => (
              <SessionRow key={s.id} session={s} onOpen={() => { setOpenId(s.id); }} />
            ))}
          </div>
        ))
      )}

      {open && <SessionDetails session={open} onClose={() => { setOpenId(null); }} />}
    </div>
  );
}
