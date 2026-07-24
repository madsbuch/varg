import { useMemo, useState } from "react";
import type { Tab } from "../App";
import { useApp } from "../lib/app-context";
import { Mark, IconFlame, IconClock, IconMusic } from "../components/icons";
import { Stat } from "../components/ui";
import { MusicSettingsSheet } from "../components/BattleTrack";
import { formatRelative } from "../lib/units";

function startOfWeek(): number {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

export default function Home({ goto }: { goto: (t: Tab) => void }) {
  const { data } = useApp();
  const [showMusic, setShowMusic] = useState(false);

  const finished = useMemo(
    () => data.sessions.filter((s) => s.finishedAt),
    [data.sessions],
  );

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

  return (
    <div className="screen">
      <div className="topbar">
        <div className="brand">
          <Mark className="mark" />
          <h1>Varg</h1>
        </div>
        <button
          className="check"
          aria-label="Music settings"
          onClick={() => setShowMusic(true)}
        >
          <IconMusic />
        </button>
      </div>

      {showMusic && <MusicSettingsSheet onClose={() => setShowMusic(false)} />}

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
        onClick={() => goto("train")}
      >
        Start a session
      </button>

      <div className="section-label">Recent sessions</div>
      {recent.length === 0 ? (
        <div className="card">
          <div className="muted">
            No sessions logged yet. Head to{" "}
            <span className="link" onClick={() => goto("train")}>
              Train
            </span>{" "}
            to begin.
          </div>
        </div>
      ) : (
        recent.map((s) => (
          <div key={s.id} className="list-item">
            <div>
              <div className="title">{s.name}</div>
              <div className="sub">
                {s.entries.length} exercises ·{" "}
                {s.entries.reduce((a, e) => a + e.sets.length, 0)} sets
              </div>
            </div>
            <span className="chip">
              <IconClock style={{ width: 14, height: 14 }} />
              {formatRelative(s.date)}
            </span>
          </div>
        ))
      )}

      <div className="section-label">Records</div>
      <button className="list-item" onClick={() => goto("records")}>
        <div>
          <div className="title">Personal records</div>
          <div className="sub">{data.prs.length} tracked</div>
        </div>
        <span className="chip accent">View</span>
      </button>
    </div>
  );
}
