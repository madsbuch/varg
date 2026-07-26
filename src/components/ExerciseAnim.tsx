/**
 * Animated exercise demonstrations: minimalist stick figures drawn in
 * SVG and looped with SMIL <animate> (universally supported in the
 * Android WebView / Chromium — no JS, no network, no assets).
 *
 * Each archetype is a set of parts; a part is either a path whose `d`
 * morphs between frames (identical command structure per frame!) or a
 * circle whose center moves. Figures live in a 100×100 box, ground ≈ y88.
 */

interface PathPart {
  kind: "path";
  frames: string[]; // 1 = static, 2-3 = keyframes (loops back to first)
  gear?: boolean; // equipment: bar, plates, boxes — rendered muted
  fill?: boolean;
}

interface CirclePart {
  kind: "circle";
  cx: number[];
  cy: number[];
  r: number;
  gear?: boolean;
}

type Part = PathPart | CirclePart;

interface AnimDef {
  dur: number; // seconds per loop
  parts: Part[];
}

export type AnimKey = keyof typeof DEFS;

const p = (frames: string[], extra?: Partial<PathPart>): PathPart => ({
  kind: "path",
  frames,
  ...extra,
});
const head = (cx: number[], cy: number[]): CirclePart => ({
  kind: "circle",
  cx,
  cy,
  r: 5,
});
const gearC = (cx: number[], cy: number[], r: number): CirclePart => ({
  kind: "circle",
  cx,
  cy,
  r,
  gear: true,
});

