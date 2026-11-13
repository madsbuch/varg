/**
 * A workout's music, whichever the owner chose (music-choice.ts): its own
 * battle track, looped under the cues (battle-track.tsx), or songs from the
 * library mixed to the workout's shape (workout-music.ts) by the ride's
 * mixer (adaptive-track.tsx), natively in the Android app.
 *
 * The choice is fixed when the workout starts. The player hands over its
 * clock (`anchor`, `pausedAt`) and lead-in; the plan is rebooked whenever
 * that clock moves (pause, resume, skip), never per tick.
 */
import { useEffect, useState } from "react";
import { useAdaptiveTrack } from "./adaptive-track";
import { LIGHT_DUCK } from "../lib/mixer";
import { useBattleTrack } from "./battle-track";
import { INTENSITY_NAMES } from "../lib/songs";
import { sectionLevels, sectionsPlan, workoutMix } from "../lib/workout-music";
import type { MusicSection } from "../lib/workout-music";

export interface WorkoutMusic {
  musicButton: React.ReactNode;
  /** The own track's hidden audio element; null when songs play. */
  audioElement: React.ReactNode;
  /** Red line while some of the chosen music cannot play. */
  problem: string | null;
  /** True when it plays songs from the library, not the own track. */
  mixed: boolean;
}

export function useWorkoutMusic({ templateId, trackKey, sections, anchor, pausedAt, lead, done }: {
  templateId: string | undefined;
  /** The own track's cache key: the template id, or "freestyle". */
  trackKey: string | undefined;
  /** Memoised by the caller: a new array rebooks the music. */
  sections: MusicSection[];
  /** Wall-clock ms where the player's clock reads 0 (start of its lead-in). */
  anchor: number;
  pausedAt: number | null;
  /** Seconds of lead-in before workout second 0. */
  lead: number;
  done: boolean;
}): WorkoutMusic {
  // Where this workout starts in each intensity's rotation, and which set
  // a shuffle plays: workouts differ.
  const [seed] = useState(() => Math.floor(Date.now() / 1000) % 997);
  const [mix] = useState(() => workoutMix(templateId, seed));
  const paused = pausedAt !== null;
  const single = useBattleTrack(mix ? undefined : trackKey, paused, done, LIGHT_DUCK);
  // Cues come at every station here, not every few minutes as on a ride:
  // duck lightly, or the music all but stops at each exercise.
  const songs = useAdaptiveTrack(mix ?? undefined, seed, done, LIGHT_DUCK);
  const { setPlan } = songs;

  useEffect(() => {
    if (!mix) return;
    const origin = anchor + lead * 1000;
    const now = ((pausedAt ?? Date.now()) - origin) / 1000;
    setPlan(sectionsPlan(sections, origin, now, pausedAt !== null));
  }, [mix, sections, anchor, pausedAt, lead, done, setPlan]);

  if (!mix) return { musicButton: single.musicButton, audioElement: single.audioElement, problem: null, mixed: false };
  // A custom choice can leave an intensity the workout uses without songs:
  // that part would be silent, so say so.
  const gap = sectionLevels(sections).filter((l) => mix[l].length === 0);
  return {
    musicButton: songs.musicButton,
    audioElement: null,
    problem: songs.problem ?? (gap.length ? `Music · no ${gap.map((l) => INTENSITY_NAMES[l]).join(" or ")} songs` : null),
    mixed: true,
  };
}
