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
  has been considered and rejected. The one exception already in the app is
  the ad-hoc *Interval WOD* sheet on the Hunt screen, for throwing together
  a circuit on the spot — that is a scratchpad, not a program library, and
  it does not persist.
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
2. Add an animation to `DEFS` in
   [`src/components/ExerciseAnim.tsx`](src/components/ExerciseAnim.tsx) and
   an entry with cues to `LIB` in [`src/lib/library.ts`](src/lib/library.ts).
   Every built-in exercise must have its own — the category fallback exists
   for user-created exercises only, and demonstrating the wrong movement is a
   bug, not a graceful degradation.
3. Add the `Template` to `seedTemplates()`. If it has an `interval`, starting
   it launches the guided player; without one it opens as a logged session.
4. Run `bun run build && bun run db:smoke`. The smoke test is the only
   reviewer this content gets. It asserts that every built-in exercise has its
   own animation, that no template or split references an exercise that does
   not exist, that no split day lists the same exercise twice and no split-day
   id is reused (both are primary-key collisions that hang the app on the
   splash), that a template with an `interval` has a scheme written in the
   units the guided player actually enforces — no metres, no AMRAP, no rep
   counts — that the interval itself is within sane bounds, and that every
   metric has a declared PR direction.
5. Existing installs get *new* built-ins through `mergeBuiltIns`, which the
   SQLite loader applies on every open. Without that they would never see
   them, because their database was seeded on first launch and never again.
   Read the next section before touching a built-in that already ships.

### Built-ins are seeded once, never refreshed

`mergeBuiltIns` ([`src/lib/store.ts`](src/lib/store.ts)) pushes only ids it has
never seen, and the SQLite write-back only inserts rows the database does not
already hold. New exercises, splits and templates therefore reach existing
installs — **but edits to an already-seeded row do not.** Changing a shipped
exercise's name, metric or muscles is a no-op on every device except a fresh
install, and you will not notice, because your dev database is fresh.

What follows from that:

- **Templates, animations and cues are pure code.** They are never persisted;
  they are resolved from `seedTemplates()`, `DEFS` and `LIB` on every render.
  Editing a template's stations, timing, scheme, description or music reaches
  every install on the next build. Fix those in place.
- **A semantic correction to an existing built-in exercise ships as a NEW
  exercise id, with the templates and splits that reference it repointed.**
  Leave the old id alone — it is a foreign key in sessions and personal
  records the owner has already logged. Commit `4a66abe` took exactly this
  path for Murph's squat. Changing a metric (say, Farmer's Carry from
  `weight_reps` to a carry metric) is a semantic correction, not a typo fix.
- **Do not add a blanket "refresh all built-ins on open" pass.** Built-in
  splits are user-editable — only the delete button is gated on `builtIn`
  ([`src/views/Splits.tsx`](src/views/Splits.tsx)) — so overwriting seeded
  rows would silently wipe the owner's customisations. That is the
  silently-wrong outcome the philosophy above forbids, traded for a
  convenience.

### Writing animations

Figures live in a 100×100 box with the ground at y≈88. A part is either a
path whose `d` morphs between frames or a circle whose centre moves. Every
frame of a path must have an identical command structure.

The trap: **two frames that mirror a limb across the centre line collapse to a
straight line at the midpoint of the interpolation**, so the figure spends
half of every loop looking like a stick. Keep each limb on its own side of the
body, or use three frames. This is why `run`, `runInPlace` and `flutter` are
written the way they are.

The threshold is numeric, so check it rather than eyeballing frame 0. Strokes
are 4 units wide in a 100-unit box, so a pair of limbs reads as one line below
roughly 8 units of separation. Sample the interpolation (t = 0, 0.25, 0.5,
0.75, 1) and require the **minimum max-per-vertex gap between the two limbs to
stay at or above 10** across the whole loop — `runInPlace` measures 14; the
Ruck and Farmer's Carry legs measured 2.00 at t = 0.5 and merged for about a
quarter of every 1.4 s loop. Mirroring an arm across the body's centre line
has the same failure mode as mirroring a leg.

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
- **Migrations.** Schema changes are `bun run db:generate`, then commit the
  generated SQL in `/drizzle`. Never hand-edit an applied migration.
- **Metric only.** Kilograms and metres, always. No unit toggle.

## Checks

```bash
bun run build      # tsc --noEmit && eslint src && vite build
bun run db:smoke   # migrations (applied twice) + CRUD + built-in content guards
bun run dev        # browser at :1420, localStorage backend
```
