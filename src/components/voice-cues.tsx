/**
 * Spoken cues for a player: the generated clips for its lines, the voice
 * toggle in the top bar, and the red line when the voice fails.
 *
 * The player decides WHAT to say and WHEN (its steps, its stages); this
 * hook only says it. Clips are decoded before the first cue so every line
 * plays the instant it is due. A line without a clip falls back to the
 * phone's voice, and the lead-in says how many; a voice that fails says so
 * in red and the cue still gets its beep, never silence.
 */
import { useCallback, useEffect, useState } from "react";
import { loadVoiceOn, saveVoiceOn, speak } from "../lib/voice";
import { playClip, prepareClips, voiceConfigured } from "../lib/voice-clips";
import type { VoiceRole } from "../lib/wod";
import { IconVoice } from "./icons";

export interface VoiceCues {
  /** Speaking now: a voice role and the toggle on. */
  on: boolean;
  /** False while the clips are still loading: hold the first cue, speak it properly once. */
  ready: boolean;
  /** Speak `line`, or `beep` when there is none or the voice failed. */
  say: (line: string, beep: () => void) => void;
  /** The toggle for the top bar's voice slot; null when the player has no voice. */
  button: React.ReactNode;
  /** Red line while the voice fails; null otherwise. */
  error: React.ReactNode;
  /** For the lead-in: how many lines fall back to the phone's voice. */
  note: React.ReactNode;
}

export function useVoiceCues(role: VoiceRole | undefined, lines: string[]): VoiceCues {
  const voiced = role !== undefined;
  const [voiceOn, setVoiceOn] = useState(loadVoiceOn);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [clips, setClips] = useState<{ buffers: Map<string, AudioBuffer>; missing: string[] } | null>(
    voiced ? null : { buffers: new Map(), missing: [] },
  );
  // `lines` is the player's own derived list: rejoin it so a re-render with
  // the same lines does not decode them again.
  const key = lines.join("\n");
  useEffect(() => {
    if (!role) return;
    let alive = true;
    const list = key ? key.split("\n") : [];
    prepareClips(role, list).then(
      (r) => { if (alive) setClips(r); },
      () => { if (alive) setClips({ buffers: new Map(), missing: list }); },
    );
    return () => { alive = false; };
  }, [role, key]);

  const on = voiced && voiceOn;
  const say = useCallback((line: string, beep: () => void) => {
    if (!line || !on) {
      beep();
      return;
    }
    const clip = clips?.buffers.get(line);
    if (clip && playClip(clip)) return;
    speak(line).then(
      () => { setVoiceError(null); },
      (e: unknown) => {
        // Say why there is no voice, and still give the cue a sound.
        setVoiceError(e instanceof Error ? e.message : String(e));
        beep();
      },
    );
  }, [clips, on]);

  return {
    on,
    ready: !on || clips !== null,
    say,
    button: voiced ? (
      <button
        className={`check music ${voiceOn ? "on" : ""}`}
        aria-label={voiceOn ? "Stop the spoken cues" : "Speak the cues"}
        onClick={() => {
          const next = !voiceOn;
          setVoiceOn(next);
          saveVoiceOn(next);
          if (!next) setVoiceError(null);
        }}
      >
        <IconVoice />
      </button>
    ) : null,
    error: on && voiceError ? <div className="wod-voice-error">Voice unavailable: {voiceError}</div> : null,
    note: on && clips && clips.missing.length > 0 ? (
      <div className="wod-voice-note">
        {voiceConfigured()
          ? `Phone voice for ${String(clips.missing.length)} line${clips.missing.length === 1 ? "" : "s"}. Generate them in Settings → Voice.`
          : "Phone voice. Add your kie.ai key in Skipan for a natural one."}
      </div>
    ) : null,
  };
}
