/**
 * Exercise choreography in a 100 × 100 stage. All figures share the same
 * skeleton. Solve elbows/knees AFTER sampling the motion, so interpolation
 * cannot turn a bent arm into a shorter straight arm. SVG samples are baked
 * once at module load; playback remains native SMIL, including offline.
 */
export type Point = readonly [number, number];
type Pair<T> = readonly [T, T];
type Bend = 1 | -1;
const TAU = Math.PI * 2;
const ARM = 12;
const LEG = 17;
const TORSO = 23;
export const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const between = (a: Point, b: Point, t: number): Point => [mix(a[0], b[0], t), mix(a[1], b[1], t)];
const vector = (angle: number, length: number): Point => [Math.cos(angle * Math.PI / 180) * length, Math.sin(angle * Math.PI / 180) * length];
export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const shoulderAt = (hip: Point, lean: number) => add(hip, vector(lean - 90, TORSO));
const reach = (root: Point, a: number, b = a, length = ARM) => add(add(root, vector(a, length)), vector(b, length));

export interface Pose {
  hip: Point;
  lean: number;
  feet: Pair<Point>;
  hands: Pair<Point>;
  knees: Pair<Bend>;
  elbows: Pair<Bend>;
  headLean: number;
  spine: number;
  legProjection: number;
}
type PoseOptions = Partial<Omit<Pose, "hip" | "lean" | "feet" | "hands">> & { farFoot?: Point; farHand?: Point };
function pose(hip: Point, lean: number, foot: Point, hand: Point, opts: PoseOptions = {}): Pose {
  return {
    hip, lean,
    feet: [opts.farFoot ?? add(foot, [-5, 0]), foot],
    hands: [opts.farHand ?? add(hand, [-3, 0]), hand],
    knees: opts.knees ?? [-1, -1], elbows: opts.elbows ?? [1, 1],
    headLean: opts.headLean ?? lean, spine: opts.spine ?? 0, legProjection: opts.legProjection ?? 1,
  };
}
function arms(hip: Point, lean: number, a: number, b = a): Point { return reach(shoulderAt(hip, lean), a, b); }

