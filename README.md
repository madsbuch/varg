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
- **Military templates** — Murph, ACFT, USMC PFT, Navy PRT, Cindy, DT, Chad
  1000x, standard ruck, and more. Load one and log it.
- **Live session logging** — per-set weight×reps / reps / time / distance,
  with metric or imperial units, and live "on pace for a PR" hints.
- **Offline-first** — all data persists in local storage on the device.

## Stack

| Layer     | Choice                              |
| --------- | ----------------------------------- |
| Shell     | Tauri 2 (Rust)                      |
| Frontend  | React 18 + Vite + TypeScript        |
| Package   | Bun                                 |
| Storage   | Local storage (zero native deps)    |
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

Pushing a tag like `v0.1.0` runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds a
**signed** APK + AAB and attaches them to a GitHub Release.

The workflow expects these repository secrets
(**Settings → Secrets and variables → Actions**):

| Secret                      | Meaning                                             |
| --------------------------- | --------------------------------------------------- |
| `ANDROID_KEY_BASE64`        | base64 of your keystore — `base64 -w0 varg.keystore` |
| `ANDROID_KEY_ALIAS`         | key alias inside the keystore                       |
| `ANDROID_KEY_PASSWORD`      | key password                                        |
| `ANDROID_KEYSTORE_PASSWORD` | keystore/store password (optional; falls back to the key password) |

> If your existing secrets use different names, edit the `env:` block of the
> **Configure signing** step in the workflow — that's the only place they're
> referenced.

### Generating a keystore (if you need one)

```bash
keytool -genkey -v -keystore varg.keystore -alias varg \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 varg.keystore     # → paste into ANDROID_KEY_BASE64
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
