import { useState } from "react";
import Home from "./views/Home";
import Train from "./views/Train";
import Splits from "./views/Splits";
import Records from "./views/Records";
import {
  IconDumbbell,
  IconHome,
  IconLayers,
  IconTrophy,
} from "./components/icons";

export type Tab = "home" | "train" | "splits" | "records";

const TABS: { id: Tab; label: string; Icon: typeof IconHome }[] = [
  { id: "home", label: "Den", Icon: IconHome },
  { id: "train", label: "Hunt", Icon: IconDumbbell },
  { id: "splits", label: "Splits", Icon: IconLayers },
  { id: "records", label: "Records", Icon: IconTrophy },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("home");

  return (
    <div className="app">
      {tab === "home" && <Home goto={setTab} />}
      {tab === "train" && <Train />}
      {tab === "splits" && <Splits />}
      {tab === "records" && <Records />}

      <nav className="tabbar">
        <div className="inner">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`tab ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
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
