/**
 * HTTP for everything Varg talks to: the Tauri HTTP plugin in the app (no
 * CORS, real network errors), plain fetch in a browser. Errors keep their
 * real reason instead of collapsing into a generic "failed".
 */

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === "string" && e.trim()) return e;
  try {
    const s = JSON.stringify(e);
    if (s && s !== "{}" && s !== "null") return s;
  } catch {
    // fall through
  }
  return String(e);
}

export async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    if ("__TAURI_INTERNALS__" in window) {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      return await tauriFetch(url, init);
    }
    return await fetch(url, init);
  } catch (e) {
    // The Tauri plugin rejects with plain strings — wrap everything so the
    // real reason survives instead of collapsing into a generic "failed".
    throw new Error(`${init?.method ?? "GET"} ${url}: ${errorText(e)}`);
  }
}
