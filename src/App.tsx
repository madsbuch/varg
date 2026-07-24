import { useEffect, useState } from "react";
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

export default function App() {
  const [tab, setTab] = useState<Tab>("home");

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
