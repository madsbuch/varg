import { describe, expect, test } from "bun:test";
import { HrRecorder, hrZoneOf, hrZoneRange, hrZonesProblem, parseHeartRate, STALE_MS, TRACE_EVERY, withHeartRate, zonesFromMax } from "../src/lib/hr";
import type { HrZones } from "../src/lib/hr";
import { RideRun } from "../src/lib/ride";
import type { RideSegment, Session } from "../src/types";

const hex = (bpm: number, flags = 0x06) => flags.toString(16).padStart(2, "0") + bpm.toString(16).padStart(2, "0");

describe("heart rate packet parsing", () => {
  test("uint8 rate with skin contact", () => {
    expect(parseHeartRate("0648")).toEqual({ bpm: 72, contact: true });
  });

  test("contact supported but not detected", () => {
    expect(parseHeartRate("0448")).toEqual({ bpm: 72, contact: false });
  });

  test("a strap without contact detection reports no contact field", () => {
    expect(parseHeartRate("0048")).toEqual({ bpm: 72 });
  });

  test("uint16 rate", () => {
    expect(parseHeartRate("019600")).toEqual({ bpm: 150 });
  });

  test("RR intervals in 1/1024 s, after the energy field when present", () => {
    expect(parseHeartRate("16500003")).toEqual({ bpm: 80, contact: true, rr: [750] });
    expect(parseHeartRate("185010000004cd03")).toEqual({ bpm: 80, rr: [1000, (973 * 1000) / 1024] });
  });
});

describe("heart rate recording", () => {
  test("current rate goes stale and no-contact is no reading", () => {
    const r = new HrRecorder();
    r.add({ hex: hex(120), t: 1000 });
    expect(r.current(1000)).toBe(120);
    expect(r.current(1000 + STALE_MS + 1)).toBeNull();
    r.add({ hex: hex(0x48, 0x04), t: 2000 }); // no skin contact
    expect(r.current(2000)).toBeNull();
    expect(r.samples).toHaveLength(1);
    r.add({ hex: hex(0), t: 3000 }); // a zero rate is not a reading
    expect(r.samples).toHaveLength(1);
  });

  test("average is time-weighted and a dropout does not count at the last rate", () => {
    const r = new HrRecorder();
    // 100 bpm for 10 s, then a 60 s dropout, then 160 bpm for 10 s.
    for (let s = 0; s < 10; s++) r.add({ hex: hex(100), t: s * 1000 });
    for (let s = 70; s <= 80; s++) r.add({ hex: hex(160), t: s * 1000 });
    const sum = r.summary(0, 80_000);
    expect(sum).toBeDefined();
    // Nine 1 s gaps at 100, the last 100 held only 5 s (the cap, not 61 s),
    // then ten 1 s gaps at 160; the final reading ends the window.
    expect(sum?.avg).toBe(Math.round((100 * 14 + 160 * 10) / 24));
    expect(sum?.max).toBe(160);
    expect(sum?.every).toBe(TRACE_EVERY);
    expect(sum?.trace).toHaveLength(16);
    expect(sum?.trace[0]).toBe(100);
    expect(sum?.trace[5]).toBe(0); // the dropout is a gap, not a value
    expect(sum?.trace[15]).toBe(160);
  });

  test("a summary only covers its window, and is undefined with no readings", () => {
    const r = new HrRecorder();
    r.add({ hex: hex(90), t: 0 });
    r.add({ hex: hex(150), t: 10_000 });
    expect(r.summary(5_000, 20_000)?.max).toBe(150);
    expect(r.summary(20_000, 30_000)).toBeUndefined();
  });

  test("a logged session gets the heart rate of its own start to finish", () => {
    const start = Date.parse("2026-11-11T18:00:00Z");
    const r = new HrRecorder();
    r.add({ hex: hex(80), t: start - 60_000 }); // before the start: warming up
    for (let s = 0; s <= 60; s++) r.add({ hex: hex(140), t: start + s * 1000 });
    const session: Session = {
      id: "s", name: "Test", entries: [],
      date: new Date(start).toISOString(),
      finishedAt: new Date(start + 60_000).toISOString(),
    };
    const out = withHeartRate(session, r);
    expect(out.heartRate?.avg).toBe(140);
    expect(withHeartRate(session, null).heartRate).toBeUndefined();
    expect(withHeartRate({ ...session, finishedAt: undefined }, r).heartRate).toBeUndefined();
  });
});

describe("heart-rate zones", () => {
  const z: HrZones = { floors: [98, 118, 138, 157, 177], max: 196 };

  test("zone ranges are inclusive, like Garmin shows them", () => {
    expect(hrZoneRange(z, 2)).toEqual([118, 137]);
    expect(hrZoneRange(z, 5)).toEqual([177, 196]);
  });

  test("zone of a heart rate", () => {
    expect(hrZoneOf(90, z)).toBe(0);
    expect(hrZoneOf(118, z)).toBe(2);
    expect(hrZoneOf(137, z)).toBe(2);
    expect(hrZoneOf(200, z)).toBe(5);
  });

  test("Garmin's default zones from max heart rate", () => {
    expect(zonesFromMax(190)).toEqual({ floors: [95, 114, 133, 152, 171], max: 190 });
  });

  test("zones that do not climb are refused", () => {
    expect(hrZonesProblem(z)).toBeNull();
    expect(hrZonesProblem({ ...z, floors: [98, 118, 118, 157, 177] })).toMatch(/zone 3/i);
    expect(hrZonesProblem({ ...z, max: 170 })).toMatch(/max/i);
    expect(hrZonesProblem({ ...z, floors: [98, 118, 138.5, 157, 177] })).toMatch(/whole/);
  });

  test("heart rate at a moment: the last reading, if fresh", () => {
    const r = new HrRecorder();
    r.add({ hex: hex(100), t: 1000 });
    r.add({ hex: hex(110), t: 2000 });
    expect(r.at(500)).toBeNull();
    expect(r.at(1500)).toBe(100);
    expect(r.at(2000)).toBe(110);
    expect(r.at(2000 + STALE_MS + 1)).toBeNull();
  });

  test("a heart-rate block counts time in zone from the strap, not the watts", () => {
    const seg: RideSegment = { label: "Zone 2", ftp: [56, 75], hrZone: 2, seconds: 600 };
    const run = new RideRun([seg], 283, z);
    const meter = { power: 400, kcal: 0, kj: 0, lastAt: 0 }; // watts way over 75 % FTP
    run.tick(0, meter, true, 0, 125);
    run.tick(60, meter, true, 60_000, 125); // 60 s in zone 2
    run.tick(90, meter, true, 90_000, 150); // 30 s above
    run.tick(120, meter, true, 120_000, null); // 30 s without a reading: not measured
    expect(run.onTarget).toBeCloseTo(60 / 90, 5);
  });
});
