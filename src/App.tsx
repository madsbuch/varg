import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./lib/app-context";
import { installBackButton, useBackHandler } from "./lib/back";
import { ensureAllTracks } from "./lib/music";
import { ensureVoiceClips } from "./lib/voice-clips";
import { syncGarmin } from "./lib/garmin";
import { scrollContentTop } from "./lib/scroll";
import Home from "./views/Home";
import Train from "./views/Train";
import Library from "./views/Library";
import Settings from "./views/Settings";
import History, { type SagaView } from "./views/History";
import {
  IconBook,
  IconDumbbell,
  IconFlag,
  IconGear,
  IconHome,
  IconScroll,
} from "./components/icons";

export type Tab =
  | "home"
  | "train"
  | "history"
  | "library"
  | "settings";

const TABS: { id: Tab; label: string; Icon: typeof IconHome }[] = [
  { id: "home", label: "Den", Icon: IconHome },
  { id: "train", label: "Hunt", Icon: IconDumbbell },
  { id: "history", label: "Saga", Icon: IconScroll },
  { id: "library", label: "Fræði", Icon: IconBook },
  { id: "settings", label: "Skipan", Icon: IconGear },
];

/**
 * Quit the app. Registering a Back handler suppresses Android's native exit
 * entirely (see lib/back.ts), so once every overlay has declined the press
 * the root has to do the quitting itself. Imported lazily so a plain browser
 * (vite dev) never pays for a Tauri-only module, and guarded because outside
 * Tauri there is no process to exit.
 */
async function exitApp(): Promise<void> {
  try {
    const { exit } = await import("@tauri-apps/plugin-process");
    await exit(0);
  } catch {
    // Not running under Tauri — leave it to the platform.
  }
}

/**
 * The write-through failed and the athlete's latest edits are only in
 * memory. It retries itself with backoff, so this is a status line rather
 * than a modal — but it stays up until a write lands, because a session
 * that looks logged and is not on disk is exactly what gets lost.
 *
 * Lives in the shell, outside the scroll container, so it survives a tab
 * change and cannot be scrolled away.
 */
function SaveFailureBanner() {
  const { saveFailure } = useApp();
  if (!saveFailure) return null;
  return (
    <div style={{ padding: "0 16px" }}>
      <div className="persist-error" role="status">
        <IconFlag />
        <div style={{ flex: 1, minWidth: 0 }}>
          Not saved, retrying
          <div style={{ fontWeight: 400, wordBreak: "break-word" }}>
            {saveFailure.message}
            {saveFailure.attempts > 1 && ` · ${String(saveFailure.attempts)} attempts`}
          </div>
        </div>
        <button className="btn ghost sm" onClick={saveFailure.retry}>
          Retry
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  // Which half of the Saga is showing. Lives here so the Den can open the
  // records directly, and so the choice survives a trip to another tab.
  const [sagaView, setSagaView] = useState<SagaView>("sessions");
  const goto = useCallback((t: Tab, view?: SagaView) => {
    if (view) setSagaView(view);
    setTab(t);
  }, []);

  // Android Back. The root owns the exit policy because a registered
  // handler suppresses the native one; sheets and the WOD player mount
  // later and therefore sit ABOVE this in the stack, getting first refusal.
  useEffect(() => {
    let dispose: (() => void) | null = null;
    let cancelled = false;
    void installBackButton(() => { void exitApp(); }).then((off) => {
      if (cancelled) off();
      else dispose = off;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  // Read through a ref so this handler keeps a stable identity: re-running
  // useBackHandler would re-push it to the TOP of the stack, above the
  // sheets it must stay underneath.
  const tabRef = useRef<Tab>("home");
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  const onBack = useCallback(() => {
    if (tabRef.current === "home") return false; // nothing left — exit.
    setTab("home");
    return true;
  }, []);
  // Bottom of the stack: sheets and the player mount later but must always
  // get first refusal, and React runs a child's effects before its parent's.
  useBackHandler(true, onBack, true);

  // Compose any missing workout tracks in the background (no-op without
  // an API key; every finished track is cached for good) — and resume
  // whenever the app returns to the foreground: Android freezes the
  // WebView in standby, but submitted tracks keep composing on Suno's
  // servers, so a foreground pass picks up whatever finished meanwhile.
  // Spoken lines for new poses are generated on open, once a voice is set
  // up. A failure surfaces where it matters: the Settings count and the
  // player's "phone voice for N lines" note.
  useEffect(() => {
    ensureVoiceClips().catch(() => undefined);
  }, []);

  useEffect(() => {
    void ensureAllTracks();
    // Garmin too (no-op without a key, throttled to every 15 minutes):
    // readiness is about this morning, so it refreshes on every return.
    void syncGarmin();
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      void ensureAllTracks();
      void syncGarmin();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  // Every tab starts at the top — scroll position must not leak between
  // screens sharing the one scroll container.
  useEffect(() => {
    scrollContentTop();
  }, [tab]);

  return (
    <div className="app">
      <SaveFailureBanner />

      <main id="content" className="content">
        {tab === "home" && <Home goto={goto} />}
        {tab === "train" && <Train />}
        {tab === "library" && <Library />}
        {tab === "history" && <History view={sagaView} setView={setSagaView} />}
        {tab === "settings" && <Settings />}
      </main>

      <nav className="tabbar">
        <div className="inner">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`tab ${tab === id ? "active" : ""}`}
              onClick={() => { setTab(id); }}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
