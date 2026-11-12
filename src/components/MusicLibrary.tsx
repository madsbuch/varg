/**
 * The music library: every song set, every song in it, and the owner's
 * own songs, made here.
 *
 * Each song is a battle-track card (play, regenerate, and its beat
 * metadata under the player). A set opens on tap, so the screen does not
 * load eighteen audio players at once. A new song only describes its
 * sound (and optionally its words): its tempo, key and the kick on every
 * beat come from the set, because the mixer depends on them.
 */
import { useEffect, useState } from "react";
import type { Intensity } from "../types";
import { ensureAllTracks, deleteCachedTrack, loadMusicSettings } from "../lib/music";
import {
  addUserSong, allSongs, deleteUserSong, INTENSITY_NAMES, LIBRARY_KEY, newSongProblem, onSongsChange, SETS, setById, songKey,
} from "../lib/songs";
import type { Song, SetId } from "../lib/songs";
import { BattleTrack } from "./BattleTrack";
import { useSongStates } from "./song-status";
import { ConfirmSheet, Field, Sheet } from "./ui";

function useSongs(): Song[] {
  const [songs, setSongs] = useState(allSongs);
  useEffect(() => onSongsChange(() => { setSongs(allSongs()); }), []);
  return songs;
}

export function MusicLibrary({ onClose, openSet }: { onClose: () => void; openSet?: SetId | undefined }) {
  const songs = useSongs();
  const [open, setOpen] = useState<SetId | null>(openSet ?? null);
  const [creating, setCreating] = useState<SetId | null>(null);
  const [deleting, setDeleting] = useState<Song | null>(null);
  const states = useSongStates(songs.map((s) => s.id));

  return (
    <Sheet title="Music library" onClose={onClose}>
      {SETS.map((set) => {
        const inSet = songs.filter((s) => s.set === set.id);
        const ready = inSet.filter((s) => states[s.id] === "ready").length;
        const refused = inSet.filter((s) => states[s.id] === "refused").length;
        const isOpen = open === set.id;
        return (
          <div key={set.id}>
            <button className="list-item" aria-expanded={isOpen} onClick={() => { setOpen(isOpen ? null : set.id); }}>
              <div>
                <div className="title">{set.name}</div>
                <div className="sub">{set.sound} · {ready}/{inSet.length} ready</div>
              </div>
              {refused > 0 ? <span className="chip danger">{refused} no beat</span> : <span className="chip">{isOpen ? "Close" : "Open"}</span>}
            </button>
            {isOpen && (
              <div style={{ marginBottom: 12 }}>
                {([1, 2, 3] as const).map((l) => (
                  <div key={l}>
                    <div className="section-label">{INTENSITY_NAMES[l]} · {set.bpm[l]} BPM</div>
                    {inSet.filter((s) => s.intensity === l).map((s) => (
                      <div key={s.id}>
                        <BattleTrack
                          cacheKey={songKey(s.id)}
                          workoutName={s.name}
                          profile={{ bpm: s.bpm, style: s.style, theme: "" }}
                          label={s.user ? `${s.name} · yours` : s.name}
                          songId={s.id}
                        />
                        {s.user && (
                          <button className="link faint" style={{ fontSize: 12, marginTop: 4 }} onClick={() => { setDeleting(s); }}>
                            delete this song
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                <button className="btn" style={{ marginTop: 12 }} onClick={() => { setCreating(set.id); }}>
                  New {set.name} song
                </button>
              </div>
            )}
          </div>
        );
      })}
      {songs.length > 0 && Object.values(states).some((s) => s === "missing") && !loadMusicSettings().apiKey && (
        <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          Songs compose with your kie.ai key (Skipan).
        </div>
      )}

      {creating && <NewSongSheet set={creating} onClose={() => { setCreating(null); }} />}
      {deleting && (
        <ConfirmSheet
          title="Delete song"
          message={`Delete "${deleting.name}" from ${setById(deleting.set)?.name ?? "its set"}? Its composed track goes too; rides stop playing it.`}
          confirmLabel="Delete"
          onConfirm={() => {
            void deleteCachedTrack(songKey(deleting.id)).catch(() => undefined);
            deleteUserSong(deleting.id);
          }}
          onClose={() => { setDeleting(null); }}
        />
      )}
    </Sheet>
  );
}

/** Make a song: its sound and words; the set fixes tempo, key and beat. */
function NewSongSheet({ set: initialSet, onClose }: { set: SetId; onClose: () => void }) {
  const [name, setName] = useState("");
  const [set, setSet] = useState<SetId>(initialSet);
  const [intensity, setIntensity] = useState<Intensity>(1);
  const [style, setStyle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [error, setError] = useState("");
  const draft = { name, set, intensity, style, lyrics };
  const problem = newSongProblem(draft);
  const bpm = setById(set)?.bpm[intensity] ?? 144;
  const hasKey = !!loadMusicSettings().apiKey;

  const create = () => {
    setError("");
    try {
      addUserSong(draft);
      // The composer requests every song without a track: this one now.
      void ensureAllTracks();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Sheet title="New song" onClose={onClose} dismissOnBackdrop={false}>
      <Field label="Name">
        <input value={name} maxLength={40} placeholder="Midnight brass" onChange={(e) => { setName(e.target.value); }} />
      </Field>
      <Field label="Set">
        <div className="filter-row" role="group" aria-label="Set" style={{ paddingTop: 0 }}>
          {SETS.map((x) => (
            <button key={x.id} className={`filter-chip ${set === x.id ? "on" : ""}`} aria-pressed={set === x.id} onClick={() => { setSet(x.id); }}>
              {x.name}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Intensity">
        <div className="segmented" role="group" aria-label="Intensity">
          {([1, 2, 3] as const).map((l) => (
            <button key={l} className={intensity === l ? "on" : ""} aria-pressed={intensity === l} onClick={() => { setIntensity(l); }}>
              {INTENSITY_NAMES[l]}
            </button>
          ))}
        </div>
      </Field>
      <div className="faint" style={{ fontSize: 12, margin: "-4px 0 10px" }}>
        {bpm} BPM · {LIBRARY_KEY} · kick on every beat · from the set
      </div>
      <Field label="Sound">
        <textarea
          rows={3}
          value={style}
          maxLength={400}
          placeholder="Genre, instruments, mood: e.g. deep house, warm saxophone, rolling bass, smoky"
          onChange={(e) => { setStyle(e.target.value); }}
        />
      </Field>
      <Field label="Lyrics (optional)">
        <textarea
          rows={4}
          value={lyrics}
          maxLength={2000}
          placeholder={"[Chorus]\nCome on! Come on!"}
          onChange={(e) => { setLyrics(e.target.value); }}
        />
      </Field>
      {(error || (problem && (name || style))) && (
        <div style={{ color: "var(--danger)", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{error || problem}</div>
      )}
      <button className="btn primary" disabled={problem !== null || !hasKey} onClick={create}>
        {hasKey ? "Create · one Suno generation" : "Needs your kie.ai key (Skipan)"}
      </button>
    </Sheet>
  );
}
