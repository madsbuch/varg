import { describe, expect, test } from "bun:test";
import { matchSessions, overlapSeconds, parseActivity, type GarminActivity } from "../src/lib/garmin";
import type { Session } from "../src/types";

const T0 = Date.parse("2026-11-10T17:00:00Z");
const min = (m: number) => m * 60_000;

function session(id: string, startMin: number, endMin: number): Session {
  return { id, name: id, date: new Date(T0 + min(startMin)).toISOString(), finishedAt: new Date(T0 + min(endMin)).toISOString(), entries: [] };
}
function watch(id: number, startMin: number, lengthMin: number): GarminActivity {
  return { id, name: `w${String(id)}`, type: "strength_training", start: T0 + min(startMin), seconds: lengthMin * 60 };
}

describe("parseActivity", () => {
  test("takes the GMT start, elapsed time and zones from a search row", () => {
    const a = parseActivity({
      activityId: 42, activityName: "Morning Ride", activityType: { typeKey: "indoor_cycling" },
      startTimeGMT: "2026-08-31 22:01:18", elapsedDuration: 2404.9, duration: 2300,
      averageHR: 141, maxHR: 172, avgPower: 201, hrTimeInZone_2: 600, hrTimeInZone_3: 900,
    });
    expect(a?.start).toBe(Date.parse("2026-08-31T22:01:18Z"));
    expect(a?.seconds).toBe(2404.9);
    expect(a?.type).toBe("indoor_cycling");
    expect(a?.hrZones).toEqual([0, 600, 900, 0, 0]);
  });

  test("prefers beginTimestamp and drops rows without a window", () => {
    expect(parseActivity({ activityId: 1, beginTimestamp: 1788213678000, startTimeGMT: "2000-01-01 00:00:00", duration: 10 })?.start).toBe(1788213678000);
    expect(parseActivity({ activityId: 1, duration: 10 })).toBeUndefined();
  });
});

describe("matchSessions", () => {
  test("matches on shared time, not on start time", () => {
    // Watch started 4 minutes before Varg and stopped 6 minutes after.
    const m = matchSessions([session("s", 0, 30)], [watch(1, -4, 40)]);
    expect(m.get("s")?.id).toBe(1);
  });

  test("a watch started late still matches", () => {
    expect(matchSessions([session("s", 0, 45)], [watch(1, 10, 50)]).get("s")?.id).toBe(1);
  });

  test("a brush of under a minute is not a match", () => {
    expect(overlapSeconds([0, min(30)], [min(29.5), min(60)])).toBe(30);
    expect(matchSessions([session("s", 0, 30)], [watch(1, 29.5, 30)]).size).toBe(0);
  });

  test("takes the activity it shares the most time with", () => {
    const m = matchSessions([session("s", 0, 60)], [watch(1, -20, 25), watch(2, 10, 60)]);
    expect(m.get("s")?.id).toBe(2);
  });

  test("one activity goes to one session, the bigger overlap first", () => {
    const m = matchSessions([session("a", 0, 10), session("b", 12, 60)], [watch(1, 0, 60)]);
    expect(m.get("b")?.id).toBe(1);
    expect(m.has("a")).toBe(false);
  });

  test("an unfinished session never matches", () => {
    const open: Session = { id: "o", name: "o", date: new Date(T0).toISOString(), entries: [] };
    expect(matchSessions([open], [watch(1, 0, 30)]).size).toBe(0);
  });
});
