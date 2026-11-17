/**
 * Every rule a workout template must keep, as a list of problems: empty
 * means the template runs exactly as its card says.
 *
 * One source of truth for two authors. check:content runs it over every
 * built-in (the coding agent's programs, see CLAUDE.md), Mímir runs it over
 * every program it proposes before the owner can save it, and the Hunt runs
 * it again before a saved program starts. A rule added here guards both.
 *
 * The shape itself (one plan kind, whole numbers, known enums) is the
 * schema's job (lib/schema.ts) and the type checker's. What is left here is
 * what types cannot say: ranges, one count per EMOM round, paired yoga
 * sides, labels that state their reps, music on whole bars.
 */
import type { Exercise, Template } from "../types";
import { exerciseGear, libraryFor } from "./library";
import { templateExerciseIds, templateGear } from "./gear";
import type { GearId } from "./gear";
import { lengthBucket } from "./catalog";
import { BAR_GRID_S } from "./workout-music";
import { buildStyle, STYLE_LIMIT } from "./music";
import { INTENSITY_NAMES, SETS, setById } from "./songs";
import { emomWarmupSeconds, intervalOf, intervalSeconds, planExercises } from "./plan";
import { rideSeconds } from "./ride";

// An interval runs as a fixed work/rest circuit and logs {seconds: work}
// and nothing else, so its note may not promise a distance, an AMRAP score
// or a rep count. Numbers are checked against the unit that follows them:
// a bare /\d+\s*m/ would refuse Rasteplads' correct "90 s a round".
const INTERVAL_NOTE_UNITS = new Set([
  "s", "sec", "secs", "second", "seconds",
  "min", "mins", "minute", "minutes",
  "round", "rounds", "station", "stations",
  "kg", "cm",
]);
const DISTANCE_RE = /\d+(?:[.,]\d+)?\s*(?:m|km|meters|metres)\b/iu;
const AMRAP_RE = /\bAMRAP\b/iu;
const COUNTED_RE = /(\d+(?:[.,]\d+)?)\s*(\p{L}[\p{L}-]*)?/gu;

// The guided player builds one step per station per round up front and
// scans them on every render: an absurd count is a frozen phone.
const MAX_STEPS = 200;
const MAX_DURATION = 2 * 60 * 60;

/**
 * Everything wrong with `tpl`, each as one sentence naming the template.
 * `exercises` is the catalogue it may draw from.
 */
