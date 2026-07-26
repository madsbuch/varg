import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./lib/app-context";
import { installBackButton, useBackHandler } from "./lib/back";
import { ensureAllTracks } from "./lib/music";
import { scrollContentTop } from "./lib/scroll";
import Home from "./views/Home";
import Train from "./views/Train";
import Splits from "./views/Splits";
import Records from "./views/Records";
import Library from "./views/Library";
import Settings from "./views/Settings";
import {
  IconBook,
  IconDumbbell,
  IconFlag,
  IconHome,
  IconLayers,
  IconTrophy,
} from "./components/icons";

export type Tab =
  | "home"
  | "train"
  | "splits"
  | "records"
  | "library"
  | "settings";

const TABS: { id: Tab; label: string; Icon: typeof IconHome }[] = [
  { id: "home", label: "Den", Icon: IconHome },
  { id: "train", label: "Hunt", Icon: IconDumbbell },
  { id: "splits", label: "Splits", Icon: IconLayers },
  { id: "records", label: "Records", Icon: IconTrophy },
  { id: "library", label: "Manual", Icon: IconBook },
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
          Not saved — retrying
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
  useEffect(() => {
    void ensureAllTracks();
    const resume = () => {
      if (document.visibilityState === "visible") void ensureAllTracks();
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
        {tab === "home" && <Home goto={setTab} />}
        {tab === "train" && <Train />}
        {tab === "splits" && <Splits />}
        {tab === "records" && <Records />}
        {tab === "library" && <Library />}
        {tab === "settings" && <Settings goto={setTab} />}
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