const DEFS = {
  /**
   * Not an exercise: the rest block's own figure. Deliberately still —
   * a standing athlete breathing — so a glance can never confuse it
   * with a station.
   */
  rest: {
    dur: 3.2,
    parts: [
      p(["M44 88 L46 74 L48 62 M56 88 L54 74 L52 62"]),
      p(["M50 62 L50 40", "M50 62 L50 38"]),
      p([
        "M50 44 L40 54 L46 60 M50 44 L60 54 L54 60",
        "M50 42 L39 53 L46 59 M50 42 L61 53 L54 59",
      ]),
      head([50, 50], [33, 31]),
    ],
  },
  squat: {
    dur: 2.2,
    parts: [
      p(["M46 88 L47 72 L46 56", "M46 88 L54 72 L38 66"]),
      p(["M46 56 L48 32", "M38 66 L50 46"]),
      p(["M48 32 L40 30 M48 32 L58 30", "M50 46 L42 44 M50 46 L60 44"]),
      p(["M32 30 L64 30", "M34 44 L66 44"], { gear: true }),
      head([52, 54], [25, 39]),
    ],
  },
  airSquat: {
    dur: 2.2,
    parts: [
      // Torso stays upright at the bottom — that is what separates an air
      // squat from a hinge at a glance.
      p(["M46 88 L47 72 L46 56", "M46 88 L58 74 L42 68"]),
      p(["M46 56 L48 32", "M42 68 L47 46"]),
      // Arms reach forward at the bottom, but one high and one low: two
      // arms four units apart are one arm once the stroke is drawn. The
      // vertical spread has to be wide enough that the near hand rising
      // and the far hand dropping do not cross halfway through the morph.
      p(["M48 36 L42 50 M48 36 L54 50", "M46 50 L58 38 M46 50 L60 58"]),
      head([52, 50], [25, 39]),
    ],
  },
  hinge: {
    dur: 2.4,
    parts: [
      p(["M50 88 L48 72 L40 58", "M50 88 L50 70 L48 52"]),
      p(["M40 58 L53 42", "M48 52 L50 30"]),
      p(["M53 42 L58 78", "M50 30 L56 58"]),
      head([58, 54], [36, 24]),
      gearC([58, 56], [78, 58], 7),
    ],
  },
  swing: {
    dur: 1.6,
    parts: [
      p(["M50 88 L47 72 L40 58", "M50 88 L49 70 L46 52"]),
      p(["M40 58 L50 44", "M46 52 L48 32"]),
      p(["M50 44 L44 68", "M48 32 L64 36"]),
      head([56, 52], [40, 25]),
      gearC([44, 66], [73, 40], 5),
    ],
  },
  press: {
    dur: 1.8,
    parts: [
      p(["M46 88 L47 72 L47 58"]),
      p(["M47 58 L48 34"]),
      p(["M48 34 L42 30 M48 34 L56 30", "M48 34 L44 14 M48 34 L54 14"]),
      p(["M36 28 L62 28", "M36 12 L62 12"], { gear: true }),
      head([52], [24]),
    ],
  },
  thruster: {
    dur: 1.8,
    parts: [
      p(["M46 88 L54 72 L38 66", "M46 88 L47 72 L46 56"]),
      p(["M38 66 L50 46", "M46 56 L48 32"]),
      p(["M50 46 L44 42 M50 46 L56 42", "M48 32 L44 12 M48 32 L54 12"]),
      p(["M36 40 L64 40", "M34 10 L64 10"], { gear: true }),
      head([54, 52], [39, 25]),
    ],
  },
  bench: {
    dur: 1.9,
    parts: [
      p(["M24 70 L72 70 M32 70 L32 84 M64 70 L64 84"], { gear: true }),
      p(["M33 64 L58 64"]),
      p(["M58 64 L68 74 L68 88"]),
      p(["M36 62 L38 52", "M36 62 L37 34"]),
      head([26], [62]),
      gearC([38, 37], [52, 34], 6),
    ],
  },
  row: {
    dur: 1.5,
    parts: [
      p(["M46 88 L47 72 L42 58"]),
      p(["M42 58 L56 40"]),
      p(["M56 40 L58 66", "M56 40 L56 52"]),
      head([61], [36]),
      gearC([58, 56], [68, 54], 6),
    ],
  },
  pullup: {
    dur: 2.0,
    parts: [
      p(["M30 12 L70 12"], { gear: true }),
      p(["M42 12 L50 30 M58 12 L50 30", "M42 12 L50 16 M58 12 L50 16"]),
      p(["M50 30 L49 55", "M50 16 L49 42"]),
      p(["M49 55 L46 70 L50 82", "M49 42 L44 56 L50 68"]),
      head([50, 52], [23, 8]),
    ],
  },
  hang: {
    dur: 2.2,
    parts: [
      p(["M30 12 L70 12"], { gear: true }),
      p(["M42 12 L50 30 M58 12 L50 30"]),
      p(["M50 30 L49 55"]),
      p(["M49 55 L48 70 L48 84", "M49 55 L62 57 L72 57"]),
      head([50], [23]),
    ],
  },
  pushup: {
    dur: 1.7,
    parts: [
      p(["M76 86 L28 58", "M76 86 L26 74"]),
      p(["M28 58 L28 86", "M26 74 L30 86"]),
      head([22, 19], [54, 71]),
    ],
  },
  dip: {
    dur: 1.8,
    parts: [
      p(["M30 46 L70 46 M35 46 L35 88 M65 46 L65 88"], { gear: true }),
      p(["M50 40 L53 46", "M50 50 L53 46"]),
      p(["M50 40 L49 62", "M50 50 L49 70"]),
      p(["M49 62 L43 74 L48 80", "M49 70 L43 80 L48 86"]),
      head([50, 50], [32, 42]),
    ],
  },
  benchDip: {
    dur: 1.8,
    parts: [
      p(["M14 56 L46 56 M20 56 L20 86 M40 56 L40 86"], { gear: true }),
      p(["M44 56 L46 52 L50 48", "M44 56 L41 64 L50 64"]),
      p(["M50 48 L56 70", "M50 64 L56 78"]),
      p(["M56 70 L78 76 L82 88", "M56 78 L78 80 L82 88"]),
      head([54, 54], [41, 57]),
    ],
  },
  situp: {
    dur: 1.8,
    parts: [
      p(["M46 84 L56 70 L64 84"]),
      p(["M46 84 L22 82", "M46 84 L38 62"]),
      head([17, 37], [78, 57]),
    ],
  },
  backLift: {
    dur: 2.2,
    parts: [
      p(["M58 84 L34 82", "M58 84 L34 70"]),
      p(["M58 84 L84 82", "M58 84 L84 70"]),
      p(["M34 82 L18 84", "M34 70 L18 62"]),
      head([28, 28], [74, 62]),
    ],
  },
  flutter: {
    dur: 0.9,
    parts: [
      p(["M20 80 L46 80"]),
      // Scissoring legs that never cross paths — see runInPlace.
      p(["M46 80 L64 68", "M46 80 L64 74"]),
      p(["M46 80 L64 88", "M46 80 L64 82"]),
      head([15], [78]),
    ],
  },
  plank: {
    dur: 2.5,
    parts: [
      p(["M32 82 L42 82 M32 82 L32 62", "M32 82 L42 82 M32 82 L32 64"]),
      p(["M32 62 L78 86", "M32 64 L78 86"]),
      head([26, 26], [58, 60]),
    ],
  },
  reverseLunge: {
    dur: 2.4,
    parts: [
      // Front leg stays forward, trail leg stays behind — never mirrored,
      // so the two never coincide midway through the morph.
      p([
        // Standing frame is a hip-width stance, not feet together: at 8
        // units the two legs sit right on the merge point for a 4-unit
        // stroke and read as one line at the ends of the loop.
        "M43 88 L46 74 L48 60 M55 88 L53 74 L50 60",
        "M38 88 L40 74 L48 62 M74 86 L64 80 L48 62",
      ]),
      p(["M49 60 L50 36", "M48 62 L48 38"]),
      p(["M50 44 L44 56 M50 44 L56 56", "M48 46 L42 58 M48 46 L54 58"]),
      head([51, 49], [29, 31]),
    ],
  },
  kneeLift: {
    dur: 2.0,
    parts: [
      // One leg lifts against a planted one. Alternating both legs in two
      // frames puts them at equal half-height mid-morph, which at this slow
      // tempo reads as a squat — the cue text carries the alternation.
      p(["M50 64 L46 76 L46 88"]),
      p(["M50 64 L54 76 L54 88", "M50 64 L61 57 L56 69"]),
      p(["M50 64 L50 40"]),
      p(["M50 46 L44 58 M50 46 L56 58"]),
      head([50], [33]),
    ],
  },
  armCircles: {
    dur: 2.0,
    parts: [
      p(["M44 88 L46 74 L48 62 M56 88 L54 74 L52 62"]),
      p(["M50 62 L50 40"]),
      // Three frames: down, out, up. Each arm keeps its own side.
      p([
        "M50 44 L36 58 M50 44 L64 58",
        "M50 44 L30 44 M50 44 L70 44",
        "M50 44 L36 28 M50 44 L64 28",
      ]),
      head([50], [33]),
    ],
  },
  lunge: {
    dur: 2.0,
    parts: [
      // Stance width at the top: feet stacked on the same point read as a
      // one-legged figure for as long as the standing frame is held.
      p([
        "M52 88 L51 72 L46 56 M40 88 L41 72 L46 56",
        "M58 88 L58 74 L46 64 M30 86 L38 80 L46 64",
      ]),
      p(["M46 56 L48 32", "M46 64 L48 40"]),
      head([51, 51], [25, 33]),
    ],
  },
  jump: {
    dur: 2.6,
    parts: [
      p(["M60 88 L60 66 L88 66 L88 88"], { gear: true }),
      p([
        "M38 88 L44 74 L36 64",
        "M56 54 L60 44 L54 36",
        "M70 66 L74 52 L68 42",
      ]),
      p(["M36 64 L40 44", "M54 36 L56 18", "M68 42 L70 22"]),
      p(["M40 44 L30 56", "M56 18 L64 12", "M70 22 L78 32"]),
      head([44, 60, 74], [37, 11, 15]),
    ],
  },
  boxStepUp: {
    dur: 2.4,
    parts: [
      p(["M60 88 L60 66 L88 66 L88 88"], { gear: true }),
      // A step-up is not a small box jump: the lead foot is planted on the
      // box in both frames and there is never a moment with both feet off
      // the ground. Chad 1000x is a thousand of these under a ruck, and a
      // figure that hops would coach the wrong movement for two hours.
      p([
        "M46 60 L54 62 L62 66 M46 60 L44 74 L44 88",
        "M66 42 L66 54 L66 66 M66 42 L58 56 L52 70",
      ]),
      p(["M46 60 L50 36", "M66 42 L68 20"]),
      p(["M49 38 L42 48 M49 38 L56 48", "M67 22 L60 32 M67 22 L74 32"]),
      head([52, 70], [30, 14]),
    ],
  },
  powerThrow: {
    dur: 2.0,
    parts: [
      p(["M46 88 L54 72 L38 66", "M46 88 L47 72 L46 56"]),
      p(["M38 66 L50 46", "M46 56 L40 34"]),
      p(["M50 46 L46 60 M50 46 L56 58", "M40 34 L26 24 M40 34 L32 12"]),
      // The throw is backwards over the head, so the ball ends up behind
      // the athlete — that arc is the event, and it is the only thing that
      // separates this from an overhead press.
      gearC([51, 22], [63, 8], 5),
      head([56, 46], [40, 27]),
    ],
  },
  sprintDragCarry: {
    dur: 1.0,
    parts: [
      p(["M4 88 L22 88 L22 80 L4 80 Z"], { gear: true, fill: true }),
      p(["M22 80 L42 48", "M22 80 L40 52"], { gear: true }),
      p(["M46 60 L50 36"]),
      // Driving stride under load: lead leg in front, trail leg behind,
      // both clear of the strap line — see runInPlace.
      p([
        "M46 60 L56 70 L60 82 M46 60 L40 74 L34 84",
        "M46 60 L50 74 L52 88 M46 60 L38 72 L30 78",
      ]),
      p(["M50 38 L58 44 M50 38 L42 48", "M50 38 L60 40 M50 38 L40 52"]),
      head([54], [29]),
    ],
  },
  burpee: {
    dur: 2.8,
    parts: [
      p([
        "M46 88 L47 72 L46 56",
        "M46 88 L52 74 L40 68",
        "M78 86 L64 76 L50 66",
      ]),
      p(["M46 56 L48 32", "M40 68 L44 52", "M50 66 L34 64"]),
      p(["M48 34 L46 52", "M44 52 L36 84", "M34 64 L34 86"]),
      head([52, 48, 28], [25, 46, 62]),
    ],
  },
  run: {
    dur: 0.8,
    parts: [
      p(["M46 60 L50 36"]),
      // Lead leg stays in front, trail leg stays behind — see runInPlace.
      p([
        "M46 60 L58 70 L62 82 M46 60 L40 74 L32 80",
        "M46 60 L50 74 L52 88 M46 60 L38 70 L30 66",
      ]),
      p(["M50 38 L60 42 M50 38 L40 50", "M50 38 L58 50 M50 38 L42 42"]),
      head([54], [29]),
    ],
  },
  runInPlace: {
    dur: 0.7,
    parts: [
      p(["M50 64 L50 40", "M50 62 L50 38"]),
      // Each limb stays on its own side of the body. Mirroring two limbs
      // across the centre line makes them coincide exactly halfway
      // through the morph, and the figure flattens into a stick for half
      // the loop — the same reason `run` used to look broken.
      p([
        "M50 64 L44 72 L44 88 M50 64 L58 58 L54 70",
        "M50 62 L42 58 L46 70 M50 62 L56 72 L56 88",
      ]),
      p([
        "M50 44 L41 48 L45 56 M50 44 L59 48 L55 38",
        "M50 42 L40 46 L44 36 M50 42 L58 46 L54 54",
      ]),
      head([50, 50], [33, 31]),
    ],
  },
  boxing: {
    dur: 0.9,
    parts: [
      p(["M38 88 L42 74 L48 62 M64 88 L58 74 L52 62"]),
      p(["M50 62 L50 42", "M52 62 L52 42"]),
      // One hand punches, the other holds guard by the cheek — swapping
      // which arm is extended puts both at the same mid-height halfway
      // through the morph. The cue text carries the alternation, the same
      // way kneeLift's does.
      p([
        "M50 46 L62 44 L76 46 M50 46 L46 38 L52 33",
        "M52 46 L60 46 L62 42 M52 46 L47 39 L53 34",
      ]),
      head([53, 55], [35, 34]),
    ],
  },
  ruck: {
    dur: 1.4,
    parts: [
      p(["M46 62 L48 34"]),
      p(["M37 38 L45 40 L44 54 L36 52 Z"], { gear: true, fill: true }),
      // Lead leg stays in front, trail leg stays behind — see runInPlace.
      // Swapping them mirrors both across the hip and the march collapses
      // into a single vertical stick halfway through every stride.
      p([
        "M46 62 L54 72 L58 86 M46 62 L42 76 L38 88",
        "M46 62 L50 74 L52 88 M46 62 L38 72 L32 82",
      ]),
      // Same trap for the arm: mirroring it across the torso sends it
      // vertical at the midpoint, straight down the body line. It swings
      // fore and aft on the near side instead.
      p(["M48 40 L58 44", "M48 40 L55 55"]),
      head([52], [27]),
    ],
  },
  carry: {
    dur: 1.4,
    parts: [
      p(["M46 60 L48 34"]),
      // Short loaded steps, but the legs still keep their own side — see
      // runInPlace.
      p([
        "M46 60 L52 72 L54 86 M46 60 L42 74 L40 88",
        "M46 60 L49 74 L50 88 M46 60 L39 72 L34 84",
      ]),
      p(["M48 36 L40 58 M48 36 L56 58"]),
      gearC([39, 39], [63, 64], 5),
      gearC([57, 57], [64, 63], 5),
      head([52], [27]),
    ],
  },
  rowErg: {
    dur: 1.8,
    parts: [
      p(["M18 84 L82 84"], { gear: true }),
      p(["M42 78 L52 64 L64 77", "M36 78 L50 74 L64 77"]),
      p(["M42 78 L52 60", "M36 78 L28 58"]),
      p(["M52 62 L68 68", "M30 60 L44 62"]),
      head([56, 31], [54, 51]),
      gearC([69, 45], [68, 62], 3),
    ],
  },
  bike: {
    dur: 1.0,
    parts: [
      p(["M38 70 L38 80 M30 84 L46 84"], { gear: true }),
      p(["M38 68 L44 44"]),
      p(["M44 46 L58 42", "M44 46 L52 50"]),
      p(["M38 68 L48 74 L54 70", "M38 68 L44 80 L52 82"]),
      head([48], [37]),
    ],
  },
} satisfies Record<string, AnimDef>;

