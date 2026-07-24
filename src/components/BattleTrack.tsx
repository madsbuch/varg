/**
 * Battle track player card for a workout, and the music settings sheet.
 * All Suno configuration lives in the settings sheet; tracks themselves are
 * composed automatically in the background (see ensureAllTracks) — the card
 * only plays what's cached.
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
  saveMusicSettings,
  type CachedTrack,
  type EnsureStatus,
} from "../lib/music";
import { Field, Sheet } from "./ui";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasKey = !!loadMusicSettings().apiKey;

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
        <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          {busy || hasKey
            ? "Your battle track is being composed — it will appear here."
            : "Add your Suno API key in Music settings (Den tab) to get workout music."}
        </div>
      ) : null}

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function MusicSettingsSheet({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState(loadMusicSettings);
  const [status, setStatus] = useState<EnsureStatus | null>(null);

  useEffect(() => onEnsureStatus(setStatus), []);

  const statusLine = (() => {
    if (!status || status.total === 0) return null;
    if (status.running) {
      return `Composing tracks: ${status.ready}/${status.total} ready — now: ${status.current}`;
    }
    if (status.error) {
      return `Stopped at ${status.ready}/${status.total}: ${status.error}`;
    }
    return `Battle tracks ready: ${status.ready}/${status.total}`;
  })();

  return (
    <Sheet title="Music settings" onClose={onClose}>
      <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        With an API key set, Varg composes an instrumental track matched to
        every workout's tempo, style, and theme — automatically, in the
        background, cached on this device so each track is generated once.
        Suno has no official public API, so generation goes through a gateway
        (default: sunoapi.org) with your own key.
      </div>
      <Field label="API key">
        <input
          autoFocus
          spellCheck={false}
          value={s.apiKey}
          placeholder="Your gateway API key"
          onChange={(e) => { setS({ ...s, apiKey: e.target.value }); }}
        />
      </Field>
      <Field label="Gateway URL">
        <input
          spellCheck={false}
          value={s.baseUrl}
          onChange={(e) => { setS({ ...s, baseUrl: e.target.value }); }}
        />
      </Field>

      {statusLine && (
        <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          {statusLine}
        </div>
      )}

      <button
        className="btn primary"
        style={{ marginTop: 12 }}
        onClick={() => {
          saveMusicSettings(s);
          void ensureAllTracks();
          onClose();
        }}
      >
        Save
      </button>
    </Sheet>
  );
}
