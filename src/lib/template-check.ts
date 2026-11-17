/**
 * Every rule a workout template must keep, as a list of problems: empty
 * means the template runs exactly as its card says.
 *
 * One source of truth for two authors. check:content runs it over every built-in
 * (the coding agent's programs, see CLAUDE.md), and Mímir, the in-app
 * trainer, runs it over every program it proposes before the owner can save
 * it, and the Hunt runs it again before a saved program starts. A program
 * that builds green and runs wrong mid-workout is the worst outcome, so a
 * rule added here guards both paths at once.
 */
import type { Exercise, Template } from "../types";
import { exerciseGear, libraryFor } from "./library";
import { GEAR, templateExerciseIds, templateGear } from "./gear";
import type { GearId } from "./gear";
import { lengthBucket } from "./catalog";
import { BAR_GRID_S } from "./workout-music";
import { buildStyle, STYLE_LIMIT } from "./music";
import { INTENSITY_NAMES, SETS, setById } from "./songs";
import { EX } from "./seed";


const SPIN_BIKE = EX.spinBike;

// A template with an `interval` runs as a fixed work/rest circuit in the
// guided player, and the card renders the scheme verbatim next to a single
// Start button. A scheme prescribing metres, an AMRAP score or a rep count
// therefore promises something the player cannot measure or deliver: the
// player logs {seconds: work} and nothing else.
//
// The allowlist is deliberate — a bare /\d+\s*m/ false-positives on
// Rasteplads' correct "— 3 min a round", so numbers are checked against the
// unit that follows them instead.
const INTERVAL_SCHEME_UNITS = new Set([
  "s", "sec", "secs", "second", "seconds",
  "min", "mins", "minute", "minutes",
  "round", "rounds", "station", "stations",
  "kg", "cm",
]);
const DISTANCE_RE = /\d+(?:[.,]\d+)?\s*(?:m|km|meters|metres)\b/iu;
const AMRAP_RE = /\bAMRAP\b/iu;
const COUNTED_RE = /(\d+(?:[.,]\d+)?)\s*(\p{L}[\p{L}-]*)?/gu;

// Train builds one step object per station per round up front and WodPlayer
// scans that array on every render, so an absurd round count is a frozen
// phone rather than an error.
const MAX_STEPS = 200;
const MAX_DURATION = 2 * 60 * 60;

const fmt = (t: number) => `${String(Math.floor(t / 60))}:${String(t % 60).padStart(2, "0")}`;

/**
 * Everything wrong with `tpl`, each as one sentence naming the template.
 * `exercises` is the catalogue it may draw from.
 */
