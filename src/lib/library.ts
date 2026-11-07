/**
 * Exercise library content: which animation demonstrates each built-in
 * exercise, plus concise form cues. Custom exercises fall back to an
 * archetype for their category.
 */
import type { AnimKey } from "../components/ExerciseAnim";
import type { Category, Exercise } from "../types";
import { EX } from "./seed";

interface LibraryEntry {
  anim: AnimKey;
  cues: string[];
  /**
   * For one-sided poses: which side the animation as drawn demonstrates.
   * The player mirrors it for the other side. Front-facing figures show the
   * athlete's left leg on screen-right, so this is declared, never guessed.
   */
  side?: "left" | "right";
}

const LIB: Record<string, LibraryEntry> = {
  [EX.backSquat]: {
    anim: "squat",
    cues: [
      "Bar on upper traps, brace hard before descending.",
      "Sit down between the hips, knees tracking over toes.",
      "Hit at least parallel, drive up through mid-foot.",
    ],
  },
  [EX.frontSquat]: {
    anim: "frontSquat",
    cues: [
      "Bar racked on front delts, elbows high.",
      "Torso as upright as possible all the way down.",
      "Lead the ascent with the elbows, not the hips.",
    ],
  },
  [EX.deadlift]: {
    anim: "hinge",
    cues: [
      "Bar over mid-foot, shins touching, back flat.",
      "Wedge in: chest up, lats tight, slack out of the bar.",
      "Push the floor away; lock out hips and knees together.",
    ],
  },
  [EX.benchPress]: {
    anim: "bench",
    cues: [
      "Shoulder blades pinched, feet planted.",
      "Bar to lower chest with elbows ~45°.",
      "Press back up toward the eyes; full lockout.",
    ],
  },
  [EX.overheadPress]: {
    anim: "press",
    cues: [
      "Squeeze glutes, ribs down — no leaning back.",
      "Press slightly around the face, then straight up.",
      "Finish with biceps by the ears, bar over mid-foot.",
    ],
  },
  [EX.barbellRow]: {
    anim: "row",
    cues: [
      "Hinge to ~45°, flat back, bar under the shoulders.",
      "Pull to the lower ribs, elbows tight.",
      "Lower under control — no torso heave.",
    ],
  },
  [EX.powerClean]: {
    anim: "powerClean",
    cues: [
      "Set up like a deadlift, shoulders over the bar.",
      "Explode with the hips, shrug, pull under.",
      "Catch on the front delts with elbows through.",
    ],
  },
  [EX.thruster]: {
    anim: "thruster",
    cues: [
      "Front squat to full depth.",
      "Drive out of the hole and press in one motion.",
      "Exhale at lockout, breathe on the way down.",
    ],
  },
  [EX.kettlebellSwing]: {
    anim: "swing",
    cues: [
      "Hinge, don't squat — bell high between the thighs.",
      "Snap the hips; arms are just ropes.",
      "Chest-height float, then let it fall into the next rep.",
    ],
  },
  [EX.wallBall]: {
    anim: "wallBall",
    cues: [
      "Full squat holding the ball at the chest.",
      "Drive up and throw to the target in one rhythm.",
      "Absorb the catch straight into the next squat.",
    ],
  },
  // Two ids, one movement: ex-farmer-carry is the deprecated weight_reps
  // version. It stays here because devices that seeded before the fix
  // still hold it, and a missing entry would demonstrate a burpee.
  [EX.farmerCarry]: {
    anim: "carry",
    cues: [
      "Deadlift the handles up — never round over.",
      "Tall posture, ribs stacked, crush grip.",
      "Short fast steps; stop before your grip fails.",
    ],
  },
  [EX.farmerCarryDistance]: {
    anim: "carry",
    cues: [
      "Deadlift the handles up — never round over.",
      "Tall posture, ribs stacked, crush grip.",
      "Log the distance you covered before the grip went.",
    ],
  },
  [EX.airSquat]: {
    anim: "airSquat",
    cues: [
      "Feet shoulder width, weight through the whole foot.",
      "Hips back and down past parallel, chest tall.",
      "Arms out front for balance; stand fully at the top.",
    ],
  },
  [EX.pullUp]: {
    anim: "pullup",
    cues: [
      "Dead hang, overhand grip just outside shoulders.",
      "Pull the elbows to the ribs, chin over the bar.",
      "Full extension at the bottom of every rep.",
    ],
  },
  [EX.chinUp]: {
    anim: "pullup",
    cues: [
      "Underhand grip, shoulder width.",
      "Chest to the bar, squeeze biceps and lats.",
      "Control the negative — no dropping.",
    ],
  },
  [EX.pushUp]: {
    anim: "pushup",
    cues: [
      "Rigid plank from head to heels.",
      "Chest to the deck, elbows ~45° from the body.",
      "Lock out fully — every rep, same rep.",
    ],
  },
  [EX.dip]: {
    anim: "dip",
    cues: [
      "Support hold, shoulders down and back.",
      "Lower until upper arms hit parallel.",
      "Press to lockout without swinging.",
    ],
  },
  [EX.benchDip]: {
    anim: "benchDip",
    cues: [
      "Hands on the bench edge behind you, fingers forward.",
      "Elbows straight back, lower until upper arms are parallel.",
      "Press up through the heels of the hands — shoulders down, not shrugged.",
    ],
  },
  [EX.sitUp]: {
    anim: "situp",
    cues: [
      "Knees bent, feet anchored or free.",
      "Curl the trunk — chest to knees.",
      "Lower with control; no neck pulling.",
    ],
  },
  [EX.backLift]: {
    anim: "backLift",
    cues: [
      "Face down, arms reaching forward, forehead near the deck.",
      "Lift chest, arms and legs together — squeeze the glutes.",
      "Look at the floor, never crank the neck back. Lower slow.",
    ],
  },
  [EX.flutterKick]: {
    anim: "flutter",
    cues: [
      "Lower back pressed into the deck.",
      "Legs straight, heels 15 cm off the ground.",
      "Small fast alternating kicks; keep breathing.",
    ],
  },
  [EX.hangingLegRaise]: {
    anim: "hang",
    cues: [
      "Dead hang, shoulders packed.",
      "Raise straight legs to at least parallel.",
      "No swing — control down, control up.",
    ],
  },
  [EX.lunge]: {
    anim: "lunge",
    cues: [
      "Long step, torso tall.",
      "Back knee kisses the ground.",
      "Drive through the front heel into the next step.",
    ],
  },
  [EX.reverseLunge]: {
    anim: "reverseLunge",
    cues: [
      "Step straight back, torso tall — no forward lean.",
      "Back knee toward the ground, front shin vertical.",
      "Push off the back foot to stand; alternate legs.",
    ],
  },
  [EX.kneeLift]: {
    anim: "kneeLift",
    cues: [
      "Stand tall, weight through the whole standing foot.",
      "Drive one knee above hip height, slow and controlled.",
      "Lower under control — no swinging, no leaning back.",
    ],
  },
  [EX.armCircles]: {
    anim: "armCircles",
    cues: [
      "Arms straight out to the sides, shoulders down.",
      "Big slow circles — chest open, ribs stacked.",
      "Reverse direction halfway through.",
    ],
  },
  [EX.ankleRock]: {
    anim: "ankleRock",
    cues: [
      "Half-kneel, front foot flat and fully planted.",
      "Drive the front knee forward past the toes, heel glued down.",
      "Rock back to neutral and repeat — feel the stretch low in the calf.",
    ],
  },
  [EX.catCow]: {
    anim: "catCow",
    cues: [
      "Hands under shoulders, knees under hips.",
      "Cow: drop the belly, lift the chest and tailbone.",
      "Cat: round the spine to the ceiling, tuck the chin — flow between the two.",
    ],
  },
  [EX.hip90Switch]: {
    anim: "hip90Switch",
    cues: [
      "Seated, both knees bent to roughly 90°.",
      "Rotate through the hips to switch the front and back leg — chest stays tall.",
      "Keep it slow; stop short of any pinch, then switch sides.",
    ],
  },
  [EX.worldsGreatestStretch]: {
    anim: "worldsGreatestStretch",
    cues: [
      "Long lunge, back knee down, front foot flat.",
      "Drop the back hip low, then rotate the chest and reach the same-side arm to the ceiling.",
      "Follow the hand with your eyes; alternate sides each round.",
    ],
  },
  [EX.hipFlexorStretch]: {
    anim: "hipFlexorStretch",
    side: "right", // side view facing right; the near front foot is the right
    cues: [
      "Half-kneel, back knee under the hip, front foot flat ahead.",
      "Tuck the tailbone under and shift forward until the front of the back hip stretches.",
      "Reach both arms overhead for more — breathe, don't bounce.",
    ],
  },
  [EX.openBook]: {
    side: "right", // the near, opening arm is the right
    anim: "openBook",
    cues: [
      "Lie on your side, knees stacked and bent to 90°.",
      "Reach the top arm across the body, then open it to the far side, letting the gaze follow.",
      "Let the upper back rotate; keep the knees pinned together.",
    ],
  },
  [EX.downDogCobra]: {
    anim: "downDogCobra",
    cues: [
      "From all fours, lift the hips high into an inverted V — heels reaching for the floor.",
      "Flow forward and down into Cobra: hips to the deck, chest lifted, shoulders down.",
      "Press through the hands each way; keep the neck long, not cranked back.",
    ],
  },
  [EX.childsPose]: {
    anim: "childsPose",
    cues: [
      "Knees wide, big toes together, sit the hips back toward the heels.",
      "Walk the hands forward and rest the forehead down; let the back go long.",
      "Hips won't reach the heels? Put a folded jacket between them.",
    ],
  },
  [EX.downwardDog]: {
    anim: "downDog",
    cues: [
      "Hands shoulder-width, spread the fingers, push the floor away.",
      "Hips up and back into an inverted V — length in the spine first.",
      "Bend the knees as much as you need; heels drift toward the floor over time.",
    ],
  },
  [EX.upwardSalute]: {
    anim: "upwardSalute",
    cues: [
      "Stand tall, feet hip-width, weight even through both feet.",
      "Inhale and sweep the arms forward and up overhead; ribs stay down.",
      "Exhale and float them back down. Move with the breath.",
    ],
  },
  [EX.standingForwardFold]: {
    anim: "forwardFold",
    cues: [
      "Hinge from the hips, not the waist; let the head hang heavy.",
      "Knees soft or well bent — the point is a long back, not straight legs.",
      "Hands on shins, blocks or the floor, wherever they land.",
    ],
  },
  [EX.chairPose]: {
    anim: "chairPose",
    cues: [
      "Feet together, sit back as if onto a chair, knees behind the toes.",
      "Arms reach up in line with the torso; weight in the heels.",
      "Thighs burning is the pose. Lift the arms less if the shoulders pinch.",
    ],
  },
  [EX.warriorTwo]: {
    anim: "warriorTwo",
    side: "left", // front-facing; the bent front knee on screen-right is the left leg
    cues: [
      "Wide stance: front foot forward, back foot turned in slightly.",
      "Bend the front knee over the ankle; back leg straight and strong.",
      "Arms level at shoulder height, gaze over the front hand, torso upright.",
    ],
  },
  [EX.trianglePose]: {
    anim: "trianglePose",
    side: "left", // front-facing; reaching over the left leg, on screen-right
    cues: [
      "From a wide stance, both legs straight, reach forward over the front leg.",
      "Lower hand to the shin or a block — not the floor if it bends the spine.",
      "Top arm straight up, chest opens to the side; both sides of the waist long.",
    ],
  },
  [EX.treePose]: {
    anim: "treePose",
    side: "right", // front-facing; the lifted foot is the right one, on screen-left
    cues: [
      "Stand on one leg; place the other foot on the inner calf or thigh — never the knee.",
      "Press foot and leg into each other; hips level, tailbone down.",
      "Hands together at the chest or overhead. Toes on the floor is a fine tree.",
    ],
  },
  [EX.pigeonPose]: {
    anim: "pigeonPose",
    side: "right", // side view facing right; the near, folded front leg is the right
    cues: [
      "From all fours, bring one knee forward behind the wrist, shin across the mat.",
      "Slide the back leg straight behind you; square the hips toward the floor.",
      "Fold forward over the front leg. Knee complains? Pull the foot in closer to the hip.",
    ],
  },
  [EX.boatPose]: {
    anim: "boatPose",
    cues: [
      "Sit on the sit bones, lean back with a long, straight spine.",
      "Lift the legs — shins parallel to the floor first, straight legs when you can.",
      "Arms reach forward; breathe steadily, don't round the back to hold it.",
    ],
  },
  [EX.bridgePose]: {
    anim: "bridgePose",
    cues: [
      "On your back, knees bent, feet flat and hip-width near the hips.",
      "Press through the feet and lift the hips; knees point straight ahead.",
      "Arms long on the floor, shoulders tucked under. Lower slowly, vertebra by vertebra.",
    ],
  },
  [EX.seatedForwardFold]: {
    anim: "seatedForwardFold",
    cues: [
      "Sit tall with legs straight ahead, feet flexed.",
      "Hinge forward from the hips, leading with the chest, not the head.",
      "Hold the shins, ankles or feet. Bend the knees if the back rounds hard.",
    ],
  },
  [EX.savasana]: {
    anim: "savasana",
    cues: [
      "Lie on your back, legs relaxed apart, arms by your sides, palms up.",
      "Let the whole body go heavy; breathe normally.",
      "Stay still until the timer ends — this is where the session settles in.",
    ],
  },
  [EX.burpee]: {
    anim: "burpee",
    cues: [
      "Hands down, kick back to a plank.",
      "Chest to the deck.",
      "Snap the feet in, jump and clap overhead.",
    ],
  },
  [EX.boxJump]: {
    anim: "jump",
    cues: [
      "Load the hips, arms back.",
      "Explode up, land soft and quiet — full foot on the box.",
      "Stand tall on top; step down, don't rebound.",
    ],
  },
  [EX.boxStepUp]: {
    anim: "boxStepUp",
    cues: [
      "Whole foot on the box, knee tracking over the toes.",
      "Stand up through the top leg — no push off the back foot, no hop.",
      "Step down under control and alternate the lead leg.",
    ],
  },
  [EX.powerThrow]: {
    anim: "powerThrow",
    cues: [
      "Squat with the ball low, back flat, arms long.",
      "Explode hips and legs, throw back over the head.",
      "Score the best of two — log the distance in metres.",
    ],
  },
  [EX.sprintDragCarry]: {
    anim: "sprintDragCarry",
    cues: [
      "Five 50 m lengths: sprint, sled drag, lateral, carry, sprint.",
      "Stay low on the drag, hips down, short driving steps.",
      "Log the total time; the distance is always 250 m.",
    ],
  },
  [EX.plank]: {
    anim: "plank",
    cues: [
      "Elbows under shoulders, feet together.",
      "Squeeze glutes and quads — one straight line.",
      "Breathe shallow and steady; no sagging hips.",
    ],
  },
  [EX.run]: {
    anim: "run",
    cues: [
      "Tall posture, slight forward lean.",
      "Quick cadence (~180 steps/min), land under the hips.",
      "Relax shoulders and hands.",
    ],
  },
  [EX.runInPlace]: {
    anim: "runInPlace",
    cues: [
      "Knees to hip height, land on the balls of the feet.",
      "Quick light cadence — noise means you're stamping.",
      "Arms driving, shoulders loose, torso upright.",
    ],
  },
  [EX.airBoxing]: {
    anim: "boxing",
    cues: [
      "Hands up by the cheeks, chin tucked, elbows in.",
      "Punch straight from the guard and snap it back — alternate hands, don't wind up.",
      "Rotate hip and shoulder into every shot; keep the feet moving.",
    ],
  },
  [EX.ruck]: {
    anim: "ruck",
    cues: [
      "Pack high and tight against the back.",
      "Aggressive walking pace — stride out, don't jog it all.",
      "Care for the feet: socks, lacing, tape hot spots early.",
    ],
  },
  [EX.row]: {
    anim: "rowErg",
    cues: [
      "Sequence: legs → back → arms; reverse on the return.",
      "Drive with the legs, arms straight until the finish.",
      "Handle to lower ribs, controlled recovery.",
    ],
  },
  [EX.assaultBike]: {
    anim: "bike",
    cues: [
      "Push AND pull the handles; drive with the legs.",
      "Stay seated tall, core braced.",
      "Settle into a pace you can repeat — it lies to you early.",
    ],
  },
};

