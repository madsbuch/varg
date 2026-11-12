/**
 * The adaptive ride's music: songs from the collection, mixed by the ride
 * (src/lib/mixer.ts). The ride player hands every move of its clock and
 * blocks to `setPlan`; this hook loads the songs, picks one for each
 * stretch and owns the mute button.
 *
 * Rotation: the ride's songs per intensity (the owner's choice, resolved
 * by music-choice.ts), and the n-th stretch at an intensity plays song
 * (n + seed) of its list. `seed` differs per ride, so no two rides open on
 * the same songs.
 *
 * Songs load one at a time, in the order the ride first needs them, and
 * join the mix as they arrive; a stretch whose song is not ready plays the
 * next ready one at its intensity. A song's loop is found by the beat
 * model once, when it is composed (song-loops.ts), so a ride only decodes.
 *
 * Loud, never flat: missing or refused songs are a `problem` the player
 * shows in red, while the songs that work keep playing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getAudioContext, setCueDucker } from "../lib/beep";
import { AdaptiveMixer, LayerError, prepareSong } from "../lib/mixer";
import type { Booking } from "../lib/mixer";
import { getCachedTrack, loadMusicSettings, musicLog } from "../lib/music";
import { analyzeSong, songMeta } from "../lib/song-loops";
import type { MusicBlock, MusicPlan } from "../lib/ride";
import { songById, songKey } from "../lib/songs";
import type { Intensity } from "../types";
import { IconMusic } from "./icons";

export interface AdaptiveTrack {
  musicButton: React.ReactNode;
  /** Where the ride is: call on every block change, skip, pause and resume. */
  setPlan: (plan: MusicPlan) => void;
  /** Short label for the red line, while some of the music cannot play. */
  problem: string | null;
}

type Mix = Record<Intensity, string[]>;

/** The song for a stretch: its turn in the rotation, else the next ready one. */
export function songFor(mix: Mix, block: MusicBlock, seed: number, ready: (id: string) => boolean): string | undefined {
  const list = mix[block.level];
  for (let i = 0; i < list.length; i++) {
    const id = list[(block.n + seed + i) % list.length];
    if (id !== undefined && ready(id)) return id;
  }
  return undefined;
}

/** Every song of the mix, in the order a ride with `seed` first plays them. */
function loadOrder(mix: Mix, seed: number): string[] {
  const out: string[] = [];
  const longest = Math.max(mix[1].length, mix[2].length, mix[3].length);
  for (let k = 0; k < longest; k++) {
    for (const l of [1, 2, 3] as const) {
      const list = mix[l];
      const id = list[(k + seed) % list.length];
      if (id !== undefined && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

export function useAdaptiveTrack(mix: Mix | undefined, seed: number, done: boolean): AdaptiveTrack {
  const mixerRef = useRef<AdaptiveMixer | null>(null);
  const planRef = useRef<MusicPlan | null>(null);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [musicOn, setMusicOn] = useState(true);
  const doneRef = useRef(done);

  const apply = useCallback(() => {
    const m = mixerRef.current, plan = planRef.current;
    if (!m || !plan || !mix) return;
    const bookings: Booking[] = [];
    for (const b of plan.blocks) {
      const songId = songFor(mix, b, seed, (id) => m.has(id));
      if (songId) bookings.push({ songId, at: b.at, until: b.until });
    }
    // Only the plan's first block may start before its 3-2-1 (the lead-in).
    m.book(bookings, plan.paused || doneRef.current, plan.blocks[0]?.at);
  }, [mix, seed]);

  useEffect(() => {
    if (!mix) return;
    // Read through a function: TypeScript would narrow a plain flag across
    // the awaits and call the later checks unnecessary.
    const life = { alive: true };
    const alive = () => life.alive;
    const ctx = getAudioContext();
    if (!ctx) {
      // Reported from a microtask: a synchronous setState in an effect
      // re-renders in a cascade.
      queueMicrotask(() => { if (alive()) setProblem("Music · no audio"); });
      return () => { life.alive = false; };
    }
    const mixer = new AdaptiveMixer(ctx);
    mixerRef.current = mixer;
    setCueDucker((hold) => { mixer.duck(hold); });
    void (async () => {
      const order = loadOrder(mix, seed);
      const refused: string[] = [];
      let missing = 0;
      for (const id of order) {
        const song = songById(id);
        if (!song) continue;
        const cached = await getCachedTrack(songKey(id)).catch(() => undefined);
        if (!alive()) return;
        if (!cached) {
          missing++;
          continue;
        }
        try {
          // The beat model's result for this track, found when it was
          // composed; a song it has not seen yet is analysed now (slow).
          const meta = songMeta(id, cached.createdAt) ?? (await analyzeSong(id, cached.blob, cached.createdAt));
          if (!alive()) return;
          if (!meta.loop) throw new LayerError(meta.refused ?? `${song.name}: no loop`, meta.detail ?? "");
          // One at a time: a decoded track is large until its loop is cut.
          const prepared = await prepareSong(ctx, cached.blob, song, meta.loop);
          if (!alive()) return;
          mixer.add(prepared);
          setReady(true);
          apply();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          musicLog(`Mixer refused ${msg}${e instanceof LayerError && e.detail ? ` (${e.detail})` : ""}.`);
          refused.push(msg);
        }
      }
      if (!alive()) return;
      // Nothing composed and no key: no music, like any workout without a track.
      if (missing === order.length && !loadMusicSettings().apiKey) return;
      if (refused.length) {
        setProblem(`Music · ${refused[0] ?? ""}${refused.length > 1 ? ` +${String(refused.length - 1)}` : ""}`);
      } else if (missing) {
        setProblem(`Music · ${String(order.length - missing)} of ${String(order.length)} songs`);
      }
    })();
    return () => {
      life.alive = false;
      setCueDucker(null);
      mixer.dispose();
      mixerRef.current = null;
    };
  }, [mix, seed, apply]);

  useEffect(() => {
    doneRef.current = done;
    apply();
  }, [done, apply]);

  useEffect(() => {
    mixerRef.current?.setMuted(!musicOn);
  }, [musicOn, ready]);

  const setPlan = useCallback((plan: MusicPlan) => {
    planRef.current = plan;
    apply();
  }, [apply]);

  return {
    musicButton: ready ? (
      <button
        className={`check music ${musicOn ? "on" : ""}`}
        aria-label={musicOn ? "Mute the battle track" : "Unmute the battle track"}
        onClick={() => { setMusicOn((m) => !m); }}
      >
        <IconMusic />
      </button>
    ) : null,
    setPlan,
    problem,
  };
}
