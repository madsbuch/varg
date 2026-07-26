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
  20/10, 40/20 presets), synthesized audio cues (3-2-1 ticks, work/rest/
  finish tones via Web Audio — no assets), the current exercise's animation
  on screen, pause/skip, screen wake-lock, and one-tap logging to history.
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

Pushing a tag like `v0.1.0` (or dispatching the workflow manually) runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds a
**signed** APK + AAB and attaches them to a GitHub Release.

**No secrets configured?** The workflow still ships: it generates an
*ephemeral* keystore for that run and signs with it. The APK installs fine,
but the signature differs between releases, so Android won't apply one
release as an in-place update over another. Add the secrets below for a
stable signature.

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

```bash
git tag v0.1.0
git push origin v0.1.0       # CI builds, signs, and publishes the release
```

You can also trigger the workflow manually from the **Actions** tab
(*Release Android → Run workflow*) and pass a tag.

## License

Personal project — all rights reserved unless a license file is added.
