import type { Exercise, Template } from "../types";
import { libraryFor } from "../lib/library";
import { BattleTrack } from "./BattleTrack";
import ExerciseAnim from "./ExerciseAnim";
import { Sheet } from "./ui";

export function WorkoutDetails({ template, exercises, onStart, onClose }: {
  template: Template;
  exercises: Exercise[];
  onStart: () => void;
  onClose: () => void;
}) {
  const byId = new Map(exercises.map(ex => [ex.id, ex]));
  // Keep every slot, including repeated movements and missing exercises.
  const stations = template.exerciseIds.map(id => byId.get(id));
  const missing = stations.some(ex => !ex);
  const plan = template.interval;

  return (
    <Sheet title={template.name} onClose={onClose}>
      <span className="chip gold">{template.branch}</span>
      <p className="muted">{template.description}</p>
      <div className="card">
        <h3 style={{ fontSize: 15 }}>The workout</h3>
        <p style={{ margin: "8px 0 0" }}>{template.scheme}</p>
        {plan && <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          Follow the stations below {plan.rounds === 1 ? "once" : `for ${String(plan.rounds)} rounds`}.
          {plan.rest > 0
            ? ` Rest ${String(plan.rest)} seconds between stations, including between rounds. No rest after the final station.`
            : " Move straight to the next station, with no rest."}
        </p>}
      </div>

      <BattleTrack cacheKey={template.id} workoutName={template.name} profile={template.music} />

      <div className="section-label">{plan ? "Stations in each round" : "Exercise sequence"}</div>
      <ol className="workout-stations">
        {stations.map((ex, i) => {
          const guide = ex ? libraryFor(ex) : null;
          return (
            <li key={`${String(i)}-${template.exerciseIds[i] ?? "missing"}`}>
              <span className="workout-station-number">{i + 1}</span>
              {ex && guide ? <details className="workout-station">
                <summary>
                  <ExerciseAnim anim={guide.anim} size={62} />
                  <span>
                    <strong>{ex.name}</strong>
                    <span className="sub">{plan ? `${String(plan.work)} s work · ` : ""}View form cues</span>
                  </span>
                </summary>
                <ul className="workout-cues">{guide.cues.map(cue => <li key={cue}>{cue}</li>)}</ul>
              </details> : <span style={{ color: "var(--danger)" }}>Exercise unavailable — update the app to restore it.</span>}
            </li>
          );
        })}
      </ol>
      {missing && <p style={{ color: "var(--danger)" }}>This workout cannot start until all its exercises are available.</p>}
      <div className="workout-start">
        <button className="btn primary" style={{ width: "100%" }} disabled={missing} onClick={onStart}>
          {plan ? "Start guided" : "Start workout"}
        </button>
      </div>
    </Sheet>
  );
}
