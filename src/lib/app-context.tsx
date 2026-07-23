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
import * as store from "./store";

interface AppContextValue {
  data: AppData;
  update: (fn: (data: AppData) => AppData) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => store.loadData());
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    store.saveData(data);
  }, [data]);

  const update = useCallback((fn: (data: AppData) => AppData) => {
    setData((prev) => fn(prev));
  }, []);

  const value = useMemo(() => ({ data, update }), [data, update]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