/** A two-bone chain with fixed lengths, including at every in-between pose. */
export function solveLimb(root: Point, target: Point, length: number, bend: Bend): readonly [Point, Point, Point] {
  const d = distance(root, target);
  const span = Math.min(length * 2, Math.max(0.001, d));
  const axis: Point = d < 0.001 ? [0, 1] : [(target[0] - root[0]) / d, (target[1] - root[1]) / d];
  const end = add(root, [axis[0] * span, axis[1] * span]);
  const middle = between(root, end, 0.5);
  const height = Math.sqrt(Math.max(0, length * length - span * span / 4));
  return [root, add(middle, [-axis[1] * height * bend, axis[0] * height * bend]), end];
}
export function skeleton(p: Pose) {
  const shoulder = shoulderAt(p.hip, p.lean);
  return {
    hip: p.hip, shoulder,
    head: add(shoulder, vector(p.headLean - 90, 8)),
    arms: [solveLimb(shoulder, p.hands[0], ARM, p.elbows[0]), solveLimb(shoulder, p.hands[1], ARM, p.elbows[1])] as const,
    legs: [solveLimb(p.hip, p.feet[0], LEG, p.knees[0]), solveLimb(p.hip, p.feet[1], LEG, p.knees[1])].map(chain => chain.map(point => [point[0], p.hip[1] + (point[1] - p.hip[1]) * p.legProjection] as Point)) ,
  };
}
type Skeleton = ReturnType<typeof skeleton>;
export function required<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing animation sample ${index}`);
  return value;
}
export interface Shape { d: string; style: "gear" | "far" | "body"; opacity?: number }
export interface Ball { center: Point; radius: number; opacity?: number }
export interface Scene { pose: Pose; shapes: Shape[]; balls: Ball[] }
interface Motion {
  dur: number;
  at: (t: number) => Pose;
  equipment?: (t: number, s: Skeleton) => { shapes?: Shape[]; balls?: Ball[] };
}
const f = (n: number) => Number(n.toFixed(3));
export function path(points: readonly Point[]): string { return points.map((p, i) => `${i ? "L" : "M"}${f(p[0])} ${f(p[1])}`).join(" "); }
const gear = (d: string, opacity = 1): Shape => ({ d, style: "gear", opacity });
const ball = (center: Point, radius = 4, opacity = 1): Ball => ({ center, radius, opacity });
const bar = (p: Point): Shape => gear(`M${f(p[0] - 13)} ${f(p[1])} h26 M${f(p[0] - 10)} ${f(p[1] - 4)} v8 M${f(p[0] + 10)} ${f(p[1] - 4)} v8`);
const bench = gear("M18 72 H66 M24 72 V88 M60 72 V88");
const box = gear("M62 88 V68 H88 V88 M62 73 H88");
const pullBar = gear("M24 11 H76 M28 11 V18 M72 11 V18");
const handBar = (_t: number, s: Skeleton) => ({ shapes: [bar(s.arms[1][2])] });

/** Each timeline explicitly includes its return/reset, with authored timing. */
function timeline(keys: readonly (readonly [number, Pose])[]): (t: number) => Pose {
  return (t) => {
    const index = keys.findIndex(([time]) => time > t);
    const [ta, a] = required(keys, Math.max(0, index < 0 ? keys.length - 2 : index - 1));
    const [tb, b] = required(keys, index < 0 ? keys.length - 1 : Math.max(1, index));
    const raw = Math.max(0, Math.min(1, (t - ta) / (tb - ta)));
    const u = raw * raw * (3 - 2 * raw);
    return {
      hip: between(a.hip, b.hip, u), lean: mix(a.lean, b.lean, u),
      feet: [between(a.feet[0], b.feet[0], u), between(a.feet[1], b.feet[1], u)],
      hands: [between(a.hands[0], b.hands[0], u), between(a.hands[1], b.hands[1], u)],
      knees: required(keys, 0)[1].knees, elbows: required(keys, 0)[1].elbows,
      headLean: mix(a.headLean, b.headLean, u), spine: mix(a.spine, b.spine, u), legProjection: mix(a.legProjection, b.legProjection, u),
    };
  };
}
function rep(dur: number, a: Pose, b: Pose, equipment?: Motion["equipment"]): Motion {
  return { dur, at: timeline([[0, a], [0.12, a], [0.48, b], [0.6, b], [0.94, a], [1, a]]), ...(equipment ? { equipment } : {}) };
}
const standHip: Point = [47, 55];
const standing = (hand: Point = [58, 52]) => pose(standHip, 0, [54, 88], hand, { farFoot: [39, 88], farHand: [34, 52], elbows: [-1, 1] });
const squatTop = pose(standHip, 0, [53, 88], [53, 31], { farFoot: [41, 88] });
const squatLow = pose([39, 72], 22, [53, 88], [53, 48], { farFoot: [41, 88] });
const frontTop = pose(standHip, 0, [53, 88], [53, 28], { farFoot: [41, 88], elbows: [1, 1] });
const frontLow = pose([40, 72], 12, [53, 88], [50, 46], { farFoot: [41, 88], elbows: [1, 1] });
const overhead = pose(standHip, 0, [53, 88], [53, 10], { farFoot: [41, 88], farHand: [41, 10], elbows: [1, 1] });
const hingeLow = pose([37, 65], 57, [51, 88], arms([37, 65], 57, 88), { farFoot: [43, 88], farHand: arms([37, 65], 57, 92), headLean: 45 });
const hingeTop = pose(standHip, 0, [53, 88], arms(standHip, 0, 88), { farFoot: [41, 88], farHand: arms(standHip, 0, 92) });
// Straight body pivots about the toes. Derive the hip and shoulder from
// that line so the knees cannot sag during a push-up or plank.
function floorHold(angle: number, hand: Point, elbows: Pair<Bend> = [-1, -1]): Pose {
  const toe: Point = [86, 88];
  const hip = add(toe, vector(angle, LEG * 2));
  return pose(hip, angle + 90, toe, hand, { farFoot: toe, farHand: hand, knees: [-1, -1], elbows, headLean: -70 });
}
const plankTop = floorHold(-155.2, [34, 88]);
const pushLow = floorHold(-174, [34, 88]);
function straightArms(p: Pose): Pose { return { ...p, hands: [arms(p.hip, p.lean, 92), arms(p.hip, p.lean, 88)] }; }
function scalar(t: number, keys: readonly (readonly [number, number])[]) {
  const index = keys.findIndex(([time]) => time > t);
  const [a, x] = required(keys, Math.max(0, index < 0 ? keys.length - 2 : index - 1));
  const [b, y] = required(keys, index < 0 ? keys.length - 1 : Math.max(1, index));
  const u = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return mix(x, y, u * u * (3 - 2 * u));
}
const halfKneel = (x = 47, lean = 0) => pose([x, 88 - Math.sqrt(LEG * LEG - (x - 47) ** 2)], lean, [64, 88], [62, 60], { farFoot: [30, 88], farHand: [58, 60], knees: [-1, -1] });

function kneelingRep(dur: number, a: Pose, b: Pose): Motion {
  const motion = rep(dur, a, b);
  return { ...motion, at: t => {
    const p = motion.at(t);
    return { ...p, hip: [p.hip[0], 88 - Math.sqrt(LEG * LEG - (p.hip[0] - 47) ** 2)] };
  } };
}

function gait(t: number, kind: "run" | "march" | "carry" | "drag" | "high") {
  const high = kind === "high";
  const running = kind === "run" || high;
  const hip: Point = [48, (running ? 58 : 58) - (running ? 0.7 : 0.4) * Math.sin(TAU * t * 2) ** 2];
  const lean = kind === "drag" ? 18 : high ? 0 : running ? 8 : 3;
  const foot = (phase: number, offset: number): Point => {
    const u = phase % 1;
    if (u < 0.6) return [mix(59, 37, u / 0.6) + offset, 88];
    const swing = (u - 0.6) / 0.4;
    return [mix(37, 59, swing) + offset, 88 - (high ? 29 : running ? 22 : 10) * Math.sin(Math.PI * swing)];
  };
  const shoulder = shoulderAt(hip, lean);
  const hand = (phase: number): Point => {
    const swing = Math.sin(TAU * phase);
    return reach(shoulder, 85 + swing * 35, running ? -10 + swing * 30 : 70 + swing * 25);
  };
  return pose(hip, lean, foot(t, 2), kind === "carry" ? arms(hip, lean, 77) : kind === "drag" ? [41, 54] : hand(t), {
    farFoot: foot(t + 0.5, -2), farHand: kind === "carry" ? arms(hip, lean, 109) : kind === "drag" ? [38, 52] : hand(t + 0.5),
    elbows: [-1, -1],
  });
}
function carryGear(_t: number, s: Skeleton) { return { shapes: s.arms.map(a => {
  const [x, y] = a[2];
  return gear(`M${f(x - 3)} ${f(y + 2)} h6 v7 h-6 Z M${f(x)} ${f(y)} v2`);
}) }; }

export const CARRY_PHASES = ["SPRINT", "DRAG", "LATERAL", "CARRY", "SPRINT"] as const;
function shuttlePose(t: number, stage: number): Pose {
  const cycle = (t * 8) % 1;
  if (stage !== 2) return gait(cycle, stage === 1 ? "drag" : stage === 3 ? "carry" : "run");
  const x = 48 + 5 * Math.sin(TAU * cycle);
  return pose([x, 60], 0, [x + 14, 88], [x + 12, 50], {
    farFoot: [x - 14, 88], farHand: [x - 12, 50], elbows: [-1, -1],
  });
}
function shuttleStage(t: number) {
  const position = (t * 5) % 5;
  const stage = Math.floor(position), u = Math.min(1, (position - stage) / 0.15);
  return { stage, previous: (stage + 4) % 5, blend: u * u * (3 - 2 * u) };
}

const sitLow = pose([47, 85], -86, [71, 88], [29, 77], { farFoot: [67, 88], knees: [-1, -1], headLean: -75 });
const sitHigh = pose([47, 85], 0, [71, 88], [66, 71], { farFoot: [67, 88], knees: [-1, -1], headLean: 0 });
const hangLow = pose([49, 58], 0, [52, 88], [60, 14], { farFoot: [45, 88], farHand: [38, 14], elbows: [-1, 1] });
const pullHigh = pose([49, 40], 0, [56, 68], [60, 14], { farFoot: [50, 68], farHand: [38, 14], elbows: [-1, 1] });
const lungeLow = pose([48, 72], 0, [72, 88], [59, 66], { farFoot: [24, 88], farHand: [35, 66], knees: [1, -1], elbows: [-1, 1] });
const lungeSplit = pose([48, 58], 0, [62, 88], [59, 54], { farFoot: [34, 88], farHand: [35, 54], knees: [1, -1], elbows: [-1, 1] });
const burpeeStand = { ...standing(), elbows: [-1, -1] as const };
const burpeeCrouch = pose([47, 73], -70, [58, 88], [28, 88], { farFoot: [52, 88], farHand: [24, 88], knees: [-1, -1], elbows: [-1, -1] });
const burpeeJump = pose([47, 45], 0, [52, 77], [53, 2], { farFoot: [42, 77], farHand: [41, 2], elbows: [-1, 1] });

export const MOTIONS = {
  rest: rep(4, standing([58, 52]), pose(standHip, 0, [54, 88], [58, 51.5], { farFoot: [39, 88], farHand: [34, 51.5], elbows: [-1, 1] })),
  squat: rep(3, squatTop, squatLow, handBar),
  frontSquat: rep(3, frontTop, frontLow, handBar),
  airSquat: rep(3, standing(), pose([39, 72], 15, [53, 88], [65, 48], { farFoot: [41, 88], farHand: [61, 46], elbows: [-1, -1] })),
  hinge: { ...rep(3.2, hingeTop, hingeLow, handBar), at: (t: number) => straightArms(rep(3.2, hingeTop, hingeLow).at(t)) },
  powerClean: {
    dur: 3.8,
    at: (t: number) => { const p = timeline([[0, hingeLow], [0.14, hingeLow], [0.35, hingeTop], [0.44, pose([47, 53], 0, [53, 86], [55, 40], { farFoot: [41, 86], elbows: [-1, -1] })], [0.54, pose([43, 64], 8, [53, 88], [57, 42], { farFoot: [41, 88], elbows: [-1, -1] })], [0.66, frontTop], [0.77, frontTop], [0.82, pose(standHip, 0, [53, 88], [63, 45], { farFoot: [41, 88], farHand: [60, 44] })], [0.88, hingeTop], [1, hingeLow]])(t); return t <= 0.35 || t >= 0.88 ? straightArms(p) : p; }, equipment: handBar,
  },
  swing: {
    dur: 1.9,
    at: (t: number) => {
      const u = (1 - Math.cos(TAU * t)) / 2;
      const hip = between([38, 65], standHip, u), lean = mix(50, 0, u);
      const hand = arms(hip, lean, mix(112, 0, u));
      return pose(hip, lean, [54, 88], hand, { farFoot: [40, 88], farHand: hand, elbows: [-1, -1] });
    },
    equipment: (_t: number, s: Skeleton) => ({ balls: [ball(add(s.arms[1][2], [1, 4]), 4)], shapes: [gear(path([s.arms[1][2], add(s.arms[1][2], [1, 4])]))] }),
  },
  press: rep(2.8, frontTop, overhead, handBar),
  thruster: { dur: 3.2, at: timeline([[0, frontTop], [0.3, frontLow], [0.4, frontLow], [0.59, frontTop], [0.76, overhead], [0.84, overhead], [1, frontTop]]), equipment: handBar },
  wallBall: {
    dur: 3,
    at: timeline([[0, frontTop], [0.28, frontLow], [0.4, frontLow], [0.62, overhead], [0.78, overhead], [1, frontTop]]),
    equipment: (t: number, s: Skeleton) => {
      const hand = s.arms[1][2];
      const u = Math.max(0, Math.min(1, (t - 0.62) / 0.25));
      const center: Point = t < 0.62 || t > 0.87 ? hand : [hand[0] + 26 * Math.sin(Math.PI * u), Math.max(5, hand[1] - 10 * Math.sin(Math.PI * u))];
      return { shapes: [gear("M84 4 V43 M80 10 H88")], balls: [ball(center, 4)] };
    },
  },
  bench: rep(3, pose([57, 68], -90, [72, 88], [36, 44.2], { farFoot: [67, 88], farHand: [32, 44.2], elbows: [-1, -1], headLean: -90 }), pose([57, 68], -90, [72, 88], [43, 62], { farFoot: [67, 88], farHand: [39, 62], elbows: [-1, -1], headLean: -90 }), (t: number, s: Skeleton) => ({ shapes: [bench, ...handBar(t, s).shapes] })),
  row: rep(2.8, pose([38, 61], 57, [51, 88], [60, 72], { farFoot: [43, 88], elbows: [1, 1], headLean: 45 }), pose([38, 61], 57, [51, 88], [48, 59], { farFoot: [43, 88], elbows: [1, 1], headLean: 45 }), handBar),
  pullup: rep(3, hangLow, pullHigh, () => ({ shapes: [pullBar] })),
  hang: {
    dur: 3,
    at: (t: number) => {
      const u = (1 - Math.cos(TAU * t)) / 2, angle = mix(85, -4, u);
      return { ...hangLow, feet: [reach(hangLow.hip, angle + 8, angle + 8, LEG), reach(hangLow.hip, angle, angle, LEG)] };
    }, equipment: () => ({ shapes: [pullBar] }),
  },
  pushup: { dur: 2.7, at: (t: number) => floorHold(scalar(t, [[0, -155.2], [0.12, -155.2], [0.48, -174], [0.6, -174], [0.94, -155.2], [1, -155.2]]), [34, 88]) },
  dip: rep(2.8, pose([48, 51], 4, [57, 79], [54, 50], { farFoot: [51, 79], farHand: [44, 50], elbows: [-1, 1] }), pose([48, 64], 10, [57, 88], [54, 50], { farFoot: [51, 88], farHand: [44, 50], elbows: [-1, 1] }), () => ({ shapes: [gear("M27 50 H70 M31 50 V88 M66 50 V88")] })),
  benchDip: rep(2.8, pose([47, 64], -4, [70, 88], [37, 62], { farFoot: [67, 88], farHand: [34, 62], elbows: [1, 1] }), pose([47, 77], -4, [70, 88], [37, 62], { farFoot: [67, 88], farHand: [34, 62], elbows: [1, 1] }), () => ({ shapes: [gear("M14 62 H38 M18 62 V88 M34 62 V88")] })),
  situp: rep(3, sitLow, sitHigh),
  backLift: rep(3.2, pose([54, 85], -88, [87, 86], [9, 85], { farFoot: [86, 88], farHand: [12, 88], knees: [1, 1], headLean: -75 }), pose([54, 85], -67, [85, 73], [13, 65], { farFoot: [86, 77], farHand: [12, 69], knees: [1, 1], headLean: -65 })),
  flutter: {
    dur: 1.2,
    at: (t: number) => {
      const hip: Point = [46, 80], a = -14 + 13 * Math.sin(TAU * t), b = -14 - 13 * Math.sin(TAU * t);
      return pose(hip, -83, reach(hip, a, a, LEG), [29, 84], { farFoot: reach(hip, b, b, LEG), farHand: [25, 85], knees: [-1, -1], headLean: -65 });
    },
  },
  plank: { dur: 4, at: () => floorHold(-168, [42, 88], [1, 1]) },
  reverseLunge: { dur: 3.2, at: timeline([[0, standing()], [0.22, lungeSplit], [0.5, lungeLow], [0.62, lungeLow], [0.82, lungeSplit], [1, standing()]]) },
  kneeLift: rep(2.8, standing(), pose(standHip, 0, [64, 67], [58, 49], { farFoot: [40, 88], farHand: [34, 52], elbows: [-1, 1] })),
  armCircles: { dur: 3.5, at: (t: number) => {
    const hip: Point = [48, 56], shoulder = shoulderAt(hip, 0), angle = 360 * t;
    return pose(hip, 0, [55, 88], reach(shoulder, angle), { farFoot: [40, 88], farHand: reach(shoulder, angle + 180), elbows: [-1, 1] });
  } },
  lunge: rep(3.2, lungeSplit, lungeLow),
  jump: {
    dur: 4.2,
    at: (t: number) => { const p = timeline([
      [0, pose([38, 57], 0, [43, 88], [48, 52])],
      [0.14, pose([31, 72], 25, [43, 88], [28, 59], { farHand: [25, 57] })],
      [0.31, pose([51, 40], 8, [62, 63], [61, 13], { farHand: [58, 14] })],
      [0.44, pose([70, 48], 12, [77, 68], [87, 37])],
      [0.57, pose([71, 36], 0, [77, 68], [82, 31])],
      [0.65, pose([71, 36], 0, [77, 68], [82, 31])],
      [0.71, pose([63, 40], 0, [60, 64], [73, 36], { farFoot: [74, 68] })],
      [0.77, pose([57, 48], 0, [50, 73], [67, 43], { farFoot: [74, 68] })],
      [0.83, pose([48, 57], 0, [47, 88], [60, 52], { farFoot: [74, 68] })],
      [0.86, pose([46, 58], 0, [43, 88], [58, 53], { farFoot: [60, 66] })],
      [0.89, pose([44, 60], 0, [43, 88], [56, 55], { farFoot: [58, 78] })],
      [1, pose([38, 57], 0, [43, 88], [48, 52])],
    ])(t);
      const angle = scalar(t, [[0, 70], [0.14, 135], [0.31, -15], [0.44, 30], [0.57, 75], [0.65, 75], [0.77, 50], [0.89, 75], [1, 70]]);
      return { ...p, hands: [arms(p.hip, p.lean, angle + 10, angle - 25), arms(p.hip, p.lean, angle, angle - 35)] };
    }, equipment: () => ({ shapes: [box] }),
  },
  boxStepUp: rep(3.6, pose([47, 60], 12, [69, 68], [60, 51], { farFoot: [40, 88] }), pose([66, 36], 0, [69, 68], [78, 31], { farFoot: [59, 66] }), () => ({ shapes: [box] })),
  powerThrow: {
    dur: 3.6,
    at: timeline([[0, hingeLow], [0.18, hingeLow], [0.28, pose(standHip, 0, [54, 88], [70, 32], { farFoot: [40, 88], farHand: [70, 32] })], [0.34, pose(standHip, -8, [54, 88], [56, 12], { farFoot: [40, 88], farHand: [56, 12] })], [0.4, pose([47, 55], -12, [54, 88], [33, 11], { farFoot: [40, 88], farHand: [33, 11], elbows: [1, 1] })], [0.54, pose([47, 55], -12, [54, 88], [33, 11], { farFoot: [40, 88], farHand: [33, 11], elbows: [1, 1] })], [0.8, hingeLow], [1, hingeLow]]),
    equipment: (t: number, s: Skeleton) => {
      const u = Math.min(1, Math.max(0, (t - 0.4) / 0.32));
      const flying: Point = [33 - 27 * u, 11 - 20 * u + 86 * u * u];
      const opacity = t < 0.4 ? 1 : t < 0.68 ? 1 : t < 0.75 ? (0.75 - t) / 0.07 : t < 0.86 ? 0 : (t - 0.86) / 0.14;
      return { balls: [ball(t < 0.4 || t >= 0.75 ? s.arms[1][2] : flying, 4, opacity)] };
    },
  },
  sprintDragCarry: {
    dur: 10,
    at: (t: number) => {
      const { stage, previous, blend } = shuttleStage(t);
      const a = shuttlePose(t, previous), b = shuttlePose(t, stage);
      const p = timeline([[0, a], [1, b]])(blend);
      const hand = (side: 0 | 1) => {
        const from = shoulderAt(a.hip, a.lean), to = shoulderAt(b.hip, b.lean);
        const angleA = Math.atan2(a.hands[side][1] - from[1], a.hands[side][0] - from[0]);
        const angleB = Math.atan2(b.hands[side][1] - to[1], b.hands[side][0] - to[0]);
        const turn = Math.atan2(Math.sin(angleB - angleA), Math.cos(angleB - angleA));
        return add(shoulderAt(p.hip, p.lean), vector((angleA + turn * blend) * 180 / Math.PI, mix(distance(from, a.hands[side]), distance(to, b.hands[side]), blend)));
      };
      return { ...p, hands: [hand(0), hand(1)] };
    },
    equipment: (t: number, s: Skeleton) => {
      const { stage, previous, blend } = shuttleStage(t);
      const visibility = (index: number) => mix(previous === index ? 1 : 0, stage === index ? 1 : 0, blend);
      return { shapes: [
        gear("M5 87 H22 L25 81 H8 Z M12 81 V76 H21 V81", visibility(1)),
        gear(path([[23, 81], s.arms[1][2]]), visibility(1)),
        ...carryGear(t, s).shapes.map(shape => ({ ...shape, opacity: visibility(3) })),
      ] };
    },
  },
  burpee: { dur: 5.2, at: (t: number) => { if (t >= 0.27 && t <= 0.49) return floorHold(scalar(t, [[0.27, -155.2], [0.39, -174], [0.49, -155.2]]), [34, 88]); return timeline([[0, burpeeStand], [0.065, pose([47, 64], -35, [58, 88], [42, 63], { farFoot: [52, 88], farHand: [39, 63], elbows: [-1, -1] })], [0.13, burpeeCrouch], [0.27, plankTop], [0.39, pushLow], [0.49, plankTop], [0.64, burpeeCrouch], [0.7, pose([47, 64], -35, [58, 88], [42, 63], { farFoot: [52, 88], farHand: [39, 63], elbows: [-1, -1] })], [0.78, burpeeStand], [0.825, pose([47, 50], 0, [52, 82], [68, 29], { farFoot: [42, 82], farHand: [26, 29], elbows: [-1, -1] })], [0.87, burpeeJump], [0.915, pose([47, 50], 0, [52, 82], [68, 29], { farFoot: [42, 82], farHand: [26, 29], elbows: [-1, -1] })], [0.95, burpeeStand], [1, burpeeStand]])(t); } },
  run: { dur: 0.9, at: (t: number) => gait(t, "run") },
  runInPlace: { dur: 1, at: (t: number) => gait(t, "high") },
  boxing: { dur: 1.8, at: (t: number) => {
    const jab = Math.max(0, Math.sin(TAU * t)), cross = Math.max(0, -Math.sin(TAU * t));
    const hip: Point = [47 + cross * 2, 59.5], shoulder = shoulderAt(hip, 6 + cross * 5);
    return pose(hip, 6 + cross * 5, [64, 88], between(add(shoulder, [9, -3]), add(shoulder, [23, -3]), jab), { farFoot: [31, 88], farHand: between(add(shoulder, [5, -8]), add(shoulder, [23, -6]), cross), elbows: [-1, -1] });
  } },
  ruck: { dur: 1.7, at: (t: number) => gait(t, "march"), equipment: (_t: number, s: Skeleton) => ({ shapes: [gear(path([add(s.shoulder, [-5, 3]), add(s.shoulder, [-13, 4]), add(s.shoulder, [-13, 20]), add(s.shoulder, [-5, 20]), add(s.shoulder, [-5, 3])]))] }) },
  carry: { dur: 1.8, at: (t: number) => gait(t, "carry"), equipment: carryGear },
  rowErg: {
    dur: 3.2,
    at: timeline([
      [0, pose([49, 77], 27, [72, 85], [77, 66], { farFoot: [68, 85], elbows: [1, 1] })],
      [0.28, pose([40, 77], 27, [72, 85], [68, 66], { farFoot: [68, 85], elbows: [1, 1] })],
      [0.4, pose([40, 77], -18, [72, 85], [55, 63], { farFoot: [68, 85], elbows: [1, 1] })],
      [0.5, pose([40, 77], -18, [72, 85], [43, 66], { farFoot: [68, 85], elbows: [1, 1] })],
      [0.62, pose([40, 77], -18, [72, 85], [55, 63], { farFoot: [68, 85], elbows: [1, 1] })],
      [0.76, pose([40, 77], 27, [72, 85], [68, 66], { farFoot: [68, 85], elbows: [1, 1] })],
      [1, pose([49, 77], 27, [72, 85], [77, 66], { farFoot: [68, 85], elbows: [1, 1] })],
    ]), equipment: (_t: number, s: Skeleton) => ({ shapes: [gear("M23 88 H87 M70 86 L76 77"), gear(`M${f(s.hip[0] - 5)} 81 h10`), gear(path([s.arms[1][2], [86, 78]]))], balls: [ball([86, 78], 7)] }),
  },
  ankleRock: kneelingRep(3.5, halfKneel(), halfKneel(52, 5)),
  catCow: rep(4.8, pose([64, 71], -72.4, [81, 88], [42, 88], { farFoot: [77, 88], farHand: [42, 88], knees: [1, 1], elbows: [-1, -1], headLean: -55, spine: 8 }), pose([64, 71], -72.4, [81, 88], [42, 88], { farFoot: [77, 88], farHand: [42, 88], knees: [1, 1], elbows: [-1, -1], headLean: -135, spine: -9 })),
  hip90Switch: { dur: 4, at: (t: number) => {
    const u = (1 - Math.cos(TAU * t)) / 2;
    const hip: Point = [50, 82];
    // Seated legs rotate in the floor plane. Foreshorten depth, rather than
    // pretending that a frontal 90/90 rotation happens in a vertical plane.
    return pose(hip, 0, reach(hip, mix(-20, -160, u), mix(70, -70, u), LEG), [65, 76], { farFoot: reach(hip, mix(-160, -20, u), mix(-250, -110, u), LEG), farHand: [35, 76], knees: [1, -1], elbows: [-1, 1], legProjection: 0.35 });
  } },
  worldsGreatestStretch: {
    dur: 4.8,
    at: (t: number) => {
      const u = (1 - Math.cos(TAU * t)) / 2, hip: Point = [45, 71], shoulder = shoulderAt(hip, 70);
      return pose(hip, 70, [62, 88], reach(shoulder, mix(90, -90, u)), { farFoot: [28, 88], farHand: [66, 87], knees: [-1, -1], elbows: [-1, -1], headLean: mix(65, 0, u) });
    },
  },
  hipFlexorStretch: kneelingRep(5, { ...halfKneel(46), hands: [[42, 26], [53, 26]], elbows: [-1, 1] }, { ...halfKneel(50, -3), hands: [[43, 26], [54, 26]], elbows: [-1, 1] }),
  openBook: { dur: 4.8, at: (t: number) => {
    const u = (1 - Math.cos(TAU * t)) / 2, hip: Point = [57, 80], shoulder = shoulderAt(hip, -90);
    return pose(hip, -90, [74, 86], reach(shoulder, mix(12, -150, u)), { farFoot: [67, 88], farHand: [12, 85], knees: [-1, -1], elbows: [-1, -1], headLean: mix(-75, -110, u) });
  } },
  downDogCobra: { dur: 5.2, at: (t: number) => {
    const u = (1 - Math.cos(TAU * t)) / 2;
    const toe: Point = [85, 88], hand: Point = [33, 88];
    const hip = add(toe, vector(mix(-118.072, -174.938, u), 34));
    // Shoulder is the intersection of the fixed torso and extended arms.
    // Hands and toes stay planted while the hips describe a leg-length arc.
    const d = distance(hip, hand), along = (TORSO * TORSO - 24 * 24 + d * d) / (2 * d);
    const axis: Point = [(hand[0] - hip[0]) / d, (hand[1] - hip[1]) / d];
    const height = Math.sqrt(Math.max(0, TORSO * TORSO - along * along));
    const shoulder = add(hip, [axis[0] * along - axis[1] * height, axis[1] * along + axis[0] * height]);
    const lean = Math.atan2(shoulder[1] - hip[1], shoulder[0] - hip[0]) * 180 / Math.PI + 90;
    return pose(hip, lean, toe, hand, { farFoot: toe, farHand: hand, headLean: mix(-125, -15, u) });
  } },
  bike: { dur: 1.5, at: (t: number) => {
    const hip: Point = [43, 60], crank: Point = [54, 79];
    return pose(hip, 18, add(crank, vector(t * 360, 9)), [71 + 2 * Math.sin(TAU * t), 40], { farFoot: add(crank, vector(t * 360 + 180, 9)), farHand: [70 - 3 * Math.sin(TAU * t), 42], elbows: [-1, -1] });
  }, equipment: (_t: number, s: Skeleton) => ({ shapes: [gear("M29 88 H90 M39 63 H48 M43 63 V83 L54 79 L82 74 M54 79 L43 63 M82 74 L72 52"), ...s.legs.map(l => gear(path([[54, 79], required(l, 2)]))), ...s.arms.map(a => gear(path([[82, 74], a[2]])))], balls: [ball([82, 74], 10), ball([54, 79], 3)] }) },
} satisfies Record<string, Motion>;

export type AnimKey = keyof typeof MOTIONS;
export function sampleScene(key: AnimKey, t: number): Scene {
  const motion: Motion = MOTIONS[key];
  const p = motion.at(Math.max(0, Math.min(1, t)));
  const s = skeleton(p);
  const equipment = motion.equipment?.(t, s);
  const middle = between(s.hip, s.shoulder, 0.5);
  const torso = `M${f(s.hip[0])} ${f(s.hip[1])} Q${f(middle[0])} ${f(middle[1] + p.spine)} ${f(s.shoulder[0])} ${f(s.shoulder[1])}`;
  return { pose: p, shapes: [
    { d: path(required(s.legs, 0)), style: "far" }, { d: path(s.arms[0]), style: "far" },
    { d: torso, style: "body" },
    { d: path(required(s.legs, 1)), style: "body" }, { d: path(s.arms[1]), style: "body" },
    { d: path([s.shoulder, between(s.shoulder, s.head, 0.6)]), style: "body" },
    ...(equipment?.shapes ?? []),
  ], balls: [ball(s.head, 4.4), ...(equipment?.balls ?? [])] };
}

/** Dense solved samples keep native interpolation below a pixel at player size. */
export function bakeMotion(key: AnimKey) {
  const count = Math.max(120, Math.ceil(MOTIONS[key].dur * 60));
  return Array.from({ length: count + 1 }, (_, i) => sampleScene(key, i / count));
}
