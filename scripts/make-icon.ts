/**
 * Renders the Varg app icon from the shared wolf geometry
 * (src/lib/wolf-mark.ts, the same paths as the in-app <Mark/>).
 *
 * `bun run icons` runs this twice around `tauri icon`:
 *   1. no flag: writes assets/icon.png, the full square icon that
 *      `tauri icon` fans out to every platform size;
 *   2. `--adaptive`: overwrites the Android adaptive-icon foregrounds and
 *      background colour, which `tauri icon` otherwise makes by shrinking
 *      the whole square icon onto white.
 *
 * Palette is the app's own (src/styles.css): woad field, bone wolf,
 * bronze eyes and a bronze double frame like the cards.
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { WOLF_EYES, WOLF_HEAD, WOLF_LINES, WOLF_NOSE } from "../src/lib/wolf-mark";

const WOAD = "#2f5578";
const WOAD_LIGHT = "#3a6690";
const WOAD_DEEP = "#1f3b56";
const BONE = "#e6e3d8";
const BRONZE = "#d1a64f";
const BRONZE_LINE = "#c0a95e";

/** The wolf on its 48-unit grid, drawn in bone with bronze eyes. */
const wolf = `
  <path d="${WOLF_HEAD}" fill="${BONE}" opacity="0.13"/>
  <path d="${WOLF_HEAD}" fill="none" stroke="${BONE}" stroke-width="2" stroke-linejoin="round"/>
  ${WOLF_LINES.map((d) => `<path d="${d}" fill="none" stroke="${BONE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`).join("\n  ")}
  <path d="${WOLF_EYES}" fill="${BRONZE}" stroke="${BRONZE}" stroke-width="1" stroke-linejoin="round"/>
  <path d="${WOLF_NOSE}" fill="${BONE}" stroke="${BONE}" stroke-width="1.5" stroke-linejoin="round"/>`;

/** Places the 48-grid wolf centred in a square of `size`, `scale` units per grid unit. */
const placed = (size: number, scale: number) => {
  const off = (size - 48 * scale) / 2;
  return `<g transform="translate(${String(off)} ${String(off)}) scale(${String(scale)})">${wolf}</g>`;
};

const SIZE = 1024;
const icon = `
<svg xmlns="http://www.w3.org/2000/svg" width="${String(SIZE)}" height="${String(SIZE)}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${WOAD_LIGHT}"/>
      <stop offset="1" stop-color="${WOAD_DEEP}"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="200" fill="url(#bg)"/>
  <rect x="62" y="62" width="900" height="900" rx="150" fill="none" stroke="${BRONZE_LINE}" stroke-width="10"/>
  <rect x="86" y="86" width="852" height="852" rx="128" fill="none" stroke="${BRONZE_LINE}" stroke-width="4" opacity="0.6"/>
  ${placed(SIZE, 15)}
</svg>`;

/**
 * Adaptive foreground: a 108 dp canvas whose middle 66 dp always shows.
 * The wolf sits inside that, ringed in bronze; the woad is the background.
 */
const foreground = (px: number) => {
  const u = px / 108; // px per dp
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${String(px)}" height="${String(px)}" viewBox="0 0 ${String(px)} ${String(px)}">
  <circle cx="${String(px / 2)}" cy="${String(px / 2)}" r="${String(32 * u)}" fill="none" stroke="${BRONZE_LINE}" stroke-width="${String(1.2 * u)}"/>
  <circle cx="${String(px / 2)}" cy="${String(px / 2)}" r="${String(30 * u)}" fill="none" stroke="${BRONZE_LINE}" stroke-width="${String(0.5 * u)}" opacity="0.6"/>
  ${placed(px, (44 * u) / 48)}
</svg>`;
};

if (process.argv.includes("--adaptive")) {
  const densities: [string, number][] = [
    ["mdpi", 108], ["hdpi", 162], ["xhdpi", 216], ["xxhdpi", 324], ["xxxhdpi", 432],
  ];
  for (const [d, px] of densities) {
    const out = `src-tauri/icons/android/mipmap-${d}/ic_launcher_foreground.png`;
    mkdirSync(dirname(out), { recursive: true });
    await sharp(Buffer.from(foreground(px))).png().toFile(out);
    console.log(`Wrote ${out} (${String(px)}x${String(px)})`);
  }
  const bg = "src-tauri/icons/android/values/ic_launcher_background.xml";
  mkdirSync(dirname(bg), { recursive: true });
  writeFileSync(bg, `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">${WOAD}</color>
</resources>
`);
  console.log(`Wrote ${bg}`);
} else {
  const out = "assets/icon.png";
  mkdirSync(dirname(out), { recursive: true });
  await sharp(Buffer.from(icon)).png().toFile(out);
  console.log(`Wrote ${out} (${String(SIZE)}x${String(SIZE)})`);
}
