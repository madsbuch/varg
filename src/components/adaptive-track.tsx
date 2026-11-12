/**
 * The adaptive ride's music: its three layer tracks, mixed by the ride
 * (src/lib/mixer.ts). The ride player hands every move of its clock and
 * blocks to `setPlan`; this hook owns loading, the mixer and the button.
 *
 * Loading is loud. No layers at all means no music, like any workout
 * whose track is not composed yet; anything partial or unmixable is a
 * `problem` the player shows in red, never flat or off-beat music.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getAudioContext, setCueDucker } from "../lib/beep";
import { AdaptiveMixer, LayerError, prepareLayer } from "../lib/mixer";
import type { Layer } from "../lib/mixer";
import { getCachedTrack, LAYER_NAMES, layerBpm, LAYERS, layerKey, musicLog } from "../lib/music";
import type { MusicProfile } from "../types";
import type { MusicPlan } from "../lib/ride";
import { IconMusic } from "./icons";

export interface AdaptiveTrack {
  musicButton: React.ReactNode;
  /** Where the ride is: call on every block change, skip, pause and resume. */
  setPlan: (plan: MusicPlan) => void;
  /** Short label for the red line, while the music cannot follow the ride. */
  problem: string | null;
}

export function useAdaptiveTrack(templateId: string | undefined, profile: MusicProfile, done: boolean): AdaptiveTrack {
  const mixerRef = useRef<AdaptiveMixer | null>(null);
  const planRef = useRef<MusicPlan | null>(null);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [musicOn, setMusicOn] = useState(true);
  const doneRef = useRef(done);

  const apply = useCallback(() => {
    const m = mixerRef.current, plan = planRef.current;
    if (!m || !plan) return;
    m.play(plan.origin, plan.paused || doneRef.current);
    m.mix(plan.level, plan.changes);
  }, []);

  useEffect(() => {
    if (!templateId) return;
    // Read through a function: TypeScript would narrow a plain flag across
    // the awaits and call the later checks unnecessary.
    const life = { alive: true };
    const alive = () => life.alive;
    let mixer: AdaptiveMixer | null = null;
    void (async () => {
      const ctx = getAudioContext();
      if (!ctx) {
        setProblem("Music · no audio");
        return;
      }
      const blobs = await Promise.all(LAYERS.map((l) => getCachedTrack(layerKey(templateId, l)).catch(() => undefined)));
      const have = blobs.filter(Boolean).length;
      if (!alive() || have === 0) return;
      if (have < LAYERS.length) {
        setProblem(`Music · ${String(have)} of ${String(LAYERS.length)} tracks`);
        return;
      }
      const layers: Layer[] = [];
      for (const [i, l] of LAYERS.entries()) {
        const blob = blobs[i]?.blob;
        if (!blob) return;
        try {
          // One at a time: a decoded track is large until its loop is cut.
          const layer = await prepareLayer(ctx, blob, l, LAYER_NAMES[l], layerBpm(profile, l));
          layers.push(layer);
          musicLog(
            `Mixer: ${LAYER_NAMES[l]} at ${layer.loop.bpm.toFixed(2)} BPM → ${String(layer.bpm)} (×${layer.rate.toFixed(4)}), ` +
            `${String(layer.bars)}-bar loop from ${layer.loop.start.toFixed(2)} s, ±${layer.loop.jitterMs.toFixed(1)} ms, ${(layer.loop.coverage * 100).toFixed(0)} % of beats hit, longest gap ${String(layer.loop.longestGap)}.`,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          musicLog(`Mixer refused ${msg}${e instanceof LayerError ? ` (${e.detail})` : ""}.`);
          if (alive()) setProblem(`Music · ${msg}`);
          return;
        }
        if (!alive()) return;
      }
      mixer = new AdaptiveMixer(ctx, layers);
      mixerRef.current = mixer;
      const m = mixer;
      setCueDucker((hold) => { m.duck(hold); });
      setReady(true);
      apply();
    })();
    return () => {
      life.alive = false;
      setCueDucker(null);
      mixer?.dispose();
      mixerRef.current = null;
    };
  }, [templateId, profile, apply]);

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
