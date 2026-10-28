# Varg

> **Varg** (*Old Norse*): wolf.

**A rugged, offline-first, military-style workout tracker.** Log split sets,
track personal records, and run classic military & hero-WOD templates — all
stored locally on device, no account, no network required.

The wolf doesn't count calories; it hunts. Open the app, feed the wolf, log
the work. The angular wolf-head mark and olive-drab palette carry the
identity throughout: home is the **Den**, training is the **Hunt**.

Built with **Tauri 2 · Bun · TypeScript · React**, targeting **Android**.

---

## Philosophy: programs are authored in code

Varg has no in-app workout builder, and that is on purpose. New training
programs are **described in prose and added to the codebase by an AI agent**,
then shipped as a build:

> "20 sec situps, cardio, pushups, cardio, backlifts… 10 seconds of rest
> between each, 3 rounds. Cardio alternates between running on the spot and
> air boxing."

becomes a `Template` in [`src/lib/seed.ts`](src/lib/seed.ts), along with any
new exercises, stick-figure animations and form cues it needs. The phone stays
a training tool with a start button, not a spreadsheet you fill in between
sets — and the messy work of turning an idea into a correct, animated,
correctly-timed program happens where it can be reviewed, tested in CI, and
kept in version control.

Adding a program, the guardrails around it, and the animation conventions are
documented in [CLAUDE.md](CLAUDE.md).

---

## Features

- **Personal records** — auto-detected from every session (estimated 1RM via
  Epley, top weight, max reps, best hold, longest distance) plus manual entry.
- **Training splits** — browse multi-day splits (Push/Pull/Legs,
  Upper/Lower, PT/Conditioning ship built-in) and start a session straight
  from a split day. Programs are authored in code; the app has no split,
  interval, or empty-workout builder.
- **Workout library** — pick a template and go. Ships with a Træn med
  Forsvaret-inspired section (Grundtræning, Feltmarch, Kredsløbstræning)
  plus Murph, ACFT, USMC PFT, Navy PRT, Cindy, DT, Chad 1000x, and more.
- **Battle tracks (Suno)** — generate an instrumental track matched to each
  workout's BPM, style, and theme. Suno has no official public API, so this
  talks to a Suno API gateway (default `api.sunoapi.org`, configurable in
  Music settings) with your own API key. Finished tracks are downloaded and
  cached in IndexedDB, so each workout's track is generated exactly once.
  Generation is standby-safe: requests are submitted up front and composed
  on the gateway's servers, in-flight task ids are persisted, and finished
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
- **Offline-first** — all data lives in an on-device SQLite database.
- **Desert field theme** — light sand/canvas palette with olive-drab accents.

## Data & migrations

Storage is SQLite via [tauri-plugin-sql], with [Drizzle ORM] on top:

- The schema is code: [`src/db/schema.ts`](src/db/schema.ts).
- Every schema change is a tracked SQL migration in [`/drizzle`](drizzle),
  generated with `bun run db:generate` and committed — the full history of
  the database lives in git.
- Migrations are applied automatically on app startup (recorded in the
  `__migrations` table on device).
- `bun run db:smoke` applies all migrations to an in-memory SQLite and runs
  representative CRUD through the real schema — CI runs it on every push.
- Data previously stored in localStorage is imported into SQLite on first
  launch, automatically.
- In a plain browser (`bun run dev`), the app falls back to localStorage so
  the UI stays fully usable during frontend development.

To change the schema: edit `src/db/schema.ts` → `bun run db:generate` →
review the new SQL file in `/drizzle` → commit both.

[tauri-plugin-sql]: https://v2.tauri.app/plugin/sql/
[Drizzle ORM]: https://orm.drizzle.team/

## Stack

| Layer     | Choice                              |
| --------- | ----------------------------------- |
| Shell     | Tauri 2 (Rust)                      |
| Frontend  | React 18 + Vite + TypeScript        |
| Package   | Bun                                 |
| Storage   | SQLite (tauri-plugin-sql) + Drizzle ORM |
| Migrations | drizzle-kit, SQL files tracked in git |
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
