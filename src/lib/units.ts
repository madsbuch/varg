// Varg is metric-only: weights in kg, distances in meters (shown as km).

export function roundW(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Epley estimated one-rep max from a working set. */
export function estimate1RM(weightKg: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

export function kmFromMeters(m: number): number {
  return roundW(m / 1000);
}

export function metersFromKm(km: number): number {
  return km * 1000;
}

export function formatSeconds(total: number): string {
  const t = Math.max(0, Math.round(total));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/** Parse "mm:ss" or "h:mm:ss" or plain seconds into seconds. */
export function parseTime(input: string): number | undefined {
  const s = input.trim();
  if (!s) return undefined;
  if (!s.includes(":")) {
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  const parts = s.split(":").map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return undefined;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.round((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}