export function templateProblems(tpl: Template, exercises: readonly Exercise[]): string[] {
  const out: string[] = [];
  const fail = (cond: boolean, msg: string): boolean => {
    if (!cond) out.push(msg);
    return !cond;
  };
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const name = `template "${tpl.name}"`;

  // Every exercise must resolve: a typo'd id is invisible until the workout
  // refuses to start.
  const missing = [...new Set(planExercises(tpl.plan).filter((id) => !exById.has(id)))];
  if (missing.length > 0) {
    out.push(`${name} references unknown exercises: ${missing.join(", ")}`);
    return out;
  }
  const ex = (id: string): Exercise => {
    const e = exById.get(id);
    if (!e) throw new Error(`unreachable: ${id} was checked above`);
    return e;
  };

  const plan = tpl.plan;
  switch (plan.kind) {
    case "interval": {
      const where = `${name} interval`;
      const note = plan.note ?? "";
      const wrong: string[] = [];
      if (DISTANCE_RE.test(note)) wrong.push("prescribes a distance");
      if (AMRAP_RE.test(note)) wrong.push("prescribes an AMRAP score");
      const counts: string[] = [];
      for (const m of note.matchAll(COUNTED_RE)) {
        const unit = m[2]?.toLowerCase();
        if (unit !== undefined && !INTERVAL_NOTE_UNITS.has(unit)) counts.push(m[0].trim());
      }
      if (counts.length > 0) wrong.push(`counts ${counts.map((c) => `"${c}"`).join(", ")}`);
      fail(wrong.length === 0, `${where}: its note ${wrong.join(" and ")}: "${note}". An interval enforces time only; make it a logged or for-time workout instead.`);
      fail(plan.stations.length >= 1, `${where}: no stations`);
      fail(plan.rounds >= 1 && plan.rounds <= 50, `${where}: rounds must be 1-50, got ${plan.rounds}`);
      fail(plan.work >= 5 && plan.work <= 600, `${where}: work must be 5-600 s, got ${plan.work}`);
      fail(plan.rest >= 0 && plan.rest <= 600, `${where}: rest must be 0-600 s, got ${plan.rest}`);
      const steps = plan.stations.length * plan.rounds;
      fail(steps <= MAX_STEPS, `${where}: ${steps} steps (${plan.stations.length} stations × ${plan.rounds} rounds) exceeds ${MAX_STEPS}`);
      const seconds = intervalSeconds(plan);
      fail(seconds <= MAX_DURATION, `${where}: runs ${Math.round(seconds / 60)} min, over the ${MAX_DURATION / 60} min ceiling`);
      break;
    }

    case "forTime": {
      // One Done per stage, and each stage logs the prescribed amount: the
      // amount is what the exercise's metric measures, the label says it.
      const where = `${name} forTime`;
      fail(plan.stages.length >= 1 && plan.stages.length <= 200, `${where}: needs 1-200 stages, has ${plan.stages.length}`);
      plan.stages.forEach((st, i) => {
        const at = `${where} stage ${i + 1} ("${st.label}")`;
        const e = ex(st.exerciseId);
        if (e.metric === "reps" || e.metric === "weight_reps") {
          if (fail(st.reps !== undefined && st.reps > 0 && st.meters === undefined, `${at}: ${e.name} is counted in reps: give the stage a reps target and no metres`)) return;
          fail(new RegExp(`(^|\\D)${st.reps ?? ""}(\\D|$)`).test(st.label), `${at}: label does not state the ${st.reps ?? 0} reps the stage logs`);
        } else if (e.metric === "distance_time") {
          if (fail(st.meters !== undefined && st.meters > 0 && st.reps === undefined, `${at}: ${e.name} is measured in distance: give the stage a metres target and no reps`)) return;
          const m = st.meters ?? 0;
          fail(st.label.includes(`${m / 1000} km`) || st.label.includes(`${m} m`), `${at}: label does not state the ${m} m the stage logs`);
        } else {
          out.push(`${at}: ${e.name} is a ${e.metric} exercise, which a for-time stage cannot prescribe`);
        }
      });
      break;
    }

    case "flow": {
      // Every pose its own hold; one-sided poses as an adjacent left/right
      // pair, on an animation that declares which side it draws.
      const where = `${name} flow`;
      fail(plan.steps.length >= 1 && plan.steps.length <= 200, `${where}: needs 1-200 steps`);
      plan.steps.forEach((st, i) => {
        const at = `${where} step ${i + 1}`;
        const e = ex(st.exerciseId);
        fail(st.seconds >= 10 && st.seconds <= 300, `${at}: hold must be 10-300 s, got ${st.seconds}`);
        if (st.side === undefined) return;
        fail(libraryFor(e).side !== undefined, `${at}: ${e.name} is one-sided but its animation does not declare which side it draws`);
        const other = st.side === "left" ? "right" : "left";
        const pair = st.side === "left" ? plan.steps[i + 1] : plan.steps[i - 1];
        if (fail(pair?.exerciseId === st.exerciseId && pair.side === other, `${at}: ${e.name} ${st.side} side is not paired with the ${other} side next to it`)) return;
        fail(st.side === "right" || pair?.seconds === st.seconds, `${at}: ${e.name} sides are held for different times`);
      });
      fail(plan.transition >= 0 && plan.transition <= 60, `${where}: transition must be 0-60 s, got ${plan.transition}`);
      break;
    }

    case "emom": {
      // Every station owns one whole minute; one count per round, never a
      // range; reps only for what counts reps; timed work fits the minute.
      const where = `${name} emom`;
      fail(plan.minute >= 30 && plan.minute <= 300, `${where}: minute must be 30-300 s, got ${plan.minute}`);
      fail(plan.rounds >= 1 && plan.rounds <= 50, `${where}: rounds must be 1-50, got ${plan.rounds}`);
      fail(plan.stations.length >= 1 && plan.stations.length * plan.rounds <= 200, `${where}: needs 1-200 station minutes`);
      plan.stations.forEach((st, i) => {
        const e = ex(st.exerciseId);
        const at = `${where} station ${i + 1} (${e.name})`;
        if (fail((st.reps === undefined) !== (st.seconds === undefined), `${at}: needs exactly one of reps or seconds`)) return;
        const counts = st.reps ?? st.seconds ?? [];
        fail(counts.length === plan.rounds, `${at}: ${counts.length} counts for ${plan.rounds} rounds; give one count per round`);
        if (st.reps) {
          fail(e.metric === "reps" || e.metric === "weight_reps", `${at}: a ${e.metric} exercise is not counted in reps`);
          fail(st.reps.every((n) => n >= 1 && n <= 100), `${at}: reps must be 1-100`);
          if (st.perSide) fail(st.reps.every((n) => n % 2 === 0), `${at}: reps per ${st.perSide} must split evenly`);
        }
        if (st.seconds) {
          fail(e.metric === "time", `${at}: a ${e.metric} exercise is not timed`);
          fail(st.perSide === undefined, `${at}: perSide is for reps`);
          fail(st.seconds.every((n) => n >= 5 && n < plan.minute), `${at}: timed work must be 5 s up to under the minute`);
        }
      });
      (plan.warmup ?? []).forEach((w, i) => {
        fail(w.seconds >= 10 && w.seconds <= 600, `${where} warm-up ${i + 1}: 10-600 s, got ${w.seconds}`);
      });
      // Played on a song set, the warm-up is Low and the rest High: the
      // change between them must land on a whole bar at every set's tempo.
      const warm = emomWarmupSeconds(plan);
      fail(warm % BAR_GRID_S === 0, `${where}: the warm-up runs ${warm} s; make it a multiple of ${BAR_GRID_S} s so the music changes on the bar`);
      break;
    }

    case "ride": {
      // Each block ends on time or on kcal, exactly one, with sane targets;
      // kcal makes it a race; an adaptive ride is whole bars at every set's tempo.
      const where = `${name} ride`;
      if (plan.free) {
        fail(plan.segments.length === 0 && plan.race !== true, `${where}: a free ride has no segments and is no race`);
      } else {
        fail(plan.segments.length >= 1 && plan.segments.length <= 100, `${where}: needs 1-100 segments`);
      }
      let anyKcal = false;
      plan.segments.forEach((sg, i) => {
        const at = `${where} segment ${i + 1} ("${sg.label}")`;
        fail((sg.seconds === undefined) !== (sg.kcal === undefined), `${at}: needs exactly one of seconds or kcal`);
        if (sg.seconds !== undefined) fail(sg.seconds >= 5 && sg.seconds <= 4 * 3600, `${at}: seconds must be 5-14400`);
        if (sg.kcal !== undefined) {
          anyKcal = true;
          fail(sg.kcal >= 5 && sg.kcal <= 3000, `${at}: kcal must be 5-3000`);
        }
        const [lo, hi] = sg.ftp;
        fail(lo >= 20 && hi <= 300 && lo < hi, `${at}: FTP target ${lo}-${hi} % is not a sane range`);
        if (sg.cadence) fail(sg.cadence[0] >= 40 && sg.cadence[1] <= 160 && sg.cadence[0] < sg.cadence[1], `${at}: cadence target is not a sane range`);
        // Heart rate lags effort: a heart-rate block settles for minutes, on time.
        if (sg.hrZone !== undefined) {
          fail(sg.hrZone >= 1 && sg.hrZone <= 5, `${at}: hrZone must be a Garmin zone 1-5`);
          fail(sg.seconds !== undefined && sg.seconds >= 180, `${at}: a heart-rate block is timed and at least 3 minutes`);
          fail(plan.scheme.includes(`heart-rate zone ${sg.hrZone}`), `${at}: the scheme must say it rides in heart-rate zone ${sg.hrZone}`);
        }
      });
      fail(anyKcal === (plan.race === true), `${where}: a ride with kcal segments is a race (race: true), and only then`);
      if (plan.segments.some((sg) => sg.intensity !== undefined)) {
        fail(tpl.music.set !== undefined && setById(tpl.music.set) !== undefined, `${where}: an adaptive ride needs music.set, one of ${SETS.map((x) => x.id).join(", ")}`);
        plan.segments.forEach((sg, i) => {
          const at = `${where} segment ${i + 1} ("${sg.label}")`;
          if (fail(sg.intensity !== undefined, `${at}: an adaptive ride sets intensity 1-3 on every block`)) return;
          if (sg.seconds === undefined) return;
          for (const set of SETS) {
            for (const l of [1, 2, 3] as const) {
              const bars = (sg.seconds * set.bpm[l]) / 240;
              fail(Number.isInteger(bars), `${at}: ${sg.seconds} s at ${set.bpm[l]} BPM (${set.name} ${INTENSITY_NAMES[l]}) is ${bars.toFixed(2)} bars; pick lengths that make it whole bars`);
            }
          }
        });
      }
      // An estimate exactly when the length cannot be computed.
      const computed = plan.free !== true && rideSeconds(plan.segments) !== undefined;
      if (computed) fail(plan.estimateMinutes === undefined, `${where}: has an exact clock time, so no estimateMinutes`);
      else fail(plan.estimateMinutes !== undefined, `${where}: needs estimateMinutes (kcal blocks or a free ride have no clock time)`);
      break;
    }

    case "logged":
      fail(plan.exercises.length >= 1, `${name}: a logged session needs exercises`);
      break;
  }

  if ((plan.kind === "forTime" || plan.kind === "logged" || plan.kind === "ride") && plan.estimateMinutes !== undefined) {
    fail(plan.estimateMinutes >= 1 && plan.estimateMinutes <= 600, `${name}: estimateMinutes must be 1-600`);
  }

  // The battle track's description must fit the gateway untrimmed.
  const style = buildStyle(tpl.name, tpl.music, intervalOf(tpl));
  fail(!style.endsWith("…") && style.length <= STYLE_LIMIT, `${name} music style is truncated to ${STYLE_LIMIT} chars — shorten its theme or style`);

  // The kit list is derived from the exercises; a template only qualifies it
  // or adds what no exercise implies.
  {
    const where = `${name} gear`;
    const derived = new Set<GearId>(templateExerciseIds(tpl).flatMap((id) => exerciseGear(id)));
    for (const id of tpl.gear?.extra ?? []) {
      fail(!derived.has(id), `${where}: "${id}" comes from its exercises already; drop it from extra`);
    }
    const listed = new Set<string>(templateGear(tpl, exerciseGear).map((g) => g.id));
    for (const id of Object.keys(tpl.gear?.detail ?? {})) {
      fail(listed.has(id), `${where}: detail for "${id}", which the workout does not use`);
    }
  }

  if (out.length === 0) fail(lengthBucket(tpl) !== undefined, `${name}: falls in no length bucket`);
  return out;
}
