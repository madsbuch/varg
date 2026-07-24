/**
 * Battle track card: generate / play / regenerate the Suno track for a
 * workout, plus the music settings sheet (API key + gateway URL).
 */
import { useEffect, useMemo, useState } from "react";
import type { MusicProfile } from "../types";
import {
  deleteCachedTrack,
  generateTrack,
  getCachedTrack,
  loadMusicSettings,
  saveMusicSettings,
  type CachedTrack,
} from "../lib/music";
import { Field, Sheet } from "./ui";
import { IconMusic } from "./icons";

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
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    let alive = true;
    getCachedTrack(cacheKey)
      .then((t) => alive && setTrack(t ?? null))
      .catch(() => alive && setTrack(null));
    return () => {
      alive = false;
    };
  }, [cacheKey]);

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

  const generate = async (fresh = false) => {
    const settings = loadMusicSettings();
    if (!settings.apiKey) {
      setShowSettings(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (fresh) {
        await deleteCachedTrack(cacheKey);
        setTrack(null);
      }
      setTrack(
        await generateTrack(cacheKey, workoutName, profile, settings, setStatus),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Track generation failed.");
    } finally {
      setBusy(false);
      setStatus("");
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
        <button
          className="link faint"
          style={{ fontSize: 12 }}
          onClick={() => setShowSettings(true)}
        >
          API key
        </button>
      </div>

      {track && url && (
        <audio controls src={url} style={{ width: "100%", marginTop: 10 }} />
      )}

      {busy ? (
        <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          {status}
        </div>
      ) : track ? (
        <button
          className="link faint"
          style={{ fontSize: 12, marginTop: 6 }}
          onClick={() => generate(true)}
        >
          generate a new track
        </button>
      ) : (
        track === null && (
          <button
            className="btn sm"
            style={{ marginTop: 10 }}
            onClick={() => generate()}
          >
            <IconMusic /> Generate track
          </button>
        )
      )}

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>
          {error}
        </div>
      )}

      {showSettings && (
        <MusicSettingsSheet onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

export function MusicSettingsSheet({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState(loadMusicSettings);
  return (
    <Sheet title="Music settings" onClose={onClose}>
      <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Tracks are generated with Suno through an API gateway and cached on
        this device, so each workout's track is only generated once. Suno has
        no official public API — get a key from the gateway you use (default:
        sunoapi.org).
      </div>
      <Field label="API key">
        <input
          autoFocus
          spellCheck={false}
          value={s.apiKey}
          placeholder="Your gateway API key"
          onChange={(e) => setS({ ...s, apiKey: e.target.value })}
        />
      </Field>
      <Field label="Gateway URL">
        <input
          spellCheck={false}
          value={s.baseUrl}
          onChange={(e) => setS({ ...s, baseUrl: e.target.value })}
        />
      </Field>
      <button
        className="btn primary"
        style={{ marginTop: 8 }}
        onClick={() => {
          saveMusicSettings(s);
          onClose();
        }}
      >
        Save
      </button>
    </Sheet>
  );
}
