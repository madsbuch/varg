/**
 * Where each song stands, for the library and the workout's music picker:
 * playable, still to compose, being analysed, or refused by the beat model.
 * Refreshes as tracks arrive, analyses finish and songs are added.
 */
import { useEffect, useState } from "react";
import { getCachedTrack, onEnsureStatus } from "../lib/music";
import { isAnalysing, onSongMeta, songMeta } from "../lib/song-loops";
import { onSongsChange, songKey } from "../lib/songs";

export type SongState = "ready" | "missing" | "analysing" | "refused";

export const SONG_STATE_LABEL: Record<SongState, string> = {
  ready: "Ready",
  missing: "No track",
  analysing: "Analysing",
  refused: "No beat",
};

export function useSongStates(ids: string[]): Record<string, SongState> {
  const [states, setStates] = useState<Record<string, SongState>>({});
  const key = ids.join(",");
  useEffect(() => {
    let alive = true;
    const check = () => {
      void Promise.all(
        key.split(",").filter(Boolean).map(async (id): Promise<[string, SongState]> => {
          const track = await getCachedTrack(songKey(id)).catch(() => undefined);
          if (!track) return [id, "missing"];
          if (isAnalysing(id)) return [id, "analysing"];
          const meta = songMeta(id, track.createdAt);
          if (!meta) return [id, "analysing"];
          return [id, meta.loop ? "ready" : "refused"];
        }),
      ).then((pairs) => { if (alive) setStates(Object.fromEntries(pairs)); });
    };
    check();
    const offs = [onSongMeta(check), onSongsChange(check), onEnsureStatus(check)];
    // Tracks composing on Suno's servers arrive without an event here.
    const id = setInterval(check, 10_000);
    return () => {
      alive = false;
      offs.forEach((off) => { off(); });
      clearInterval(id);
    };
  }, [key]);
  return states;
}

export function SongStateChip({ state }: { state: SongState | undefined }) {
  if (!state) return null;
  const cls = state === "ready" ? "accent" : state === "refused" ? "danger" : "";
  return <span className={`chip ${cls}`} style={{ flexShrink: 0 }}>{SONG_STATE_LABEL[state]}</span>;
}
