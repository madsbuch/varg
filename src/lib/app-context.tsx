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

interface AppContextValue {
  data: AppData;
  update: (fn: (data: AppData) => AppData) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const PERSIST_DEBOUNCE_MS = 300;

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const backend = useRef<Persistence | null>(null);
  const lastPersisted = useRef<AppData | null>(null);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<AppData | null>(null);
  latest.current = data;

  // Open the backend (SQLite in Tauri, localStorage in a browser) and load.
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
      .catch((err) => {
        console.error("Failed to open persistence backend", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = backend.current;
    const next = latest.current;
    const prev = lastPersisted.current;
    if (!p || !next || !prev || prev === next) return;
    lastPersisted.current = next;
    writeQueue.current = writeQueue.current
      .then(() => persistDiff(p, prev, next))
      .catch((err) => console.error("Persist failed", err));
  }, []);

  // Debounced write-through on every state change.
  useEffect(() => {
    if (!data || !backend.current || lastPersisted.current === data) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [data, flush]);

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

  const update = useCallback((fn: (data: AppData) => AppData) => {
    setData((prev) => (prev ? fn(prev) : prev));
  }, []);

  const value = useMemo(
    () => (data ? { data, update } : null),
    [data, update],
  );

  if (!value) {
    return (
      <div
        style={{
          height: "100%",
          display: "grid",
          placeItems: "center",
          background: "var(--bg)",
        }}
      >
        <Mark className="splash-mark" style={{ width: 64, height: 64, opacity: 0.7 }} />
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
