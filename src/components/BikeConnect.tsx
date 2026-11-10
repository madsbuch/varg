/**
 * Bike pairing and the pre-ride connect step.
 *
 * `BikePicker` finds bikes (asking for Bluetooth permission first) and
 * remembers the chosen one — used in Settings and before a ride.
 * `RideConnectSheet` is the step between pressing Start on a ride and the
 * ride's clock starting: it connects the paired bike and shows live data,
 * so the rider knows the link works before the first block. It can always
 * be skipped — the ride then runs on time and feel.
 */
import { useEffect, useState } from "react";
import {
  connectBike, loadBike, readBike, requestBikePermission, saveBike, scanBikes, RideMeter,
} from "../lib/bike";
import type { BikeRead, FoundBike } from "../lib/bike";
import { Sheet } from "./ui";

interface Paired { address: string; name: string }

export function BikePicker({ onPicked }: { onPicked: (b: Paired) => void }) {
  const [found, setFound] = useState<FoundBike[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const find = () => {
    setProblem(null);
    setFound(null);
    setBusy("Asking for Bluetooth permission…");
    requestBikePermission()
      .then((ok) => {
        if (!ok) throw new Error("Bluetooth permission was not granted. Allow Nearby devices for Varg in Android settings.");
        setBusy("Looking for bikes. Start pedalling to wake it…");
        return scanBikes(8);
      })
      .then((list) => {
        setFound(list);
        if (list.length === 0) setProblem("No bike found. Wake it by pedalling, and make sure no other app (Body Bike, Mowl) is connected to it.");
      })
      .catch((e: unknown) => { setProblem(e instanceof Error ? e.message : String(e)); })
      .finally(() => { setBusy(null); });
  };

  return (
    <div>
      <button className="btn sm" style={{ width: "auto" }} disabled={busy !== null} onClick={find}>
        Find bike
      </button>
      {found && found.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {found.map((b) => (
            <button
              key={b.address}
              className="list-item"
              onClick={() => {
                const chosen = { address: b.address, name: b.name };
                saveBike(chosen);
                setFound(null);
                onPicked(chosen);
              }}
            >
              <div>
                <div className="title">{b.name}</div>
                <div className="sub">{b.protocol === "ftms" ? "Power, cadence and kcal (FTMS)" : "Power and cadence (Cycling Power)"} · signal {b.rssi} dBm</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {busy && <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>{busy}</div>}
      {problem && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{problem}</div>}
    </div>
  );
}

/**
 * Before a ride: connect the bike, see it working, then start — or skip.
 * `onStart(true)` means the bike is connected and sending data;
 * `onStart(false)` means riding without it.
 */
export function RideConnectSheet({ title, onStart, onCancel }: {
  title: string;
  onStart: (withBike: boolean) => void;
  onCancel: () => void;
}) {
  const [bike, setBike] = useState(loadBike);
  const [read, setRead] = useState<BikeRead | null>(null);
  const [live, setLive] = useState<{ power: number; cadence: number; at: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Connect the paired bike (asking for permission first), then poll it.
  useEffect(() => {
    if (!bike) return;
    let alive = true;
    const meter = new RideMeter();
    requestBikePermission()
      .then((ok) => {
        if (!ok) throw new Error("Bluetooth permission was not granted. Allow Nearby devices for Varg in Android settings.");
        return connectBike(bike.address);
      })
      .catch((e: unknown) => { if (alive) setProblem(e instanceof Error ? e.message : String(e)); });
    const id = setInterval(() => {
      readBike()
        .then((r) => {
          if (!alive) return;
          for (const p of r.packets) meter.add(p);
          setRead(r);
          if (r.packets.length) setLive({ power: meter.power, cadence: meter.cadence, at: meter.lastAt });
        })
        .catch((e: unknown) => { if (alive) setProblem(e instanceof Error ? e.message : String(e)); });
    }, 500);
    return () => { alive = false; clearInterval(id); };
  }, [bike, attempt]);

  const connected = read?.state === "connected";
  const status = !bike
    ? null
    : problem ?? read?.error ?? (connected
      ? live
        ? `Connected · ${String(Math.round(live.power))} W · ${String(Math.round(live.cadence))} rpm`
        : "Connected. Pedal to see your watts."
      : "Connecting…");
  const bad = !!bike && (!!problem || !!read?.error);

  return (
    <Sheet title={`Ready to ride: ${title}`} onClose={onCancel}>
      <p className="muted" style={{ marginTop: 0 }}>
        Connect the bike so the ride can read your power, cadence and kcal.
        Close Body Bike or Mowl first: most bikes take one app at a time.
      </p>
      {bike ? (
        <div className="card">
          <strong>{bike.name}</strong>
          <div style={{ fontSize: 14, marginTop: 6, color: bad ? "var(--danger)" : connected ? "var(--accent)" : "var(--muted)" }}>
            {status}
          </div>
          {bad && (
            <button
              className="btn sm"
              style={{ width: "auto", marginTop: 8 }}
              onClick={() => { setProblem(null); setRead(null); setAttempt((a) => a + 1); }}
            >
              Try again
            </button>
          )}
          <div style={{ marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>Not your bike?</div>
            <BikePicker onPicked={(b) => { setProblem(null); setRead(null); setLive(null); setBike(b); }} />
          </div>
        </div>
      ) : (
        <div className="card">
          <div style={{ marginBottom: 8 }}>No bike paired yet.</div>
          <BikePicker onPicked={(b) => { setBike(b); }} />
        </div>
      )}
      <button className="btn primary" style={{ marginTop: 12 }} disabled={!connected} onClick={() => { onStart(true); }}>
        Start ride
      </button>
      <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => { onStart(false); }}>
        Ride without the bike
      </button>
      <p className="muted" style={{ fontSize: 13 }}>
        Without the bike the ride runs on time and feel: no live watts, kcal
        blocks finish with Done, and Varg has to stay on screen.
      </p>
    </Sheet>
  );
}
