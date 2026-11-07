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
  // A flow lists its steps — each pose with its own time and side.
  const ids = template.flow ? template.flow.steps.map(s => s.exerciseId) : template.exerciseIds;
  const stations = ids.map(id => byId.get(id));
  const missing = stations.some(ex => !ex);
  const plan = template.interval;
  const forTime = template.forTime;
  const flow = template.flow;

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
        {flow && <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          A guided flow of {flow.steps.length} poses, each held for its own time. Each
          pose is spoken as it begins, with form cues on screen; one-sided poses
          are done left, then right.
        </p>}
        {forTime && <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          For time: the clock runs from the start until the last stage is done.
          {forTime.stages.length > 1
            ? ` Tap Done as you finish each of the ${String(forTime.stages.length)} stages — split the reps however you like — and your time for each one is saved.`
            : " Split the reps however you like, and tap Finish when the last one is done."}
          {" "}Your best completed time is the one to beat.
        </p>}
      </div>

      <BattleTrack cacheKey={template.id} workoutName={template.name} profile={template.music} />

      <div className="section-label">{plan ? "Stations in each round" : forTime ? "Movements" : flow ? "Poses" : "Exercise sequence"}</div>
      <ol className="workout-stations">
        {stations.map((ex, i) => {
          const guide = ex ? libraryFor(ex) : null;
          return (
            <li key={`${String(i)}-${ids[i] ?? "missing"}`}>
              <span className="workout-station-number">{i + 1}</span>
              {ex && guide ? <details className="workout-station">
                <summary>
                  <ExerciseAnim anim={guide.anim} size={62} mirror={flowMirror(guide.side, template.flow?.steps[i]?.side)} />
                  <span>
                    <strong>{ex.name}{template.flow?.steps[i]?.side ? ` · ${template.flow.steps[i].side}` : ""}</strong>
                    <span className="sub">
                      {plan ? `${String(plan.work)} s work · ` : ""}
                      {template.flow?.steps[i] ? `${String(template.flow.steps[i].seconds)} s · ` : ""}
                      View form cues
                    </span>
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
          {plan || flow ? "Start guided" : forTime ? "Start the clock" : "Start workout"}
        </button>
      </div>
    </Sheet>
  );
}

/** Mirror a one-sided pose's thumbnail when its step is the side not drawn. */
function flowMirror(drawn: "left" | "right" | undefined, side: "left" | "right" | undefined): boolean {
  return drawn !== undefined && side !== undefined && drawn !== side;
}
