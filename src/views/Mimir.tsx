import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ChatItem, Template } from "../types";
import { useApp } from "../lib/app-context";
import { clearChat, saveFromChat, send, stop, subscribeTurn, turnSnapshot } from "../lib/mimir";
import { loadMimirSettings } from "../lib/openrouter";
import { templatesWith, withoutProgram } from "../lib/programs";
import { templateLength, LEVEL_LABEL } from "../lib/catalog";
import { formatSeconds } from "../lib/units";
import { ConfirmSheet } from "../components/ui";
import { IconTrash } from "../components/icons";

const STARTERS = [
  "What should I train today?",
  "Plan my week",
  "Build me a new program",
  "Where am I stalling?",
];

/**
 * Mímir, the trainer: a chat that sets up programs with the owner and
 * recommends what to do from the history. See lib/mimir.ts.
 */
export default function Mimir({ goto, openWorkout }: { goto: (t: "settings") => void; openWorkout: (id: string) => void }) {
  const { data, update } = useApp();
  const turn = useSyncExternalStore(subscribeTurn, turnSnapshot);
  const programs = data.programs;
  const items = data.mimir.items;
  const [draft, setDraft] = useState("");
  const [showPrograms, setShowPrograms] = useState(false);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const [settings] = useState(loadMimirSettings);
  const hasKey = settings.apiKey !== "";
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [items.length, turn.busy]);

  const submit = (text: string) => {
    if (!text.trim() || turn.busy !== null) return;
    setDraft("");
    void send(loadMimirSettings(), data, update, text);
  };

  return (
    <div className="screen mimir-screen">
      <div className="eyebrow">Mímir · keeper of the well</div>
      <h2 className="screen-title">Trainer</h2>
      <div className="filter-row tight">
        <button className={`filter-chip ${showPrograms ? "on" : ""}`} aria-pressed={showPrograms} onClick={() => { setShowPrograms((v) => !v); }}>
          My programs · {programs.length}
        </button>
        {items.length > 0 && (
          <button className="filter-chip" disabled={turn.busy !== null} onClick={() => { clearChat(update); }}>
            New chat
          </button>
        )}
      </div>

      {showPrograms && (
        <div className="card" style={{ marginTop: 10 }}>
          {programs.length === 0 && <div className="muted">None saved yet</div>}
          {programs.map((p) => (
            <div key={p.id} className="row" style={{ alignItems: "center", padding: "6px 0" }}>
              <button className="link" style={{ flex: 1, textAlign: "left" }} onClick={() => { openWorkout(p.id); }}>
                {p.template.name}
              </button>
              <button className="btn ghost sm" style={{ width: "auto" }} aria-label={`Delete ${p.template.name}`} onClick={() => { setDeleting(p.template); }}>
                <IconTrash />
              </button>
            </div>
          ))}
        </div>
      )}

      {!hasKey && (
        <div className="card" style={{ marginTop: 10 }}>
          <div style={{ color: "var(--danger)" }}>No OpenRouter key</div>
          <button className="btn" style={{ marginTop: 10 }} onClick={() => { goto("settings"); }}>
            Skipan → Mímir
          </button>
        </div>
      )}

      <div className="mimir-chat">
        {items.length === 0 && hasKey && (
          <div className="filter-row" style={{ flexWrap: "wrap" }}>
            {STARTERS.map((s) => (
              <button key={s} className="filter-chip" onClick={() => { submit(s); }}>{s}</button>
            ))}
          </div>
        )}
        {items.map((row) => (
          <Item
            key={row.id}
            item={row.body}
            find={(id) => templatesWith(programs).find((t) => t.id === id)}
            onSave={(t) => { saveFromChat(update, row.id, t); }}
            onOpen={openWorkout}
          />
        ))}
        {turn.busy !== null && (
          <div className="mimir-busy muted">
            {turn.busy}…
            <button className="link" style={{ marginLeft: 10 }} onClick={stop}>Stop</button>
          </div>
        )}
        {turn.failure && (
          <div className="persist-error" role="status">
            <div style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>{turn.failure.text}</div>
            <button
              className="btn ghost sm"
              style={{ width: "auto" }}
              onClick={() => { if (turn.failure) void send(loadMimirSettings(), data, update, turn.failure.message, true); }}
            >
              Retry
            </button>
          </div>
        )}
        <div ref={end} />
      </div>

      <form
        className="mimir-input"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <textarea
          rows={2}
          value={draft}
          placeholder={hasKey ? "Ask Mímir" : "Add a key in Skipan first"}
          disabled={!hasKey}
          onChange={(e) => { setDraft(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(draft);
            }
          }}
        />
        <button className="btn primary" style={{ width: "auto" }} disabled={!hasKey || turn.busy !== null || !draft.trim()}>
          Send
        </button>
      </form>

      {deleting && (
        <ConfirmSheet
          title={`Delete ${deleting.name}?`}
          message="Sessions you logged with it stay in the Saga."
          confirmLabel="Delete"
          onConfirm={() => { update((d) => withoutProgram(d, deleting.id)); }}
          onClose={() => { setDeleting(null); }}
        />
      )}
    </div>
  );
}

