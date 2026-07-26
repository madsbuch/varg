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

## Features

- **Personal records** — auto-detected from every session (estimated 1RM via
  Epley, top weight, max reps, best hold, longest distance) plus manual entry.
- **Split builder** — build your own multi-day splits (Push/Pull/Legs,
  Upper/Lower, PT/Conditioning ship built-in) and start a session straight
  from a split day.
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
- **Interval WOD player** — configurable work/rest/rounds (30/30, Tabata
  20/10, 40/20, 20/10 presets, or build your own circuit — an exercise may
  repeat, so you can put cardio between every station). Shows what you are
  doing *right now* (rest is its own block with its own still figure, never
  the next exercise's animation) plus the next two steps, rest included.
  Synthesized audio cues (3-2-1 ticks, work/rest/finish tones via Web Audio
  — no assets), whole-workout and per-step progress, back/pause/skip, screen
  wake-lock re-acquired on resume, and one-tap logging to history. Timing is
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

[`.github/workflows/release.yml`](.github/workflows/release.yml) builds a
**signed** APK on every merge to `main` — no version bump needed — and
publishes two kinds of release:

| Release      | When                                                        | Contents  |
| ------------ | ----------------------------------------------------------- | --------- |
| `latest`     | every merge to `main`; marked *pre-release*                 | APK       |
| `v<x.y.z>`   | when the `package.json` version first lands on `main`, or when you push a `v*` tag; keeps the **Latest** badge | APK + AAB |

The rolling build always lives at the same URL —
`github.com/madsbuch/varg/releases/tag/latest` — so you can bookmark it on
the phone and re-download to update.

**No secrets configured?** The workflow still ships: it generates an
*ephemeral* keystore for that run and signs with it. The APK installs fine,
but the signature differs between builds, so Android won't apply one build
as an in-place update over another. Add the secrets below for a stable
signature. Every run prints the signing certificate to the job summary —
if that fingerprint ever changes, in-place updates have broken.

### versionCode

Tauri derives `versionCode` from semver (`0.5.6` → `5006`), which would give
every build between two bumps the same code. The workflow instead pins
`versionCode = 10000 + <commit count>`: strictly increasing per build, and
above every semver-derived code already shipped, so no build is ever seen as
a downgrade.

The workflow prefers these repository secrets
(**Settings → Secrets and variables → Actions**):

| Secret                      | Meaning                                             |
| --------------------------- | --------------------------------------------------- |
| `ANDROID_KEY_BASE64`        | base64 of your keystore (one line, no wrapping)     |
| `ANDROID_KEY_ALIAS`         | key alias inside the keystore                       |
| `ANDROID_KEY_PASSWORD`      | key password                                        |
| `ANDROID_KEYSTORE_PASSWORD` | keystore/store password (optional; falls back to the key password) |

> If your existing secrets use different names, edit the `env:` block of the
> **Configure signing** step in the workflow — that's the only place they're
> referenced.

The release key for this app lives at `~/.tauri/keystores/varg-upload.jks`
(alias `varg`, password in `varg-upload.credentials.txt` beside it). It is
**not** in the repo, and it can never be replaced without breaking in-place
updates for everyone who has the app installed — back it up.

### Generating a keystore (if you need one)

```bash
keytool -genkeypair -v -keystore varg-upload.jks -alias varg \
  -keyalg RSA -keysize 4096 -validity 10000
base64 < varg-upload.jks | tr -d '\n'   # → ANDROID_KEY_BASE64 (macOS-safe)
```

### Cutting a release

A merge to `main` is enough to get a new build — it lands on the `latest`
release. To cut a *versioned* release, either bump `version` in
`package.json` and merge, or tag by hand:

```bash
git tag v0.6.0
git push origin v0.6.0       # CI builds, signs, and publishes v0.6.0
```

You can also trigger the workflow manually from the **Actions** tab
(*Release Android → Run workflow*): pass a tag to cut that version, or leave
it empty to just refresh the rolling build.

## License

Personal project — all rights reserved unless a license file is added.
