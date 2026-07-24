/**
 * Battle track player card for a workout. Tracks are composed in the
 * background (see ensureAllTracks); this card plays what's cached and
 * reports the composer's real state — including failures, loudly.
 * All Suno configuration lives on the Settings page.
 */
import { useEffect, useMemo, useState } from "react";
import type { MusicProfile } from "../types";
import {
  deleteCachedTrack,
  ensureAllTracks,
  generateTrack,
  getCachedTrack,
  loadMusicSettings,
  onEnsureStatus,
  type CachedTrack,
  type EnsureStatus,
} from "../lib/music";

export function BattleTrack({
  cacheKey,
  workoutName,
  profile,
}: {
  cacheKey: string;
  workoutName: string;
  profile: MusicProfile;
}) {
  const [track, setTrack] = useState<CachedTrack | null | undefined>(undefined);
  const [ensure, setEnsure] = useState<EnsureStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasKey = !!loadMusicSettings().apiKey;

  useEffect(() => onEnsureStatus(setEnsure), []);

  // Load from cache; while the track is still being composed in the
  // background, re-check every 10 s so it appears without a reload.
  const trackMissing = track == null;
  useEffect(() => {
    let alive = true;
    const check = () => {
      void getCachedTrack(cacheKey)
        .then((t) => {
          if (alive) setTrack(t ?? null);
        })
        .catch(() => {
          if (alive) setTrack(null);
        });
    };
    check();
    const id = trackMissing ? setInterval(check, 10_000) : undefined;
    return () => {
      alive = false;
      if (id !== undefined) clearInterval(id);
    };
  }, [cacheKey, trackMissing]);

  const url = useMemo(
    () => (track ? URL.createObjectURL(track.blob) : undefined),
    [track],
  );
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  const regenerate = async () => {
    const settings = loadMusicSettings();
    if (!settings.apiKey) return;
    setBusy(true);
    setError("");
    try {
      await deleteCachedTrack(cacheKey);
      setTrack(null);
      setTrack(
        await generateTrack(cacheKey, workoutName, profile, settings, () => undefined),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Track generation failed.");
    } finally {
      setBusy(false);
    }
  };

  // What to show while there's no track — the composer's REAL state.
  const missingBody = (() => {
    if (!hasKey) {
      return (
        <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          No music yet — add your Suno API key in Settings (gear on the Den
          tab).
        </div>
      );
    }
    if (ensure?.running) {
      return (
        <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          Composing tracks in the background
          {ensure.current ? ` — now: ${ensure.current}` : ""}… This one starts
          playing as soon as it's ready.
        </div>
      );
    }
    if (ensure?.error) {
      return (
        <>
          <div
            style={{
              color: "var(--danger)",
              fontSize: 13,
              fontWeight: 700,
              marginTop: 10,
            }}
          >
            Composing failed: {ensure.error}
          </div>
          <button
            className="btn sm"
            style={{ marginTop: 8 }}
            onClick={() => {
              void ensureAllTracks();
            }}
          >
            Retry
          </button>
        </>
      );
    }
    return (
      <button
        className="btn sm"
        style={{ marginTop: 10 }}
        onClick={() => {
          void ensureAllTracks();
        }}
      >
        Compose track
      </button>
    );
  })();

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="row">
        <div>
          <h3 style={{ fontSize: 15 }}>Battle track</h3>
          <div className="faint" style={{ fontSize: 12 }}>
            {profile.style} · {profile.bpm} BPM
          </div>
        </div>
      </div>

      {track && url ? (
        <>
          <audio controls src={url} style={{ width: "100%", marginTop: 10 }} />
          {busy ? (
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              Composing a new track…
            </div>
          ) : (
            <button
              className="link faint"
              style={{ fontSize: 12, marginTop: 6 }}
              onClick={() => {
                void regenerate();
              }}
            >
              generate a new track
            </button>
          )}
        </>
      ) : track === null ? (
        busy ? (
          <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            Composing a new track…
          </div>
        ) : (
          missingBody
        )
      ) : null}

      {error && (
        <div
          style={{
            color: "var(--danger)",
            fontSize: 13,
            fontWeight: 700,
            marginTop: 8,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