function Item({ item, find, onSave, onOpen }: {
  item: ChatItem;
  find: (id: string) => Template | undefined;
  onSave: (t: Template) => void;
  onOpen: (id: string) => void;
}) {
  switch (item.kind) {
    case "user":
      return <div className="mimir-msg user">{item.text}</div>;
    case "mimir":
      return <div className="mimir-msg">{item.text}</div>;
    case "error":
      return <div className="mimir-msg" style={{ color: "var(--danger)" }}>{item.text}</div>;
    case "program":
      return (
        <ProgramCard template={item.template}>
          {item.saved ? (
            <button className="btn sm" onClick={() => { onOpen(item.template.id); }}>Saved · open in Hunt</button>
          ) : (
            <button className="btn primary sm" onClick={() => { onSave(item.template); }}>
              {item.replaces ? "Save over the old one" : "Save to the Hunt"}
            </button>
          )}
        </ProgramCard>
      );
    case "pick": {
      const t = find(item.templateId);
      if (!t) return <div className="mimir-msg" style={{ color: "var(--danger)" }}>Workout gone · {item.templateId}</div>;
      return (
        <ProgramCard template={t} why={item.why}>
          <button className="btn primary sm" onClick={() => { onOpen(t.id); }}>Open</button>
        </ProgramCard>
      );
    }
  }
}

function ProgramCard({ template: t, why, children }: { template: Template; why?: string; children: ReactNode }) {
  const { data } = useApp();
  const len = templateLength(t);
  const names = useMemo(() => {
    const byId = new Map(data.exercises.map((e) => [e.id, e.name]));
    if (t.emom) {
      return t.emom.stations.map((s) => {
        const n = byId.get(s.exerciseId) ?? s.exerciseId;
        const counts = s.reps ?? s.seconds ?? [];
        return `${n} ${counts.join("/")}${s.seconds ? " s" : ""}`;
      });
    }
    if (t.forTime) return t.forTime.stages.map((s) => s.label);
    if (t.flow) return t.flow.steps.map((s) => `${byId.get(s.exerciseId) ?? s.exerciseId}${s.side ? ` (${s.side})` : ""} ${String(s.seconds)} s`);
    if (t.ride) return t.ride.segments.map((s) => `${s.label} ${s.seconds ? formatSeconds(s.seconds) : `${String(s.kcal)} kcal`} · ${String(s.ftp[0])}–${String(s.ftp[1])} %`);
    return t.exerciseIds.map((id) => byId.get(id) ?? id);
  }, [t, data.exercises]);
  return (
    <div className="card mimir-card">
      <div className="row">
        <strong style={{ flex: 1 }}>{t.name}</strong>
        <span className="chip gold">{t.branch}</span>
      </div>
      {why && <div style={{ fontSize: 13, marginTop: 6 }}>{why}</div>}
      <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>{t.scheme}</div>
      <div className="workout-card-chips">
        <span className={`chip level-${t.level}`}>{LEVEL_LABEL[t.level]}</span>
        {len && <span className="chip accent">{len.exact ? formatSeconds(len.seconds) : `≈ ${String(Math.round(len.seconds / 60))} min`}</span>}
      </div>
      {!why && (
        <ol className="mimir-stations">
          {names.map((n, i) => <li key={i}>{n}</li>)}
        </ol>
      )}
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}