const CATEGORY_FALLBACK: Record<Category, LibraryEntry> = {
  strength: {
    anim: "hinge",
    cues: ["Brace before every rep.", "Full range of motion.", "Own the eccentric."],
  },
  bodyweight: {
    anim: "pushup",
    cues: ["Strict form before reps.", "Full lockout, full stretch.", "Quality over quantity."],
  },
  core: {
    anim: "plank",
    cues: ["Brace the trunk.", "Move slow, no momentum.", "Keep breathing."],
  },
  conditioning: {
    anim: "burpee",
    cues: ["Set a repeatable pace.", "Break before you fail.", "Fast transitions."],
  },
  cardio: {
    anim: "run",
    cues: ["Even pacing.", "Nasal breathing at easy pace.", "Finish strong."],
  },
  ruck: {
    anim: "ruck",
    cues: ["Load tight to the back.", "Stride out.", "Protect the feet."],
  },
};

export function libraryFor(ex: Exercise): LibraryEntry {
  return LIB[ex.id] ?? CATEGORY_FALLBACK[ex.category];
}

/**
 * Does this exercise have its own animation and cues, rather than the
 * category archetype? Built-ins must — a fallback demonstrates the wrong
 * movement. `bun run db:smoke` asserts full coverage.
 */
export function hasLibraryEntry(exerciseId: string): boolean {
  return exerciseId in LIB;
}
