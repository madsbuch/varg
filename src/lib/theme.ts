/**
 * Light, dark, or whatever the phone says.
 *
 * The choice is resolved to an explicit `data-theme` on <html>, which is
 * the only thing the stylesheet keys on. Kept in the settings store (kv.ts) rather than
 * the training data: it is applied as soon as the settings are read, before the
 * app renders.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../db/persistence";
import { kvGet, kvRemove, kvSet } from "./kv";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "varg.theme";

/** Matches --bg in styles.css; tints the browser / task-switcher chrome. */
const CHROME = { light: "#e3e5e3", dark: "#0f1317" } as const;

export function loadTheme(): ThemeChoice {
  try {
    const v = kvGet(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function systemDark(): MediaQueryList | undefined {
  return typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;
}

function resolve(choice: ThemeChoice): "light" | "dark" {
  return choice === "system" ? (systemDark()?.matches === true ? "dark" : "light") : choice;
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** How long the switch takes: the same 420 ms as the crossfade in styles.css. */
const EASE_MS = 420;
let easing: ReturnType<typeof setTimeout> | undefined;

/**
 * Switch theme visibly: the whole page crossfades from the old colours to
 * the new (View Transitions, in the Android WebView since Chrome 111);
 * without them every colour eases over instead. Instant when the phone asks
 * for reduced motion, or when nothing changes.
 */
function applyAnimated(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (root.getAttribute("data-theme") === resolve(choice) || reducedMotion()) {
    apply(choice);
    return;
  }
  if ("startViewTransition" in document) {
    document.startViewTransition(() => { apply(choice); });
    return;
  }
  root.classList.add("theme-easing");
  apply(choice);
  clearTimeout(easing);
  easing = setTimeout(() => { root.classList.remove("theme-easing"); }, EASE_MS);
}

function apply(choice: ThemeChoice): void {
  const resolved = resolve(choice);
  document.documentElement.setAttribute("data-theme", resolved);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", CHROME[resolved]);
  // The Android WebView ignores theme-color: the phone's own status and
  // navigation bars are coloured natively (plugins/varg-system), and their
  // icons set light or dark to read on the page drawn under them.
  if (isTauri() && /Android/i.test(navigator.userAgent)) {
    invoke("plugin:varg-system|system_bars", { color: CHROME[resolved], dark: resolved === "dark" }).catch(() => undefined);
  }
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === "system") kvRemove(KEY);
    else kvSet(KEY, choice);
  } catch {
    // Storage unavailable: the theme still applies for this run.
  }
  applyAnimated(choice);
}

/** Call once, before the first render (no animation then). Follows the phone while on "system". */
export function initTheme(): void {
  apply(loadTheme());
  systemDark()?.addEventListener("change", () => {
    applyAnimated(loadTheme());
  });
}