export function templateProblems(tpl: Template, exercises: readonly Exercise[]): string[] {
  const out: string[] = [];
  const fail = (cond: unknown, msg: string): boolean => {
    if (!cond) out.push(msg);
    return !cond;
  };
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const name = `template "${tpl.name}"`;

  // Every reference to an exercise must resolve. A typo'd id is invisible
  // at runtime — templates refuse to start — and these are plain strings.
  const missing = templateExerciseIds(tpl).filter((id) => !exById.has(id));
  if (missing.length > 0) {
    out.push(`${name} references unknown exercises: ${[...new Set(missing)].join(", ")}`);
    return out; // every rule below looks exercises up
  }

  const players = [tpl.interval, tpl.forTime, tpl.flow, tpl.ride, tpl.emom].filter((x) => x !== undefined).length;
  fail(players <= 1, `${name}: more than one of interval, forTime, flow, emom and ride`);

  // --- interval ---
  const iv = tpl.interval;
  if (iv) {
    const wrong: string[] = [];
    if (DISTANCE_RE.test(tpl.scheme)) wrong.push("prescribes a distance");
    if (AMRAP_RE.test(tpl.scheme)) wrong.push("prescribes an AMRAP score");
    const counts: string[] = [];
    for (const m of tpl.scheme.matchAll(COUNTED_RE)) {
      const unit = m[2]?.toLowerCase();
      if (unit && !INTERVAL_SCHEME_UNITS.has(unit)) counts.push(m[0].trim());
    }
    if (counts.length > 0) wrong.push(`counts ${counts.map((c) => `"${c}"`).join(", ")}`);
    fail(
      wrong.length === 0,
      `${name} has an interval but its scheme ${wrong.join(" and ")}: "${tpl.scheme}". ` +
        `Write the scheme in the units the interval enforces ("3 rounds · 12 stations · 20 s work / 10 s rest"), ` +
        `or drop the interval so it opens as a loggable session.`,
    );
    const where = `${name} interval`;
    const stations = tpl.exerciseIds.length;
    fail(stations >= 1, `${where}: no stations`);
    fail(Number.isInteger(iv.rounds) && iv.rounds >= 1 && iv.rounds <= 50, `${where}: rounds must be a whole number 1-50, got ${String(iv.rounds)}`);
    fail(Number.isInteger(iv.work) && iv.work >= 5 && iv.work <= 600, `${where}: work must be a whole number of seconds 5-600, got ${String(iv.work)}`);
    fail(Number.isInteger(iv.rest) && iv.rest >= 0 && iv.rest <= 600, `${where}: rest must be a whole number of seconds 0-600, got ${String(iv.rest)}`);
    const steps = stations * iv.rounds;
    fail(steps <= MAX_STEPS, `${where}: ${String(steps)} steps (${String(stations)} stations × ${String(iv.rounds)} rounds) exceeds ${String(MAX_STEPS)}`);
    const seconds = steps * iv.work + Math.max(0, steps - 1) * iv.rest;
    fail(seconds <= MAX_DURATION, `${where}: runs ${String(Math.round(seconds / 60))} min, over the ${String(MAX_DURATION / 60)} min ceiling`);
  }

  // --- for time ---
  // One Done per stage, and each completed stage is logged as a set carrying
  // the prescribed amount. So the amount must be the kind the exercise's
  // metric measures, and the label must state that same number.
  const ft = tpl.forTime;
  if (ft) {
    const where = `${name} forTime`;
    fail(ft.stages.length >= 1 && ft.stages.length <= 200, `${where}: needs 1-200 stages, has ${String(ft.stages.length)}`);
    ft.stages.forEach((st, i) => {
      const at = `${where} stage ${String(i + 1)} ("${st.label}")`;
      const ex = exById.get(st.exerciseId);
      if (!ex) return;
      fail(tpl.exerciseIds.includes(st.exerciseId), `${at}: ${ex.name} is not in the template's exerciseIds, so the details sheet would not show its cues`);
      if (ex.metric === "reps" || ex.metric === "weight_reps") {
        if (fail(Number.isInteger(st.reps) && (st.reps ?? 0) > 0 && st.meters == null, `${at}: ${ex.name} is counted in reps — give the stage a whole-number reps target and no metres`)) return;
        fail(new RegExp(`(^|\\D)${String(st.reps)}(\\D|$)`).test(st.label), `${at}: label does not state the ${String(st.reps)} reps the stage logs`);
      } else if (ex.metric === "distance_time") {
        if (fail((st.meters ?? 0) > 0 && st.reps == null, `${at}: ${ex.name} is measured in distance — give the stage a metres target and no reps`)) return;
        const m = st.meters ?? 0;
        fail(st.label.includes(`${String(m / 1000)} km`) || st.label.includes(`${String(m)} m`), `${at}: label does not state the ${String(m)} m the stage logs`);
      } else {
        out.push(`${at}: ${ex.name} is a ${ex.metric} exercise, which a for-time stage cannot prescribe`);
      }
    });
  }

  // --- flow ---
  // Every pose its own hold; one-sided poses as an adjacent left/right pair
  // on an animation that declares which side it draws; and the scheme's pose
  // count, hold range and total are the flow's own numbers.
  const fl = tpl.flow;
  if (fl) {
    const where = `${name} flow`;
    fail(fl.steps.length >= 1 && fl.steps.length <= 200, `${where}: needs 1-200 steps`);
    fl.steps.forEach((st, i) => {
      const at = `${where} step ${String(i + 1)}`;
      const ex = exById.get(st.exerciseId);
      if (!ex) return;
      fail(tpl.exerciseIds.includes(st.exerciseId), `${at}: ${ex.name} missing from exerciseIds`);
      fail(Number.isInteger(st.seconds) && st.seconds >= 10 && st.seconds <= 300, `${at}: hold must be 10-300 whole seconds, got ${String(st.seconds)}`);
      if (st.side) {
        fail(libraryFor(ex).side, `${at}: ${ex.name} is one-sided but its animation does not declare which side it draws`);
        const pair = st.side === "left" ? fl.steps[i + 1] : fl.steps[i - 1];
        const other = st.side === "left" ? "right" : "left";
        if (fail(pair?.exerciseId === st.exerciseId && pair.side === other, `${at}: ${ex.name} ${st.side} side is not paired with the ${other} side next to it`)) return;
        fail(st.side === "right" || pair?.seconds === st.seconds, `${at}: ${ex.name} sides are held for different times`);
      }
    });
    fail(Number.isInteger(fl.transition) && fl.transition >= 0 && fl.transition <= 60, `${where}: transition must be 0-60 whole seconds, got ${String(fl.transition)}`);
    if (fl.steps.length > 0) {
      const total = fl.steps.reduce((sum, st) => sum + st.seconds, 0) + (fl.steps.length - 1) * fl.transition;
      const holds = fl.steps.map((st) => st.seconds);
      const expected = [
        `${fmt(total)} flow`,
        `${String(fl.steps.length)} poses`,
        `holds of ${String(Math.min(...holds))}–${String(Math.max(...holds))} s`,
        ...(fl.transition > 0 ? [`${String(fl.transition)} s to move between poses`] : []),
      ];
      for (const part of expected) fail(tpl.scheme.includes(part), `${where}: scheme "${tpl.scheme}" does not say "${part}"`);
    }
  }

  // --- EMOM ---
  // Every station owns one whole minute; one whole count per round, never
  // a range; timed work fits in the minute; the scheme states the real
  // total, warm-up, EMOM length, rounds and stations.
  const em = tpl.emom;
  if (em) {
    const where = `${name} emom`;
    fail(Number.isInteger(em.minute) && em.minute >= 30 && em.minute <= 300, `${where}: minute must be 30-300 whole seconds, got ${String(em.minute)}`);
    fail(Number.isInteger(em.rounds) && em.rounds >= 1 && em.rounds <= 50, `${where}: rounds must be 1-50, got ${String(em.rounds)}`);
    fail(em.stations.length >= 1 && em.stations.length * em.rounds <= 200, `${where}: needs 1-200 station minutes`);
    em.stations.forEach((st, i) => {
      const at = `${where} station ${String(i + 1)}`;
      const ex = exById.get(st.exerciseId);
      if (!ex) return;
      fail(tpl.exerciseIds.includes(st.exerciseId), `${at}: ${ex.name} missing from exerciseIds`);
      if (fail((st.reps === undefined) !== (st.seconds === undefined), `${at} (${ex.name}): needs exactly one of reps or seconds`)) return;
      const counts = st.reps ?? st.seconds ?? [];
      fail(counts.length === em.rounds, `${at} (${ex.name}): ${String(counts.length)} counts for ${String(em.rounds)} rounds; give one count per round`);
      if (st.reps) {
        fail(ex.metric === "reps" || ex.metric === "weight_reps", `${at}: ${ex.name} is a ${ex.metric} exercise, not counted in reps`);
        fail(st.reps.every((n) => Number.isInteger(n) && n >= 1 && n <= 100), `${at} (${ex.name}): reps must be whole numbers 1-100`);
        if (st.perSide) fail(st.reps.every((n) => n % 2 === 0), `${at} (${ex.name}): reps per ${st.perSide} must split evenly`);
      }
      if (st.seconds) {
        fail(ex.metric === "time", `${at}: ${ex.name} is a ${ex.metric} exercise, not timed`);
        fail(st.perSide === undefined, `${at} (${ex.name}): perSide is for reps`);
        fail(st.seconds.every((n) => Number.isInteger(n) && n >= 5 && n < em.minute), `${at} (${ex.name}): timed work must be whole seconds, 5 up to under the minute`);
      }
    });
    const warmup = em.warmup ?? [];
    warmup.forEach((w, i) => {
      const at = `${where} warm-up ${String(i + 1)}`;
      const ex = exById.get(w.exerciseId);
      if (!ex) return;
      fail(tpl.exerciseIds.includes(w.exerciseId), `${at}: ${ex.name} missing from exerciseIds`);
      fail(Number.isInteger(w.seconds) && w.seconds >= 10 && w.seconds <= 600, `${at}: 10-600 whole seconds, got ${String(w.seconds)}`);
    });
    const warm = warmup.reduce((a, w) => a + w.seconds, 0);
    // Played on a song set, the warm-up is Low and the rest High: the change
    // between them must land on a whole bar at every set's tempo.
    fail(warm % BAR_GRID_S === 0, `${where}: the warm-up runs ${String(warm)} s; make it a multiple of ${String(BAR_GRID_S)} s so the music changes on the bar`);
    const main = em.rounds * em.stations.length * em.minute;
    const expected = [
      fmt(warm + main),
      ...(warm > 0 ? [`${fmt(warm)} warm-up`] : []),
      `${fmt(main)} EMOM`,
      `${String(em.rounds)} rounds`,
      `${String(em.stations.length)} stations`,
    ];
    for (const part of expected) fail(tpl.scheme.includes(part), `${where}: scheme "${tpl.scheme}" does not say "${part}"`);
  }

  // --- ride ---
  // Each segment ends on time or on kcal — exactly one — with sane targets;
  // kcal makes it a race; an adaptive ride is whole bars at every set's tempo.
  const r = tpl.ride;
  if (r) {
    const where = `${name} ride`;
    fail(tpl.exerciseIds.length === 1 && tpl.exerciseIds[0] === SPIN_BIKE, `${where}: exerciseIds must be ["${SPIN_BIKE}"]`);
    if (r.free) {
      fail(r.segments.length === 0 && r.race !== true, `${where}: a free ride has no segments and is no race`);
    } else {
      fail(r.segments.length >= 1 && r.segments.length <= 100, `${where}: needs 1-100 segments`);
      let anyKcal = false;
      r.segments.forEach((sg, i) => {
        const at = `${where} segment ${String(i + 1)} ("${sg.label}")`;
        fail((sg.seconds === undefined) !== (sg.kcal === undefined), `${at}: needs exactly one of seconds or kcal`);
        if (sg.seconds !== undefined) fail(Number.isInteger(sg.seconds) && sg.seconds >= 5 && sg.seconds <= 4 * 3600, `${at}: seconds must be 5-14400`);
        if (sg.kcal !== undefined) {
          anyKcal = true;
          fail(Number.isInteger(sg.kcal) && sg.kcal >= 5 && sg.kcal <= 3000, `${at}: kcal must be 5-3000`);
        }
        const [lo, hi] = sg.ftp;
        fail(lo >= 20 && hi <= 300 && lo < hi, `${at}: FTP target ${String(lo)}-${String(hi)} % is not a sane range`);
        if (sg.cadence) fail(sg.cadence[0] >= 40 && sg.cadence[1] <= 160 && sg.cadence[0] < sg.cadence[1], `${at}: cadence target is not a sane range`);
        // Heart rate lags effort: a heart-rate block is long enough to settle
        // into its zone, and ends on time.
        if (sg.hrZone !== undefined) {
          fail(Number.isInteger(sg.hrZone) && sg.hrZone >= 1 && sg.hrZone <= 5, `${at}: hrZone must be a Garmin zone 1-5`);
          fail(sg.seconds !== undefined && sg.seconds >= 180, `${at}: a heart-rate block is timed and at least 3 minutes`);
          fail(tpl.scheme.includes(`heart-rate zone ${String(sg.hrZone)}`), `${at}: the scheme must say it rides in heart-rate zone ${String(sg.hrZone)}`);
        }
      });
      fail(anyKcal === (r.race === true), `${where}: a ride with kcal segments is a race (race: true), and only then`);
      if (r.segments.some((sg) => sg.intensity !== undefined)) {
        fail(tpl.music.set !== undefined && setById(tpl.music.set) !== undefined, `${where}: an adaptive ride needs music.set, one of ${SETS.map((x) => x.id).join(", ")}`);
        r.segments.forEach((sg, i) => {
          const at = `${where} segment ${String(i + 1)} ("${sg.label}")`;
          if (fail(sg.intensity === 1 || sg.intensity === 2 || sg.intensity === 3, `${at}: an adaptive ride sets intensity 1-3 on every block`)) return;
          if (sg.seconds === undefined) return;
          for (const set of SETS) {
            for (const l of [1, 2, 3] as const) {
              const bpm = set.bpm[l];
              const bars = (sg.seconds * bpm) / 240;
              fail(Number.isInteger(bars), `${at}: ${String(sg.seconds)} s at ${String(bpm)} BPM (${set.name} ${INTENSITY_NAMES[l]}) is ${bars.toFixed(2)} bars; pick lengths that make it whole bars`);
            }
          }
        });
      }
    }
  }

  // --- music ---
  // Typed as 1 | 2 | 3, but a program Mímir wrote is data until checked.
  const e: unknown = tpl.music.energy;
  fail(e === undefined || e === 1 || e === 2 || e === 3, `${name}: music.energy must be 1, 2 or 3`);
  const style = buildStyle(tpl.name, tpl.music, tpl.interval);
  fail(!style.endsWith("…") && style.length <= STYLE_LIMIT, `${name} music style is truncated to ${String(STYLE_LIMIT)} chars — shorten its theme or style`);

  // --- gear ---
  // The kit list is derived from the exercises; a template only qualifies it
  // or adds what no exercise implies.
  {
    const where = `${name} gear`;
    const derived = new Set<GearId>(templateExerciseIds(tpl).flatMap((id) => exerciseGear(id)));
    for (const id of tpl.gear?.extra ?? []) {
      fail(id in GEAR, `${where}: unknown gear "${id}"`);
      fail(!derived.has(id), `${where}: "${id}" comes from its exercises already; drop it from extra`);
    }
    const listed = new Set<string>(templateGear(tpl, exerciseGear).map((g) => g.id));
    for (const id of Object.keys(tpl.gear?.detail ?? {})) {
      fail(listed.has(id), `${where}: detail for "${id}", which the workout does not use`);
    }
  }

  // --- level and length ---
  // The library filters by both: a template that cannot say how long it
  // takes would silently drop out of every length filter.
  fail(["beginner", "intermediate", "advanced"].includes(tpl.level), `${name}: level must be beginner, intermediate or advanced`);
  const computed = tpl.interval !== undefined || tpl.flow !== undefined || tpl.emom !== undefined ||
    (tpl.ride !== undefined && !tpl.ride.free && tpl.ride.segments.every((sg) => sg.seconds !== undefined));
  if (computed) {
    fail(tpl.estimateMinutes === undefined, `${name}: has an exact clock time, so no estimateMinutes`);
  } else {
    const m = tpl.estimateMinutes;
    fail(m !== undefined && Number.isInteger(m) && m >= 1 && m <= 600, `${name}: needs estimateMinutes (typical finishing time, 1-600)`);
  }
  if (out.length === 0) fail(lengthBucket(tpl) !== undefined, `${name}: falls in no length bucket`);

  return out;
}
