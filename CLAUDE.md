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
   The `LIB` entry also declares the exercise's `gear` from `GEAR` in
   [`src/lib/gear.ts`](src/lib/gear.ts) (`[]` for bodyweight): every
   workout card's "What you need" list is derived from it. A template
   adds only what no exercise implies (`gear.extra`: Murph's vest) and the
   specifics of its prescription (`gear.detail`: kettlebell "24/16 kg").
3. Add the `Template` to `seedTemplates()`. If it has an `interval`, starting
   it launches the guided interval player. If it is a fixed amount of work
   scored by time ("— for time"), give it `forTime` stages instead: starting
   it launches the for-time player (stopwatch, one Done per stage, splits
   and best time). Each stage's label must state the reps or distance it
   logs. For an EMOM (every minute on the minute) give it `emom`: the
   stations in order, each owning one `minute`, `rounds`, and an optional
   timed `warmup` run back to back first. A station prescribes `reps`
   or `seconds` as ONE FIXED COUNT PER ROUND, never a range ("8-12
   burpees" is not something to do mid-set): burpees 8, 10, 12 is
   `reps: [8, 10, 12]`, `perSide` adds "· 8 per leg". There is no Done
   button (the owner does not want one): a rep station shows its target
   all minute, a timed one shows rest by itself once its seconds have
   run. The minute is one player step, so the boundaries are fixed by the
   clock; rest inside it is a phase (`emomPhase` in `wod.ts`), never a
   timer of its own. For a yoga class — every pose its own hold, one-sided poses left
   then right — give it `flow` steps and a `transition` (seconds to move
   between poses): the guided player names each next pose as the move
   begins and shows its cues. A one-sided pose needs `side` declared on its `LIB`
   entry (which side the animation draws) so the player mirrors the right
   one. With none of these, it opens as a logged session. Every template
   also gets a `level` (beginner / intermediate / advanced — how hard it is
   to start with) and, unless it is an interval, EMOM or flow whose length
   is computed, `estimateMinutes`: the typical finishing time the library's
   length filter and cards use. An indoor-bike session gets `ride`
   segments instead: each targets a % of FTP (the rider's FTP lives in
   Settings, so watts follow it) and ends on `seconds` or on `kcal` —
   exactly one. A segment with `hrZone` (1-5) is steered by the chest strap
   against the rider's Garmin heart-rate zones (Skipan) instead; its `ftp`
   is only where to start. It is timed, at least 3 minutes (heart rate
   lags), and its scheme says "heart-rate zone N". Such a ride refuses to
   start without zones or a paired strap. Any kcal segment makes it a race (`race: true`), scored by
   total time. A ride whose music should follow the effort sets `intensity`
   (1 low, 2 mid, 3 peak) on every segment and `music.set`: its default
   song set from the library in [`src/lib/songs.ts`](src/lib/songs.ts).
   A set is a family written to belong together (Techno, Jazz house,
   Anthems), with built-in songs per intensity; a ride plays one set so
   it never lurches from jazz to hardcore, rotating its songs (the n-th
   stretch at an intensity plays the n-th song, offset per ride). The
   owner picks the set per workout, shuffles sets, or ticks songs by
   hand (`music-choice.ts`, the workout page's Music picker): a
   soundtrack choice, not program authoring. He also makes his own songs
   in the Music library (Skipan), giving only name, set, intensity, sound
   and lyrics; tempo, key and the kick on every beat come from the set,
   because the mixer needs them. Built-in songs are authored in code with
   permanent ids. A neural beat tracker (Beat This!, bundled as ONNX, see
   the Beat model note below) finds each song's beats and downbeats once
   it is composed (`song-loops.ts`), 16 steady bars from a downbeat
   become its loop (`beatgrid.ts`): the loudest for low and mid songs,
   the one starting on the biggest drop for peak songs, so a hard block
   opens on a drop. The mixer (`mixer.ts`) lands each stretch's song with
   bar 1 on the block's first beat, crossfading DJ-style over the 3-2-1
   countdown and no longer: the incoming song plays its own lead-up (a
   peak song's build) under the outgoing one with its low end held back
   by a high-pass, and drops its kick and bass on the one, so two kicks
   never clash. Suno masters close to full scale and a crossfade sums two
   songs, so every song is trimmed to its intensity's level (`LEVEL_DB`,
   Peak a step above Low) and a limiter ends the music chain: never let
   the music play at the song's own level. The ride's first song starts with the 10 s lead-in, its
   bar 1 on Go, kick and bass cut for the 3-2-1 and dropped on Go. When
   the loop rules change, bump `LOOP_RULES` in `song-loops.ts`: songs are
   analysed again in the background. Every
   timed block must be whole bars at every set's tempos (20 s → a
   multiple of 12 BPM), since any set can be picked for any adaptive
   ride. A song the beat model cannot loop is a red line in the player,
   never off-beat music.
4. Run `bun run build && bun run db:smoke`. The smoke test is the only
   reviewer this content gets. It asserts that every built-in exercise has its
   own animation, that no template references an exercise that does
   not exist, that a template with an `interval` has a scheme written in the
   units the guided player actually enforces — no metres, no AMRAP, no rep
   counts — that the interval itself is within sane bounds, that every
   for-time stage prescribes the amount its exercise's metric measures and
   says so in its label, that a template's gear details name gear the
   workout actually uses, that an EMOM's stations prescribe what their
   exercise counts, one whole count per round, and its scheme states its real total, warm-up, EMOM
   length, rounds and stations, that a flow's sides are paired and its scheme states
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
- **Music choice.** Every workout plays either its own battle track or
  songs from a set (`music-choice.ts`): its own choice from the picker on
  its page, else the default the owner sets in Skipan → Music (until he
  picks one, each workout's own track). Songs follow the workout's shape
  on a high level only (`workout-music.ts`): an EMOM's warm-up and every
  yoga flow play Low, the rest plays the template's `music.energy`
  (default Peak; mobility Low; a ride without intensities Mid). A long
  stretch is cut into 2-minute blocks so the set's songs rotate rather
  than one 16-bar loop playing for 18 minutes. Those blocks are the same
  `MusicPlan` a ride books, so the same mixer and native player
  (`useWorkoutMusic`) play them. A section boundary inside a workout must
  sit on the 20 s bar grid (db:smoke checks EMOM warm-ups). Never follow
  each station: a 10 s rest has no room for the 3-2-1 crossfade.
  Cues duck the music, and guided workouts cue every station: they duck
  lightly (`LIGHT_DUCK`, own track and songs alike), rides deep. At the
  ride's depth the music all but stopped at each exercise and swelled
  back, which sounded like the same song starting over. Back-to-back
  blocks on the same song are one booking (`mergeRepeats`), so a song
  never crossfades into itself.
- **Music screens.** Skipan → Music is a stack of real screens (`views/Music.tsx`:
  default, sets, a set's songs, new song, own tracks, one track), owned by
  Settings so Back pops one screen. Don't bring back sheets for it.
- **Audio.** The countdown cues and the battle track share one
  `AudioContext`, unlocked from the Start tap (an adaptive ride in the
  Android app plays its music natively instead; see The bike). Music ducks under cues and its
  loop seam is crossfaded, because generated tracks are always shorter than
  the workout. See [`src/lib/track.ts`](src/lib/track.ts).
- **System bars.** The Android WebView ignores `<meta name="theme-color">`,
  so the phone's status and navigation bars are coloured natively
  ([`src-tauri/plugins/varg-system`](src-tauri/plugins/varg-system)):
  `theme.ts` calls `system_bars` with the theme's `--bg` and light or dark
  icons whenever the theme resolves. Without it the generated activity
  theme left a black status bar over the light theme. `gen/android` is
  regenerated on every release, so fix bar colours here, never by
  patching generated theme XML.
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
  Whether Varg is on screen comes from Android's own activity callbacks
  (`BikePlugin`): Tauri's plugin onPause/onResume did not arrive reliably
  and the coach went silent off screen. In the Android app the ride's
  music is played natively, not by the WebView, which kept playing off
  screen but stopped switching songs: the app computes the score
  ([`src/lib/score.ts`](src/lib/score.ts): every voice, its start, buffer
  offset, rate, gain and high-pass curves, in wall-clock time; tested) and
  `MusicEngine` renders it with `MusicMixer` into an AudioTrack, its clock
  held to the wall clock by the track's timestamps. A voice's place in
  its song is a pure function of the clock, so a new score replaces the
  old without a seam. Songs go over once per composed track (16-bit PCM of
  the cut lead-up and loop, cached natively). `MusicMixer` is plain
  Kotlin, tested on the JVM (`src/test`, including the app's own score as a
  fixture that `scripts/score.test.ts` keeps current); the browser mixer
  plays the same score in the web build. Service cues duck the music.
- **Garmin.** [`src/lib/garmin.ts`](src/lib/garmin.ts) talks to the Garmin
  Connect Personal API with the owner's key: read-only, no server. FTP is
  not in the profile; it comes from the newest ride's `functionalThresholdPower`.
  Watch activities are matched to Varg sessions by **overlapping time**,
  never start time: the watch and Varg are started by hand, independently
  (`matchSessions`, tested in `scripts/garmin.test.ts`). Everything fetched
  is a re-fetchable cache in localStorage, not the training database. Sync
  failures stay on screen in red (Skipan, the Den's "Last night" card).
- **Heart rate.** The chest strap is its own plugin
  ([`src-tauri/plugins/varg-hr`](src-tauri/plugins/varg-hr)), built like the
  bike: native code scans, connects, reconnects and queues raw 0x2A37
  packets; parsing and the recording (`HrRecorder`) are in
  [`src/lib/hr.ts`](src/lib/hr.ts), unit-tested. `useHeartRate` in
  [`src/components/HeartRate.tsx`](src/components/HeartRate.tsx) is the
  whole player integration: it connects the paired strap, marks the
  workout active (`setHrWorkout`), and `attach` adds the summary to the
  session being logged. Once connected, the strap stays connected for as
  long as Varg lives: a foreground service (`HrService`) holds it through
  the locked phone, another app on screen and the gaps between workouts.
  Players never disconnect it. The service lets go when Varg is swiped
  away (`onTaskRemoved`), when the strap is forgotten in Skipan, or after
  20 minutes with no workout running. That timer is native because the
  WebView's timers stop in the background. Like the bike,
  the strap is connected *before* the clock starts: with a strap paired,
  a guided workout opens `HrConnectSheet` (live bpm, then start with or
  without it) and a ride's connect sheet carries a `StrapCard`; a
  heart-rate ride cannot start until the strap reads. Every player shows
  the heart rate in the top bar, small, under the workout's name
  (`TopTitle` in [`src/components/TopBar.tsx`](src/components/TopBar.tsx)):
  the live bpm and zone, or — no skin contact, nothing coming in, a
  dropout, a failed service — what is wrong in red, tappable to retry,
  shown only while it is wrong and never a held last number. The top
  bar's buttons sit in fixed slots, voice · music · close: one a workout
  lacks (no voice lines, music not ready) stays as an invisible `Slot`,
  so Stop never moves. Check every player at
  360×640 and at the owner's phone (about 459×948) after touching this. The session stores the summary as JSON in
  `sessions.heart_rate`. Garmin Connect is the owner's source of truth
  for history: a session whose overlapping watch activity has heart rate
  shows the watch's numbers, and the strap's recording only fills in when
  there is none. The live strap reading is for the workout itself.
- **Spoken cues.** Guided workouts name what comes next — the first
  exercise in the lead-in, the next one as each rest or move begins — in a
  calm yoga voice or a firm workout voice. The lines are generated through
  kie.ai and cached; `allVoiceLines()` derives them from the player's own
  steps via `configForTemplate`, so new content is voiced automatically. Do
  not hand-maintain a line list.
- **Beat model.** Adaptive music finds beats with Beat This! (JKU Linz,
  MIT), its small checkpoint exported to ONNX
  (`src/assets/beat-this/`) and run by onnxruntime-web, bundled, single
  threaded (the WebView is not cross-origin isolated), in a Web Worker
  (`beat-worker.ts`): on the UI thread it froze the interface. Keep the
  spectrogram and the model there; the app only calls `beatThis()`. The network only
  knows its training input: [`src/lib/melspec.ts`](src/lib/melspec.ts)
  must stay identical to torchaudio's log-mel, and
  `scripts/melspec.test.ts` checks it and the peak picking against the
  Python package value by value (`scripts/fixtures/beat-this-ref.json`).
  It costs seconds per song on a phone, so it runs when a song is
  composed, not at the ride; only the loudest 30 s window is read unless
  nothing there is steady. It needs real music: a bare synthetic click
  track can come back with almost no beats.
- **Migrations.** Schema changes are `bun run db:generate`, then commit the
  generated SQL in `/drizzle`. Never hand-edit an applied migration.
- **Metric only.** Kilograms and metres, always. No unit toggle.
- **Labels, not prose.** It is a training app, not a reading app. Players
  and pre-workout sheets say what to do in a word or two ("Push", "Ease
  off", "HR lost · reconnecting", "97 bpm"), never sentences. Explanations
  belong in this file and in code comments, not on a screen read mid-set.

## Checks

```bash
# Kotlin (plugins' JVM tests): after `tauri android init`, in src-tauri/gen/android
#   ./gradlew :tauri-plugin-varg-bike:testReleaseUnitTest
bun run build      # tsc --noEmit && eslint src && vite build
bun run db:smoke   # migrations (applied twice) + CRUD + built-in content guards
bun run test       # recording semantics + animation geometry and choreography
bun run dev        # browser at :1420, localStorage backend
```
