/**
 * Android Back — hardware button and edge-swipe gesture.
 *
 * Varg navigates with a single `useState<Tab>` and renders sheets and the
 * WOD player as overlays, so the WebView only ever has one history entry.
 * With no handler registered, Tauri's back callback falls through to
 * `activity.onBackPressed()` and the Activity finishes: an edge-swipe at
 * minute 18 of a circuit closed the app, skipping every confirmation, with
 * nothing logged.
 *
 * Registering a handler suppresses that native exit ENTIRELY, so this
 * module owns the whole policy, including quitting. The rule is a stack:
 * the most recently mounted layer gets first refusal. A handler returns
 * true if it consumed the press. If nothing consumes it, we are at the
 * root and the app is allowed to exit.
 */
import { useEffect } from "react";

/** Return true if the press was consumed and must not propagate. */
export type BackHandler = () => boolean;

const stack: BackHandler[] = [];

/**
 * Register a handler as the new top of the stack. Returns an unsubscribe.
 *
 * `bottom` puts it underneath everything instead — for the app root, whose
 * effect runs *after* its children's, so a sheet already open on the first
 * paint would otherwise be registered below the root and never see Back.
 */
export function pushBackHandler(fn: BackHandler, bottom = false): () => void {
  if (bottom) stack.unshift(fn);
  else stack.push(fn);
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}

/**
 * Run the top-most handler that consumes the press.
 * Returns false when nothing handled it — the caller should exit the app.
 */
export function dispatchBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    const fn = stack[i];
    if (fn?.()) return true;
  }
  return false;
}

/**
 * Subscribe a component to Back while `enabled`. The newest subscriber
 * wins, which matches how overlays stack visually.
 */
export function useBackHandler(enabled: boolean, fn: BackHandler, bottom = false): void {
  useEffect(() => {
    if (!enabled) return;
    return pushBackHandler(fn, bottom);
    // `fn` is intentionally re-registered whenever it changes so the
    // handler never closes over stale state.
  }, [enabled, fn, bottom]);
}

/**
 * Wire the platform event to the stack. Called once from the app root.
 * Outside Tauri (browser dev) this resolves to a no-op cleanup.
 */
export async function installBackButton(onExit: () => void): Promise<() => void> {
  try {
    const { onBackButtonPress } = await import("@tauri-apps/api/app");
    const listener = await onBackButtonPress(() => {
      if (!dispatchBack()) onExit();
    });
    return () => { void listener.unregister(); };
  } catch {
    // Not running under Tauri, or the plugin is unavailable.
    return () => undefined;
  }
}
