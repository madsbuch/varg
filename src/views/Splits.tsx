import { useApp } from "../lib/app-context";

export default function Splits() {
  const { data } = useApp();
  const exById = new Map(data.exercises.map((e) => [e.id, e]));

  return (
    <div className="screen">
      <div className="eyebrow">Splits</div>
      <h2 className="screen-title">Training splits</h2>
      <p className="muted">Start a split day from the Hunt tab.</p>
      {data.splits.map((split) => (
        <div key={split.id} className="card" style={{ marginBottom: 12 }}>
          <h3>{split.name}</h3>
          {split.description && <p className="muted">{split.description}</p>}
          {split.days.map((day) => (
            <div key={day.id}>
              <div className="section-label">{day.name}</div>
              {day.exerciseIds.map((id) => (
                <div key={id} style={{ padding: "4px 0" }}>
                  {exById.get(id)?.name ?? "Unknown exercise"}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