function loopValues(frames: string[] | number[]): string {
  return [...frames, frames[0]].join(";");
}

export default function ExerciseAnim({
  anim,
  size = 96,
}: {
  anim: AnimKey;
  size?: number;
}) {
  const def: AnimDef = DEFS[anim];
  const dur = `${def.dur}s`;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="ex-anim"
      aria-hidden
    >
      <line x1="8" y1="90" x2="92" y2="90" className="ex-ground" />
      {def.parts.map((part, i) => {
        if (part.kind === "circle") {
          return (
            <circle
              key={i}
              cx={part.cx[0]}
              cy={part.cy[0]}
              r={part.r}
              className={part.gear ? "ex-gear" : "ex-head"}
            >
              {part.cx.length > 1 && (
                <animate
                  attributeName="cx"
                  values={loopValues(part.cx)}
                  dur={dur}
                  repeatCount="indefinite"
                />
              )}
              {part.cy.length > 1 && (
                <animate
                  attributeName="cy"
                  values={loopValues(part.cy)}
                  dur={dur}
                  repeatCount="indefinite"
                />
              )}
            </circle>
          );
        }
        return (
          <path
            key={i}
            d={part.frames[0]}
            className={`${part.gear ? "ex-gear" : "ex-limb"}${part.fill ? " ex-fill" : ""}`}
          >
            {part.frames.length > 1 && (
              <animate
                attributeName="d"
                values={loopValues(part.frames)}
                dur={dur}
                repeatCount="indefinite"
              />
            )}
          </path>
        );
      })}
    </svg>
  );
}
