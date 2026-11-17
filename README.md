# Varg

> **Varg** (*Old Norse*): wolf.

**A rugged, offline-first, military-style workout tracker.** Log sets,
track personal records, and run classic military & hero-WOD templates — all
stored locally on device, no account, no network required.

The wolf doesn't count calories; it hunts. Open the app, feed the wolf, log
the work. The angular wolf-head mark, carved Norse styling and a day and night theme carry the
identity throughout: home is the **Den**, training is the **Hunt**, and the
rest of the tab bar speaks Old Norse: **Saga** (history: every finished
session, tap one for its sets and records, with **Afrek**, the personal
records, as its second half), **Mímir** (the trainer), **Fræði** (the
exercise manual) and **Skipan** (settings).

Built with **Tauri 2 · Bun · TypeScript · React**, targeting **Android**.

---

## Philosophy: programs are authored by an agent

Varg has no in-app workout builder, and that is on purpose. New training
programs are **described in prose and written by an AI agent**, either
**Mímir**, the trainer in the app, or a coding agent adding it to the codebase
and shipping it as a build:

> "20 sec situps, cardio, pushups, cardio, backlifts… 10 seconds of rest
> between each, 3 rounds. Cardio alternates between running on the spot and
> air boxing."

becomes a `Template` in [`src/lib/seed.ts`](src/lib/seed.ts), along with any
new exercises, stick-figure animations and form cues it needs. The phone stays
a training tool with a start button, not a spreadsheet you fill in between
sets — and the messy work of turning an idea into a correct, animated,
correctly-timed program happens where it can be reviewed, tested in CI, and
kept in version control.

