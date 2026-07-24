import React from "react";
import ReactDOM from "react-dom/client";
import { AppProvider } from "./lib/app-context";
import App from "./App";
import "./styles.css";

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
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
);
