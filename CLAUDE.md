# Working on Varg

Varg is a rugged, offline-first, military-style workout tracker. Tauri 2 ·
Bun · TypeScript · React 18, targeting Android. Storage is on-device SQLite
via `tauri-plugin-sql` with Drizzle on top (localStorage when run as a plain
web page).

Read [README.md](README.md) for what the app does. This file is about how to
change it.

---

## Core philosophy: programs are authored in code, by an agent

**Workout programs are not built by the user in the app. They are added by an
AI agent editing this repository, and shipped as a build.**

When the owner wants a new workout, the request arrives as prose — "20 sec
situps, cardio, pushups… 10 seconds of rest, 3 rounds" — and the agent turns
it into a `Template` in [`src/lib/seed.ts`](src/lib/seed.ts), adding whatever
exercises, animations and cues it needs along the way.

This is a deliberate choice, not a missing feature. It has consequences that
should shape what you build:

- **Do not propose or build in-app program authoring.** No template editors,
  no "create your own workout" screens, no program builders. This direction
  has been considered and rejected. The Hunt screen starts existing
  templates. There are no ad-hoc interval or empty-session builders, and no
  training splits (removed in migration `0001_drop_splits`; the owner never
  used them).
- **The prose request is the spec.** Match it exactly: station order, work
  and rest seconds, round count, and any alternation the owner describes. If
  the arithmetic in the request does not come out (a stated total that is ten
  seconds off, say), implement what was asked, then say so plainly — do not
  silently round the workout to make the numbers pretty.
- **Content quality is your responsibility, not a reviewer's.** Nobody is
  going to open a form and notice that Air Squat is demonstrating a push-up.
  If a new exercise needs an animation and cues, it gets an animation and
  cues in the same change.
- **Fail loudly, never silently.** A program that builds green and runs wrong
  on the phone is the worst outcome, because the only person who finds out is
  mid-workout with a barbell. Prefer a hard error at build or startup over a
  degraded runtime path. `startFromTemplate` refusing to launch a circuit
  whose stations do not all resolve is the pattern to follow.

### Adding a workout program

1. Add any missing exercises to `EX` and `seedExercises()` in
   [`src/lib/seed.ts`](src/lib/seed.ts). Ids are permanent — they are foreign
   keys in the user's database. Never rename or reuse one.
2. Add an animation to `MOTIONS` in
   [`src/lib/exercise-motion.ts`](src/lib/exercise-motion.ts) and
   an entry with cues to `LIB` in [`src/lib/library.ts`](src/lib/library.ts).
   Every built-in exercise must have its own — the category fallback exists
   for user-created exercises only, and demonstrating the wrong movement is a
   bug, not a graceful degradation.
3. Add the `Template` to `seedTemplates()`. If it has an `interval`, starting
   it launches the guided interval player. If it is a fixed amount of work
   scored by time ("— for time"), give it `forTime` stages instead: starting
   it launches the for-time player (stopwatch, one Done per stage, splits
   and best time). Each stage's label must state the reps or distance it
   logs. For a yoga class — every pose its own hold, one-sided poses left
   then right — give it `flow` steps and a `transition` (seconds to move
   between poses): the guided player names each next pose as the move
   begins and shows its cues. A one-sided pose needs `side` declared on its `LIB`
   entry (which side the animation draws) so the player mirrors the right
   one. With none of these, it opens as a logged session. Every template
   also gets a `level` (beginner / intermediate / advanced — how hard it is
   to start with) and, unless it is an interval or flow whose length is
   computed, `estimateMinutes`: the typical finishing time the library's
   length filter and cards use. An indoor-bike session gets `ride`
   segments instead: each targets a % of FTP (the rider's FTP lives in
   Settings, so watts follow it) and ends on `seconds` or on `kcal` —
   exactly one. Any kcal segment makes it a race (`race: true`), scored by
   total time.
4. Run `bun run build && bun run db:smoke`. The smoke test is the only
   reviewer this content gets. It asserts that every built-in exercise has its
   own animation, that no template references an exercise that does
   not exist, that a template with an `interval` has a scheme written in the
   units the guided player actually enforces — no metres, no AMRAP, no rep
   counts — that the interval itself is within sane bounds, that every
   for-time stage prescribes the amount its exercise's metric measures and
   says so in its label, that a flow's sides are paired and its scheme states
   its real total, pose count and hold range, that every template has a level
   and a length (computed or estimated), and that every metric has a declared PR direction.
5. Existing installs get *new* built-ins through `mergeBuiltIns`, which the
   SQLite loader applies on every open. Without that they would never see
   them, because their database was seeded on first launch and never again.
   Read the next section before touching a built-in that already ships.

### Built-ins are seeded once, never refreshed

`mergeBuiltIns` ([`src/lib/store.ts`](src/lib/store.ts)) pushes only ids it has
never seen, and the SQLite write-back only inserts rows the database does not
already hold. New exercises and templates therefore reach existing
installs — **but edits to an already-seeded row do not.** Changing a shipped
exercise's name, metric or muscles is a no-op on every device except a fresh
install, and you will not notice, because your dev database is fresh.

What follows from that:

- **Templates, animations and cues are pure code.** They are never persisted;
  they are resolved from `seedTemplates()`, `MOTIONS` and `LIB` on every render.
  Editing a template's stations, timing, scheme, description or music reaches
  every install on the next build. Fix those in place.
