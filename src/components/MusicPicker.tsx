/**
 * The music choice on an adaptive workout's page: one set, shuffle, or
 * songs ticked by hand (music-choice.ts). Saved as it is tapped. Below it,
 * the songs a ride will draw on, each with where it stands, so a song
 * without a track or a beat shows here and not mid-ride.
 */
import { useState } from "react";
import type { Intensity } from "../types";
import { loadMixChoice, missingIntensities, resolveMix, saveMixChoice, setMix } from "../lib/music-choice";
import type { MixChoice } from "../lib/music-choice";
import { allSongs, INTENSITY_NAMES, SETS, setById } from "../lib/songs";
import type { SetId } from "../lib/songs";
import { MusicLibrary } from "./MusicLibrary";
import { SongStateChip, useSongStates } from "./song-status";

export function MusicPicker({ templateId, defaultSet, used }: { templateId: string; defaultSet: SetId; used: Intensity[] }) {
  const [choice, setChoice] = useState<MixChoice>(() => loadMixChoice(templateId, defaultSet));
  const [library, setLibrary] = useState(false);
  const songs = allSongs();
  const choose = (c: MixChoice) => {
    setChoice(c);
    saveMixChoice(templateId, c);
  };
  // What the list below shows: the chosen set, every set when shuffling,
  // or the ticked songs.
  const shown: Record<Intensity, string[]> =
    choice.mode === "shuffle"
      ? { 1: [], 2: [], 3: [] }
      : choice.mode === "set" ? setMix(choice.set) : resolveMix(choice, 0).mix;
  const states = useSongStates(choice.mode === "custom" ? songs.map((s) => s.id) : [...shown[1], ...shown[2], ...shown[3]]);
  const missing = missingIntensities(choice, used);

  const toggle = (l: Intensity, id: string) => {
    if (choice.mode !== "custom") return;
    const list = choice.songs[l];
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    choose({ mode: "custom", songs: { ...choice.songs, [l]: next } });
  };

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row">
        <h3 style={{ fontSize: 15 }}>Music</h3>
        <button className="link faint" style={{ fontSize: 12 }} onClick={() => { setLibrary(true); }}>library</button>
      </div>
      <div className="filter-row" role="group" aria-label="Music" style={{ flexWrap: "wrap" }}>
        {SETS.map((s) => (
          <button
            key={s.id}
            className={`filter-chip ${choice.mode === "set" && choice.set === s.id ? "on" : ""}`}
            aria-pressed={choice.mode === "set" && choice.set === s.id}
            onClick={() => { choose({ mode: "set", set: s.id }); }}
          >
            {s.name}
          </button>
        ))}
        <button className={`filter-chip ${choice.mode === "shuffle" ? "on" : ""}`} aria-pressed={choice.mode === "shuffle"} onClick={() => { choose({ mode: "shuffle" }); }}>
          Shuffle
        </button>
        <button
          className={`filter-chip ${choice.mode === "custom" ? "on" : ""}`}
          aria-pressed={choice.mode === "custom"}
          onClick={() => {
            // Start from what is playing now, so custom is a tweak, not a blank.
            if (choice.mode !== "custom") choose({ mode: "custom", songs: choice.mode === "set" ? setMix(choice.set) : setMix(defaultSet) });
          }}
        >
          Custom
        </button>
      </div>

      {choice.mode === "shuffle" && <div className="faint" style={{ fontSize: 12 }}>A different set each ride</div>}

      {choice.mode !== "shuffle" && ([1, 2, 3] as const).filter((l) => used.includes(l)).map((l) => (
        <div key={l} style={{ marginTop: 8 }}>
          <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>{INTENSITY_NAMES[l]}</div>
          {(choice.mode === "custom" ? songs.filter((s) => s.intensity === l) : songs.filter((s) => shown[l].includes(s.id))).map((s) => {
            const on = shown[l].includes(s.id);
            return (
              <div key={s.id} className="row" style={{ padding: "5px 0", gap: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                  {choice.mode === "custom" && (
                    <input type="checkbox" checked={on} onChange={() => { toggle(l, s.id); }} style={{ width: "auto" }} />
                  )}
                  <span style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name}
                    {choice.mode === "custom" && <span className="faint"> · {setById(s.set)?.name}</span>}
                  </span>
                </label>
                <SongStateChip state={states[s.id]} />
              </div>
            );
          })}
        </div>
      ))}

      {missing.length > 0 && (
        <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 700, marginTop: 8 }}>
          No {missing.map((l) => INTENSITY_NAMES[l]).join(" or ")} songs
        </div>
      )}

      {library && <MusicLibrary onClose={() => { setLibrary(false); }} openSet={choice.mode === "set" ? choice.set : undefined} />}
    </div>
  );
}
