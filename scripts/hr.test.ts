import { describe, expect, test } from "bun:test";
import { HrRecorder, parseHeartRate, STALE_MS, TRACE_EVERY, withHeartRate } from "../src/lib/hr";
import type { Session } from "../src/types";

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
