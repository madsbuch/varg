import { describe, expect, test } from "bun:test";
import { parseIndoorBikeData, parsePowerMeasurement, RideMeter } from "../src/lib/bike";
import type { BikePacket } from "../src/lib/bike";
import { bestRide, recordedRide, RideRun, rideLine, rideSchedule, targetWatts, zoneOf } from "../src/lib/ride";
import type { RideConfig } from "../src/lib/ride";
import { seedTemplates } from "../src/lib/seed";
import { allVoiceLines } from "../src/lib/voice-clips";

// FTMS Indoor Bike Data: flags 0x0144 (speed present since bit 0 is clear,
// cadence, power, energy), 26.00 km/h, 90 rpm, 250 W, 123 kcal total.
const FTMS = "4401280ab400fa007b00ffffff";

describe("bike packet parsing", () => {
  test("FTMS indoor bike data: cadence, power and the bike's kcal total", () => {
    expect(parseIndoorBikeData(FTMS)).toEqual({ cadence: 90, power: 250, totalKcal: 123 });
  });

  test("FTMS without speed (More Data set) and without energy", () => {
    // flags 0x0045: more data, cadence, power — 80 rpm, 1000 W.
    expect(parseIndoorBikeData("4500a000e803")).toEqual({ cadence: 80, power: 1000 });
  });

  test("Cycling Power: power and crank revolutions", () => {
    expect(parsePowerMeasurement("2000c8000a000004")).toEqual({ power: 200, crankRevs: 10, crankTime: 1024 });
  });

  test("Cycling Power cadence comes from crank revolutions over event time", () => {
    const m = new RideMeter();
    m.add({ c: "2a63", hex: "2000c8000a000004", t: 0 });
    m.add({ c: "2a63", hex: "2000c8000b000008", t: 1000 }); // +1 rev in 1 s
    expect(m.cadence).toBeCloseTo(60, 5);
    // 16-bit wrap of both counters still reads 90 rpm: 1.5 revs/s.
    const w = new RideMeter();
    w.add({ c: "2a63", hex: "2000c800ffff00fc", t: 0 }); // revs 65535, time 64512
    w.add({ c: "2a63", hex: "2000c80002000004", t: 2000 } satisfies BikePacket); // revs 2, time 1024
    // 3 revs in (1024 + 1024)/1024 = 2 s → 90 rpm.
    expect(w.cadence).toBeCloseTo(90, 5);
  });

  test("kcal: the bike's own total when it reports one, counted from the start", () => {
    const m = new RideMeter();
    m.add({ c: "2ad2", hex: FTMS, t: 0 });
    m.add({ c: "2ad2", hex: "4401280ab400fa008e00ffffff", t: 1000 }); // 142 kcal
    expect(m.kcal).toBe(19);
  });

  test("kcal: integrated from power at 1 kcal per kJ when the bike has no total", () => {
    const m = new RideMeter();
    for (let s = 0; s <= 100; s++) m.add({ c: "2a63", hex: "2000c8000a000004".replace("c800", "f401"), t: s * 1000 }); // 500 W
    expect(m.kj).toBeCloseTo(50, 5); // 500 W × 100 s
    expect(m.kcal).toBeCloseTo(50, 5);
    expect(m.avgPower).toBeCloseTo(500, 5);
  });

  test("a dropout never counts as minutes of riding", () => {
    const m = new RideMeter();
    m.add({ c: "2a63", hex: "2000f4010a000004", t: 0 });
    m.add({ c: "2a63", hex: "2000f4010a000004", t: 600_000 }); // 10 min gap
    expect(m.kj).toBeCloseTo(2.5, 5); // capped at 5 s × 500 W
  });
});

