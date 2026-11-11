import { useMemo, useState } from "react";
import type { Tab } from "../App";
import type { SagaView } from "./History";
import { useApp } from "../lib/app-context";
import { Mark, IconFlame } from "../components/icons";
import { Stat } from "../components/ui";
import { collapsePRs } from "../lib/prs";
import { SessionDetails } from "../components/SessionDetails";
import { SessionRow } from "./History";

function startOfWeek(): number {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

export default function Home({ goto }: { goto: (t: Tab, view?: SagaView) => void }) {
  const { data } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);

  const finished = useMemo(
    () =>
      data.sessions
        .filter((s) => s.finishedAt)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [data.sessions],
  );

  // Collapsed, so this agrees with the Records screen: a manual entry the
  // auto record beat is stored but is not a separate tracked record.
  const prCount = useMemo(() => collapsePRs(data.prs).length, [data.prs]);

  const thisWeek = useMemo(() => {
    const wk = startOfWeek();
    return finished.filter((s) => new Date(s.date).getTime() >= wk).length;
  }, [finished]);

  const streak = useMemo(() => {
    // consecutive days (back from today) with at least one finished session
    const days = new Set(
      finished.map((s) => new Date(s.date).toDateString()),
    );
    let n = 0;
    const d = new Date();
    // allow today to be missing without breaking a streak
    if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
    while (days.has(d.toDateString())) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }, [finished]);

  const recent = finished.slice(0, 4);
  const open = openId ? data.sessions.find((s) => s.id === openId) : undefined;

  return (
    <div className="screen">
      <div className="topbar">
        <div className="brand">
          <Mark className="mark" />
          <h1>Varg</h1>
        </div>
      </div>

      <div className="eyebrow">Varg · Old Norse for wolf</div>
      <h2 className="screen-title" style={{ marginTop: 4 }}>
        Feed the wolf
      </h2>

      <div className="stat-grid">
        <Stat n={finished.length} l="Sessions" />
        <Stat n={thisWeek} l="This week" />
        <Stat
          n={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {streak}
              <IconFlame style={{ width: 20, height: 20 }} />
            </span>
          }
          l="Day streak"
        />
      </div>

      <button
        className="btn primary"
        style={{ marginTop: 16 }}
        onClick={() => { goto("train"); }}
      >
        Start a session
      </button>

      <div className="section-label">Recent sessions</div>
      {recent.length === 0 ? (
        <div className="card">
          <div className="muted">
            No sessions logged yet. Head to{" "}
            <span className="link" onClick={() => { goto("train"); }}>
              Hunt
            </span>{" "}
            to begin.
          </div>
        </div>
      ) : (
        <>
          {recent.map((s) => (
            <SessionRow key={s.id} session={s} onOpen={() => { setOpenId(s.id); }} />
          ))}
          {finished.length > recent.length && (
            <button
              className="btn ghost"
              style={{ marginTop: 8 }}
              onClick={() => { goto("history", "sessions"); }}
            >
              All {finished.length} sessions in the Saga
            </button>
          )}
        </>
      )}

      <div className="section-label">Records</div>
      <button className="list-item" onClick={() => { goto("history", "records"); }}>
        <div>
          <div className="title">Personal records</div>
          <div className="sub">{prCount} tracked</div>
        </div>
        <span className="chip accent">View</span>
      </button>

      {open && <SessionDetails session={open} onClose={() => { setOpenId(null); }} />}
    </div>
  );
}
