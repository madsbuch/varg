import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/cinzel/latin-700.css";
import "@fontsource/cinzel/latin-900.css";
import "./styles.css";
import { initKv } from "./lib/kv";
import { importWebViewAudio } from "./lib/blobs";
import { errorText } from "./lib/http";

/**
 * Android webviews draw edge-to-edge under the system status bar but
 * report zero for env(safe-area-inset-top). Probe the real value and,
 * when it's missing on Android, fall back to a typical status-bar
 * height so the app shell starts below the system bar.
 */
function applyAndroidInsetFallback(): void {
  if (!/android/i.test(navigator.userAgent)) return;
  const probe = document.createElement("div");
  probe.style.paddingTop = "env(safe-area-inset-top, 0px)";
  document.body.appendChild(probe);
  const parsed = Number.parseFloat(getComputedStyle(probe).paddingTop);
  probe.remove();
  const inset = Number.isFinite(parsed) ? parsed : 0;
  if (inset === 0) {
    document.documentElement.style.setProperty("--safe-top", "32px");
  }
}
applyAndroidInsetFallback();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");
const root = ReactDOM.createRoot(rootEl);

/**
 * The store opens and every setting is read BEFORE the app's modules load:
 * many of them read a setting as they load (the Garmin cache, the theme),
 * and must see the stored value, never a default. Hence the dynamic
 * imports. A store that will not open says so, with Retry, rather than an
 * endless splash.
 */
async function boot(): Promise<void> {
  try {
    await initKv();
  } catch (e) {
    root.render(<BootFailure reason={errorText(e)} />);
    return;
  }
  const [{ initTheme }, { AppProvider }, { default: App }] = await Promise.all([
    import("./lib/theme"),
    import("./lib/app-context"),
    import("./App"),
  ]);
  initTheme();
  // Never throws: a failure is a red banner and composing waits (blobs.ts).
  await importWebViewAudio();
  root.render(
    <React.StrictMode>
      <AppProvider>
        <App />
      </AppProvider>
    </React.StrictMode>,
  );
}

function BootFailure({ reason }: { reason: string }) {
  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 16, background: "var(--bg)" }}>
      <div className="card" style={{ maxWidth: 340 }}>
        <div className="section-label" style={{ margin: "0 0 10px" }}>Varg could not start</div>
        <p style={{ marginBottom: 10 }}>The database did not open. Nothing has been deleted.</p>
        <p className="faint" style={{ marginBottom: 16, wordBreak: "break-word" }}>{reason}</p>
        <button className="btn primary" onClick={() => { window.location.reload(); }}>Retry</button>
      </div>
    </div>
  );
}

void boot();
