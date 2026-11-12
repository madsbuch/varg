/**
 * A song's beat metadata on its card: what the beat model found, live
 * while it runs, and the refusal in red with a way to run it again. The
 * player only ever reads this; finding out here is better than mid-ride.
 */
import { useEffect, useState } from "react";
import { isAnalysing, onSongMeta, reanalyzeSong, songMeta } from "../lib/song-loops";
import { formatSeconds } from "../lib/units";
import { MIN_DROP_DB } from "../lib/beatgrid";

export function SongBeats({ songId, createdAt }: { songId: string; createdAt: string }) {
  const [, setTick] = useState(0);
  useEffect(() => onSongMeta(() => { setTick((n) => n + 1); }), []);
  const meta = songMeta(songId, createdAt);
  const busy = isAnalysing(songId);
  const line = { fontSize: 12, marginTop: 6 } as const;

  if (busy) return <div className="faint" style={line}>Beats · analysing…</div>;
  if (!meta) {
    return (
      <div className="faint" style={line}>
        Beats · not analysed{" "}
        <button className="link faint" style={{ fontSize: 12 }} onClick={() => { void reanalyzeSong(songId); }}>analyse</button>
      </div>
    );
  }
  const { loop } = meta;
  if (!loop) {
    return (
      <div style={{ ...line, color: "var(--danger)", fontWeight: 700 }}>
        {meta.refused}{meta.detail ? ` · ${meta.detail}` : ""}{" "}
        <button className="link" style={{ fontSize: 12 }} onClick={() => { void reanalyzeSong(songId); }}>analyse again</button>
      </div>
    );
  }
  return (
    <div className="faint" style={line}>
      Beats · {loop.bpm.toFixed(1)} BPM · {loop.bars}-bar loop from {formatSeconds(Math.round(loop.start))}
      {loop.dropDb >= MIN_DROP_DB ? ` on a drop (+${loop.dropDb.toFixed(0)} dB)` : ""} ·
      ±{loop.jitterMs.toFixed(0)} ms · {meta.beats.length} beats, {meta.downbeats.length} downbeats ·
      {" "}{meta.took.toFixed(1)} s
    </div>
  );
}
