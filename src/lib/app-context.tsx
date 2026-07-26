import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { AppData } from "../types";
import type { Persistence } from "../db/persistence";
import { createPersistence, persistDiff } from "../db/persistence";
import { Mark } from "../components/icons";

/**
 * Set while the athlete's most recent edits are NOT on disk.
 *
 * The app keeps running from memory after a failed write and looks
 * perfectly healthy, so this is the only signal anything is wrong —
 * render it somewhere that survives a tab change.
 */
export interface SaveFailure {
  /** Backend error text, e.g. "database is locked". */
  message: string;
  /** Consecutive failed attempts, ≥ 1. */
  attempts: number;
  /** Retry now. Retries also happen on a timer and on the next edit. */
  retry: () => void;
}

interface AppContextValue {
  data: AppData;
  update: (fn: (data: AppData) => AppData) => void;
  saveFailure: SaveFailure | null;
}

const AppContext = createContext<AppContextValue | null>(null);

const PERSIST_DEBOUNCE_MS = 300;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;
const SLOW_START_MS = 2000;

/**
 * A short line to put in front of the athlete. Drizzle wraps driver
 * errors as "Failed query: <the entire statement>" and hangs the real
 * message off `cause`; the backend also rejects with a bare string.
 */
function errorText(err: unknown): string {
  const cause = err instanceof Error ? (err as { cause?: unknown }).cause : undefined;
  const real = cause ?? err;
  const text =
    real instanceof Error ? real.message : typeof real === "string" ? real : "unknown error";
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

const splashStyle = {
  height: "100%",
  display: "grid",
  placeItems: "center",
  background: "var(--bg)",
  padding: 16,
} as const;

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [failure, setFailure] = useState<{ message: string; attempts: number } | null>(null);
  const [slowStart, setSlowStart] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const backend = useRef<Persistence | null>(null);
  const lastPersisted = useRef<AppData | null>(null);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<AppData | null>(null);
  useEffect(() => {
    latest.current = data;
  }, [data]);

  // Open the backend (SQLite in Tauri, localStorage in a browser) and
  // load. Re-runs when Retry bumps loadAttempt — a migration can fail
  // on a transient lock and succeed on the next try.
  useEffect(() => {
    let cancelled = false;
    createPersistence()
      .then(async (p) => {
        const loaded = await p.load();
        if (cancelled) return;
        backend.current = p;
        lastPersisted.current = loaded;
        setData(loaded);
      })
      .catch((err: unknown) => {
        console.error(`Failed to open persistence backend (attempt ${loadAttempt + 1})`, err);
        if (!cancelled) setLoadError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = backend.current;
    if (!p) return;
    // The baseline advances only once the write has resolved. Advancing
    // it up front made a rejected write invisible: the next diff started
    // from a snapshot that never reached disk, so the lost rows compared
    // equal and were never written again.
    writeQueue.current = writeQueue.current
      .then(async () => {
        const prev = lastPersisted.current;
        const next = latest.current;
        if (!prev || !next || prev === next) return;
        await persistDiff(p, prev, next);
        lastPersisted.current = next;
        setFailure(null);
      })
      .catch((err: unknown) => {
        console.error("Persist failed", err);
        setFailure((f) => ({ message: errorText(err), attempts: (f?.attempts ?? 0) + 1 }));
      });
  }, []);

  // Debounced write-through on every state change.
  useEffect(() => {
    if (!data || !backend.current || lastPersisted.current === data) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, PERSIST_DEBOUNCE_MS);
    return () => { clearTimeout(timer.current); };
  }, [data, flush]);

  // A failed write retries itself, backing off. Waiting for the next
  // edit is not enough: the athlete has typically just finished and
  // pocketed the phone, which is exactly when the write failed.
  useEffect(() => {
    if (!failure) return;
    const id = setTimeout(flush, Math.min(RETRY_MAX_MS, RETRY_BASE_MS * failure.attempts));
    return () => { clearTimeout(id); };
  }, [failure, flush]);

  // Retry now, from the banner. Goes through state rather than handing
  // `flush` to the UI: `flush` reads refs, and anything derived from it
  // would be off-limits during render.
  const retryNow = useCallback(() => { setRetryTick((n) => n + 1); }, []);
  useEffect(() => {
    if (retryTick > 0) flush();
  }, [retryTick, flush]);

  // Flush immediately when the app is backgrounded or closed —
  // important on Android, where the OS can kill the process.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  // A dead launch and a slow one are the same picture without this.
  useEffect(() => {
    if (data) return;
    const id = setTimeout(() => { setSlowStart(true); }, SLOW_START_MS);
    return () => { clearTimeout(id); };
  }, [data]);

  const update = useCallback((fn: (data: AppData) => AppData) => {
    setData((prev) => (prev ? fn(prev) : prev));
  }, []);

  const saveFailure = useMemo<SaveFailure | null>(
    () => (failure ? { ...failure, retry: retryNow } : null),
    [failure, retryNow],
  );

  const value = useMemo(
    () => (data ? { data, update, saveFailure } : null),
    [data, update, saveFailure],
  );

  // The database could not be opened. Say so — an infinite splash on a
  // phone with no console reads as "the app is broken, wipe its data",
  // which is how training history gets thrown away.
  if (loadError !== null) {
    return (
      <div style={splashStyle}>
        <div className="card" style={{ maxWidth: 340 }}>
          <div className="section-label" style={{ margin: "0 0 10px" }}>
            Varg could not start
          </div>
          <p style={{ marginBottom: 10 }}>
            The training database did not open. Nothing has been deleted.
          </p>
          <p className="faint" style={{ marginBottom: 16, wordBreak: "break-word" }}>
            {loadError}
          </p>
          <button
            className="btn primary"
            onClick={() => {
              setLoadError(null);
              setLoadAttempt((n) => n + 1);
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!value) {
    return (
      <div style={splashStyle}>
        <Mark className="splash-mark" style={{ width: 64, height: 64, opacity: 0.7 }} />
        {slowStart && (
          <div
            className="faint"
            style={{ fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase" }}
          >
            Loading…
          </div>
        )}
      </div>
    );
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