- **A semantic correction to an existing built-in exercise ships as a NEW
  exercise id, with the templates that reference it repointed.**
  Leave the old id alone — it is a foreign key in sessions and personal
  records the owner has already logged. Commit `4a66abe` took exactly this
  path for Murph's squat. Changing a metric (say, Farmer's Carry from
  `weight_reps` to a carry metric) is a semantic correction, not a typo fix.
- **Do not add a blanket "refresh all built-ins on open" pass.** Rows on a
  device can differ from the seed on purpose — `mergeBuiltIns` renames a
  superseded exercise to "(old)" and hides it — and a blanket overwrite
  would silently undo that and anything else written since. That is the
  silently-wrong outcome the philosophy above forbids, traded for a
  convenience.

### Writing animations

Choreography lives in [`src/lib/exercise-motion.ts`](src/lib/exercise-motion.ts).
The stage is 100×100 with contact points at y=88 and a ground line at y=90.
Every pose uses a shared skeleton: 23-unit torso, 12+12-unit arms, and
17+17-unit legs. Elbows and knees are solved **after** sampling the timeline.
Do not go back to hand-morphing independent limb paths: that disconnects
joints and makes limbs shrink in the intermediate frames.

- Author the whole movement, including recovery, landing and reset. Timing
  comes from explicit timeline positions; use arcs for swings and pedals.
- Keep supporting hands, feet and knees planted. Targets must be reachable;
  solver clamping is numerical protection, not an authoring shortcut.
- Keep the same bend branch through a timeline. A branch change while a
  joint is bent produces an instantaneous flip. Interpolate free arms around
  the shoulder when a straight target interpolation would cross the joint.
- Use the lighter far-side limb to preserve depth during crossings. Do not
  pin both legs to opposite sides merely to avoid overlap: that destroys the
  alternating gait. Seated hip rotations use floor-plane foreshortening.
- Distinct movements need distinct definitions: Power Clean is not a hinge,
  Wall Ball is not a barbell thruster, and front/back racks differ.
- `ExerciseAnim` caches solved frames and uses native SVG/SMIL playback.
  Keep the path command structures and equipment counts stable throughout
  each loop. Hide a thrown ball during reset instead of reversing its flight.
- Run `bun run test`, `bun run build` and `bun run db:smoke`. The animation
  tests cover lengths, contacts, clipping, continuous loops, joint flips,
  native interpolation, equipment release and built-in mappings. Also inspect
  full cycles at 62 px (library) and 170 px (player); geometry checks cannot
  judge whether an exercise is recognizable.


---

## Things that are easy to get wrong

- **Timing.** The interval player is anchored to the wall clock
  ([`src/components/WodPlayer.tsx`](src/components/WodPlayer.tsx)): elapsed
  time comes from `Date.now()` and the current step is derived from it. Do not
  reintroduce an accumulator — Android freezes the WebView in standby, and an
  accumulated timer silently desyncs the whole workout.
- **React purity.** ESLint enforces `react-hooks/purity` and
  `react-hooks/refs`. `Date.now()` and `ref.current` cannot be read during
  render. Put the impure read in an event handler or an effect and pass the
  value in.
- **Audio.** The countdown cues and the battle track share one
  `AudioContext`, unlocked from the Start tap. Music ducks under cues and its
  loop seam is crossfaded, because generated tracks are always shorter than
  the workout. See [`src/lib/track.ts`](src/lib/track.ts).
- **GPS.** Run tracking lives in native code
  ([`src-tauri/plugins/varg-gps`](src-tauri/plugins/varg-gps)): an Android
  foreground location service, because the WebView is frozen while the phone
  is locked. It records the wall-clock moment the target distance is reached;
  the for-time player turns that into the stage's mark when it next wakes.
  Do not move distance tracking into JavaScript — it would stop at the
  pocket. Every GPS failure is shown on the stage in red; never fall back to
  a quiet "off".
- **The bike.** Power, cadence and kcal come from the bike over Bluetooth
  ([`src-tauri/plugins/varg-bike`](src-tauri/plugins/varg-bike)), which
  only forwards raw FTMS / Cycling Power packets; all byte parsing is in
  [`src/lib/bike.ts`](src/lib/bike.ts), unit-tested. Keep it that way —
  native code is the part nobody can test without the bike. No data is
  shown in red with a manual Done for kcal targets, never a silent stall.
  Rides keep running with another app on screen: a foreground service
  (`RideService`) holds the connection, records every packet, and plays
  the cues on a schedule the player sends (`rideSchedule`). On return the
  player replays the packets one by one through `RideRun`. Cues sound once:
  the service only while Varg is off screen, the app only while on it.
- **Spoken cues.** Guided workouts name what comes next — the first
  exercise in the lead-in, the next one as each rest or move begins — in a
  calm yoga voice or a firm workout voice. The lines are generated through
  kie.ai and cached; `allVoiceLines()` derives them from the player's own
  steps via `configForTemplate`, so new content is voiced automatically. Do
  not hand-maintain a line list.
- **Migrations.** Schema changes are `bun run db:generate`, then commit the
  generated SQL in `/drizzle`. Never hand-edit an applied migration.
- **Metric only.** Kilograms and metres, always. No unit toggle.

## Checks

```bash
bun run build      # tsc --noEmit && eslint src && vite build
bun run db:smoke   # migrations (applied twice) + CRUD + built-in content guards
bun run test       # recording semantics + animation geometry and choreography
bun run dev        # browser at :1420, localStorage backend
```