**Mímir** (the Mímir tab) is the in-app agent. Tell it the workout, or ask it
to design one, and it builds the program from the built-in exercises, checks
it against the same rules the build holds built-ins to, and shows it with a
Save button; saved programs sit in the Hunt beside the built-ins. Ask it what
to train and it reads your sessions, records and Garmin readiness and points
at a workout. It thinks through [OpenRouter](https://openrouter.ai): the key
and the model are set in Skipan → Mímir. A program that needs a new exercise
(and so a new animation) is still a code change.

Adding a program in code, the guardrails around it, and the animation
conventions are documented in [CLAUDE.md](CLAUDE.md).

---

## Features

- **Personal records** — auto-detected from every session (estimated 1RM via
  Epley, top weight, max reps, best hold, longest distance) plus manual entry.
- **Workout library** — pick a template and go. Programs are authored in
  code; the app has no program, interval or empty-workout builder. Ships with a Træn med
  Forsvaret-inspired section (Grundtræning, Feltmarch, Kredsløbstræning)
  plus Murph, ACFT, USMC PFT, Navy PRT, Cindy, DT, Chad 1000x, the CrossFit
  benchmarks Fran, Helen, Jackie, Karen, Kelly and Annie (each with a scaled
  version where a movement is a barrier), two yoga flows, and a two-level
  Pull-up Path from dead hangs to band-assisted pull-ups.
- **Battle tracks (Suno) and spoken cues (ElevenLabs), one key** — both are
  generated through [kie.ai](https://kie.ai) with your own API key, set once
  in Settings. Each workout gets an instrumental Suno V6 track (up to six
  minutes) matched to its BPM, style and theme, or plays a song set
  (Techno, Jazz house, Anthems) mixed to its shape: warm-up Low, the rest
  High. A default for every workout is set in Skipan → Music, and each
  workout's page can override it; the yoga flows get every
  pose name spoken in an ElevenLabs voice of your choice. Everything is
  downloaded and kept in the on-device database, so each track and line is generated
  exactly once and workouts never need the network.
  Generation is standby-safe: requests are submitted up front and composed
  on kie.ai's servers, in-flight task ids are persisted, and finished
  tracks are picked up whenever the app is next in the foreground — locking
  the phone mid-generation loses nothing. A composer log in Settings records
  every request, response, and error for on-device debugging.
- **Live session logging** — per-set weight×reps / reps / time / distance,
  with live "on pace for a PR" hints. Strictly metric: kg and km, always.
- **Exercise library ("Manual")** — every exercise with an animated
  stick-figure demonstration (pure SVG/SMIL, fully offline) and concise
  execution cues.
- **Interval WOD player** — runs each template's prescribed stations,
  work/rest timing, and rounds. Shows what you are
  doing *right now* (rest is its own block with its own still figure, never
  the next exercise's animation) plus the next two steps, rest included.
  Synthesized audio cues (3-2-1 ticks, work/rest/finish tones via Web Audio
  — no assets), whole-workout and per-step progress, back/pause/skip, screen
  wake-lock re-acquired on resume, and automatic logging at completion.
  Stop early and save only the intervals performed, including partial
  station time; skipped time and pauses are excluded. Recent sessions live
  on the Den tab, leaving Hunt focused on choosing a workout. Timing is
  anchored to the wall clock, so a re-render or a spell in standby can never
  desync the workout.
- **Garmin** (optional): with a Garmin Connect personal API key in Skipan,
  FTP follows your newest ride, watch activities fill the Saga, a Varg
  session shows the heart rate of the watch activity it overlaps, and the
  Den shows last night's sleep, HRV and Body Battery. Read-only.
- **Heart rate** — pair any Bluetooth heart rate source in Skipan (a band,
  or a watch broadcasting heart rate: anything with the standard Heart Rate
  Service). Guided workouts, for-time runs and rides connect it before the
  clock starts (like the bike), show the live rate, keep recording with
  the phone locked through a foreground service, and save each session's
  average, maximum and trace. A dropout reconnects by itself and is
  shown in red until it does. Rides can be steered by heart rate instead of watts:
  Zone 2 · 40 holds you in heart-rate zone 2, using the zones copied from
  Garmin Connect into Skipan, so Varg's zone 2 is the watch's.
- **Offline-first** — all data lives in an on-device SQLite database, owned by Rust.
- **Day and night themes**: woad blue on weathered stone by day, on cold iron
  by night, with carved Norse styling. Skipan picks one or follows the phone.
- **Tablet layouts**: two-column libraries and set logging on smaller
  tablets, side navigation on larger screens, and full-screen workout
  players. Layouts adapt to portrait, landscape, and split-screen windows.

## Data & migrations

All storage lives in Rust: one SQLite file through [Diesel], in the
[`src-tauri/store`](src-tauri/store) crate. Training data, Mímir's programs
and chat, settings, and the generated audio are all in it.

- The schema is [`src-tauri/store/src/schema.rs`](src-tauri/store/src/schema.rs);
  every change is a Diesel migration in
  [`src-tauri/store/migrations`](src-tauri/store/migrations), embedded in the
  app and applied on startup in a transaction.
- Phones that ran the Drizzle-era app keep everything: the same file, the
  same tables, and its migration history adopted by Diesel.
- Settings and cached audio that lived in the WebView (localStorage,
  IndexedDB) are copied into the store once, on the first launch.
- Strict both ways: the Rust types refuse unknown fields and wrong types,
  and the app decodes everything it reads back, field by field.
- `bun run test:store` (Rust) tests the migrations, the upgrade, and every
  read and write; `bun run test` pins what the app sends against the Rust
  types. CI runs both.
- In a plain browser (`bun run dev`), the app falls back to localStorage and
  IndexedDB so the UI stays usable during frontend development.

[Diesel]: https://diesel.rs/

## Stack

| Layer     | Choice                              |
| --------- | ----------------------------------- |
| Shell     | Tauri 2 (Rust)                      |
| Frontend  | React 18 + Vite + TypeScript        |
| Package   | Bun                                 |
| Storage   | SQLite in Rust, Diesel ORM          |
| Migrations | Diesel, SQL files tracked in git    |
| Target    | Android (APK + AAB), desktop-capable |

## Development

```bash
bun install
bun run dev            # frontend only, in a browser at :1420
bun run tauri dev      # desktop shell (needs the Tauri system deps)
```

### Android (local)

Requires Android SDK + NDK and the Rust Android targets. Then:

```bash
bun run tauri android init
bun run tauri android dev     # on a connected device / emulator
bun run tauri android build --apk
```

## Icons

The app icon is generated from an inline SVG:

```bash
bun run icons          # writes assets/icon.png, then runs `tauri icon`
```

## Signed releases (CI)

[`.github/workflows/release.yml`](.github/workflows/release.yml) publishes one
permanent **latest** release on every push to `main`, or when run manually
from Actions. It updates the existing release and APK in place; versioned
releases and AABs are no longer created.

- Release: <https://github.com/madsbuch/varg/releases/tag/latest>
- APK: <https://github.com/madsbuch/varg/releases/download/latest/varg-latest.apk>

Download the APK and install it over the existing Varg app. Android preserves
local workout data when the app identifier and signing certificate match.
The workflow verifies both before publishing. It never generates temporary
keys or publishes an unsigned build.

### Stable signing identity

Repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Meaning |
| --- | --- |
| `ANDROID_KEY_BASE64` | Base64 of the existing Varg keystore |
| `ANDROID_KEY_ALIAS` | Key alias inside that keystore |
| `ANDROID_KEY_PASSWORD` | Key password |
| `ANDROID_KEYSTORE_PASSWORD` | Store password; defaults to the key password |

The existing key is `~/.tauri/keystores/varg-upload.jks`; its credentials are
in `varg-upload.credentials.txt` beside it. Keep a secure backup. **Do not
replace this key**, because doing so breaks updates for existing installs.

The public certificate SHA-256 fingerprint is pinned in the workflow:

```text
3cfecd7836895a978210db2f475cb62dbe65a1e2e79f71c4a52975ee600d24b8
```

This fingerprint matches the previously published rolling APK and the local
release keystore. Missing secrets, a different certificate, a wrong app ID,
or an incorrect version code fail the release before publication. Builds
installed with an older, different signing key cannot be upgraded in place
with this key; back up their data before replacing such an installation.

### Version codes and release checks

`versionCode = 100000 + GITHUB_RUN_NUMBER`, above the old commit-count codes
(the last rolling release before this change used `10039`). Each new push or
manual workflow run gets a higher code without a package-version bump.
A rerun keeps its original code. Neither an old commit nor a lower version
code can replace a newer published build.

The workflow checks the keystore certificate before building and verifies
the APK certificate, `com.varg.workout` app identifier, and version code
before uploading. The job summary records the public fingerprint and code.

To ship: push to `main`. To rebuild current main: **Actions → Release Android
→ Run workflow**. No release tag or version bump is required.

## License

Personal project — all rights reserved unless a license file is added.
