/**
 * The music choice on a workout's page (music-choice.ts): follow the
 * default, its own track, one set, shuffle, or songs ticked by hand. Saved
 * as it is tapped. Below it, what the workout will play: its own track's
 * card, or the songs it draws on per intensity with where each stands, so
 * a song without a track or a beat shows here and not mid-workout.
 */
import { useState } from "react";
import type { Intensity, Template } from "../types";
import {
  clearMixChoice, loadDefaultChoice, loadMixChoice, loadOwnChoice, missingIntensities, resolveMix, saveMixChoice, setMix,
} from "../lib/music-choice";
import type { MixChoice } from "../lib/music-choice";
import { isAdaptive } from "../lib/music";
import { allSongs, INTENSITY_NAMES, SETS, setById } from "../lib/songs";
import { sectionLevels, templateSections } from "../lib/workout-music";
import { BattleTrack } from "./BattleTrack";
import { SongStateChip, useSongStates } from "./song-status";

/** A choice in a word or two: "Own track", "Anthems", "Shuffle". */
export function choiceLabel(c: MixChoice): string {
  if (c.mode === "track") return "Own track";
  if (c.mode === "set") return setById(c.set)?.name ?? c.set;
  return c.mode === "shuffle" ? "Shuffle" : "Custom";
}

export function MusicPicker({ template }: { template: Template }) {
  const adaptive = isAdaptive(template);
  const rideSet = adaptive ? template.music.set ?? "techno" : undefined;
  const [own, setOwn] = useState<MixChoice | undefined>(() => loadOwnChoice(template.id));
  const fallback = loadDefaultChoice();
  // What it plays: its own choice, else the default (an adaptive ride's
  // "own track" is its set).
  const effective = loadMixChoice(template.id, rideSet);
  const songs = allSongs();
  const used: Intensity[] = adaptive
    ? ([1, 2, 3] as const).filter((l) => template.ride?.segments.some((sg) => sg.intensity === l))
    : sectionLevels(templateSections(template));

  const choose = (c: MixChoice | undefined) => {
    setOwn(c);
    if (c) saveMixChoice(template.id, c);
    else clearMixChoice(template.id);
  };
  // What the list below shows: the chosen set, nothing when shuffling (a
  // different set each time), or the ticked songs.
  const shown: Record<Intensity, string[]> =
    effective.mode === "set" ? setMix(effective.set)
      : effective.mode === "custom" ? resolveMix(effective, 0).mix
        : { 1: [], 2: [], 3: [] };
  const states = useSongStates(effective.mode === "custom" ? songs.map((s) => s.id) : [...shown[1], ...shown[2], ...shown[3]]);
  const missing = missingIntensities(effective, used);

  const toggle = (l: Intensity, id: string) => {
    if (effective.mode !== "custom") return;
    const list = effective.songs[l];
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    choose({ mode: "custom", songs: { ...effective.songs, [l]: next } });
  };
  const chip = (label: string, on: boolean, onClick: () => void) => (
    <button key={label} className={`filter-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={onClick}>{label}</button>
  );

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h3 style={{ fontSize: 15 }}>Music</h3>
      <div className="filter-row" role="group" aria-label="Music" style={{ flexWrap: "wrap" }}>
        {chip(`Default · ${choiceLabel(fallback.mode === "track" && rideSet ? { mode: "set", set: rideSet } : fallback)}`, own === undefined, () => { choose(undefined); })}
        {!adaptive && chip("Own track", own?.mode === "track", () => { choose({ mode: "track" }); })}
        {SETS.map((s) => chip(s.name, own?.mode === "set" && own.set === s.id, () => { choose({ mode: "set", set: s.id }); }))}
        {chip("Shuffle", own?.mode === "shuffle", () => { choose({ mode: "shuffle" }); })}
        {chip("Custom", own?.mode === "custom", () => {
          // Start from what plays now, so custom is a tweak, not a blank.
          if (own?.mode !== "custom") choose({ mode: "custom", songs: setMix(effective.mode === "set" ? effective.set : rideSet ?? "techno") });
        })}
      </div>

      {effective.mode !== "track" && (
        <div className="faint" style={{ fontSize: 12 }}>
          {adaptive ? "Follows the ride's blocks" : used.map((l) => INTENSITY_NAMES[l]).join(" → ")}
          {effective.mode === "shuffle" ? " · a different set each time" : ""}
        </div>
      )}

      {effective.mode === "track" && (
        <div style={{ marginTop: 8 }}>
          <BattleTrack cacheKey={template.id} workoutName={template.name} profile={template.music} />
        </div>
      )}

      {(effective.mode === "set" || effective.mode === "custom") && used.map((l) => (
        <div key={l} style={{ marginTop: 8 }}>
          <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>{INTENSITY_NAMES[l]}</div>
          {(effective.mode === "custom" ? songs.filter((s) => s.intensity === l) : songs.filter((s) => shown[l].includes(s.id))).map((s) => {
            const on = shown[l].includes(s.id);
            return (
              <div key={s.id} className="row" style={{ padding: "5px 0", gap: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                  {effective.mode === "custom" && (
                    <input type="checkbox" checked={on} onChange={() => { toggle(l, s.id); }} style={{ width: "auto" }} />
                  )}
                  <span style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name}
                    {effective.mode === "custom" && <span className="faint"> · {setById(s.set)?.name}</span>}
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
    </div>
  );
}