describe("rides", () => {
  test("zones and targets follow the FTP", () => {
    expect(zoneOf(180, 283)).toEqual({ zone: 2, name: "Endurance" });
    expect(zoneOf(300, 283)).toEqual({ zone: 5, name: "VO2 max" });
    expect(targetWatts({ label: "Zone 2", ftp: [56, 75], seconds: 60 }, 283)).toEqual([160, 210]);
    expect(targetWatts({ label: "Zone 2", ftp: [56, 75], seconds: 60 }, 300)).toEqual([170, 225]);
  });

  const meter = (power: number, kcal: number, kj: number, lastAt: number) => ({ power, kcal, kj, lastAt });

  test("timed segments end on time, kcal segments on kcal", () => {
    const run = new RideRun([
      { label: "Warm-up", ftp: [50, 65], seconds: 60 },
      { label: "All out", ftp: [95, 120], kcal: 20 },
      { label: "Easy", ftp: [40, 55], seconds: 30 },
    ], 283);
    expect(run.tick(59, meter(160, 5, 9, 59_000), true, 59_000)).toBe(0);
    expect(run.tick(61, meter(160, 6, 10, 61_000), true, 61_000)).toBe(1);
    expect(run.results[0]!.seconds).toBe(60); // ended on its time, not at the tick
    expect(run.segment?.label).toBe("All out");
    expect(run.tick(100, meter(300, 25, 22, 100_000), true, 100_000)).toBe(0); // 19 kcal in
    expect(run.tick(101, meter(300, 26.5, 23, 101_000), true, 101_000)).toBe(1);
    expect(run.results[1]!.kcal).toBeCloseTo(20.5, 5);
    run.tick(140, meter(150, 30, 30, 140_000), true, 140_000);
    expect(run.done).toBe(true);
  });

  test("on-target time only counts while the bike is live and in range", () => {
    const run = new RideRun([{ label: "Zone 2", ftp: [56, 75], seconds: 100 }], 283);
    run.tick(0, meter(0, 0, 0, 0), true, 0);
    run.tick(50, meter(180, 0, 0, 50_000), true, 50_000); // in 160–210
    run.tick(75, meter(250, 0, 0, 75_000), true, 75_000); // above
    run.tick(100, meter(180, 0, 0, 100_000), true, 100_000);
    expect(run.results[0]!.inTarget).toBeCloseTo(75 / 100, 5);
  });

  test("a race logs its total time, and the best one comes back", () => {
    const cfg: RideConfig = { title: "First to 200 kcal", templateId: "tpl-ride-200-kcal", segments: [{ label: "All out", ftp: [95, 120], kcal: 200 }], race: true };
    const a = recordedRide(cfg, [{ seconds: 700, kcal: 200, avgPower: 290, inTarget: 0.8 }], "2026-11-08T08:00:00.000Z", "ex-spin-bike", 283, true);
    const b = recordedRide(cfg, [{ seconds: 650, kcal: 200, avgPower: 310, inTarget: 0.6 }], "2026-11-09T08:00:00.000Z", "ex-spin-bike", 283, true);
    expect(a.note).toContain("200 kcal");
    expect(a.note).toContain("avg 290 W");
    expect(bestRide([a, b], cfg.templateId, 1)).toBe(650);
    expect(bestRide([a, b], cfg.templateId, 1, b.date)).toBe(700);
  });

  test("every ride segment's spoken line is generated in the workout voice", () => {
    const lines = new Set(allVoiceLines().map((l) => `${l.role}|${l.text}`));
    for (const t of seedTemplates()) {
      t.ride?.segments.forEach((s, i) => { expect(lines.has(`workout|${rideLine(s, i === 0)}`)).toBe(true); });
    }
    expect(rideLine({ label: "Zone 2", ftp: [56, 75], seconds: 2400 }, true)).toBe("First: Zone 2, 40 minutes");
    expect(rideLine({ label: "All out", ftp: [95, 120], kcal: 200 }, false)).toBe("Next: All out, 200 kilocalories");
  });

  test("the background schedule: block ends, next-block lines 10 s ahead, beeps", () => {
    const segs = [
      { label: "Warm-up", ftp: [50, 65] as [number, number], seconds: 600 },
      { label: "Sweet spot", ftp: [88, 94] as [number, number], seconds: 600 },
      { label: "Rung", ftp: [95, 110] as [number, number], kcal: 50 },
      { label: "Easy", ftp: [45, 55] as [number, number], seconds: 180 },
    ];
    const s = rideSchedule(segs, 0, 1_000_000, false);
    expect(s.segments).toEqual([
      { label: "Warm-up", endAt: 1_600_000 },
      { label: "Sweet spot", endAt: 2_200_000 },
      { label: "Rung", endAt: 0 }, // kcal: unknowable ahead, the schedule stops
    ]);
    expect(s.cues).toEqual([
      { at: 1_590_000, text: "Next: Sweet spot, 10 minutes" },
      { at: 1_600_000, beep: "work" },
      { at: 2_190_000, text: "Next: Rung, 50 kilocalories" },
      { at: 2_200_000, beep: "work" },
    ]);
    // The last block ends on the finish beep; paused schedules nothing.
    expect(rideSchedule(segs.slice(3), 0, 0, false).cues).toEqual([{ at: 180_000, beep: "finish" }]);
    expect(rideSchedule(segs, 0, 0, true)).toEqual({ paused: true, segments: [], cues: [] });
  });

  test("replaying a long background stretch packet by packet ends blocks on time", () => {
    const run = new RideRun([
      { label: "Warm-up", ftp: [50, 65], seconds: 300 },
      { label: "Zone 2", ftp: [56, 75], seconds: 600 },
    ], 283);
    const m = new RideMeter();
    // 15 minutes of 180 W at 1 Hz, all drained at once on return.
    for (let s = 0; s <= 900; s++) {
      m.add({ c: "2a63", hex: "2000b4000a000004", t: s * 1000 });
      run.tick(s, m, true, s * 1000);
    }
    expect(run.done).toBe(true);
    expect(run.results.map((r) => r.seconds)).toEqual([300, 600]);
    expect(run.results[1]!.avgPower).toBeCloseTo(180, 0);
    expect(run.results[1]!.inTarget).toBeCloseTo(1, 2); // 180 W is inside 160–210
  });
});

