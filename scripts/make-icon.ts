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
 * The icon is a painted Viking round shield in the app's own palette
 * (src/styles.css): a bone wolf on a quartered woad field, a band of
 * Younger Futhark runes reading VARG, a riveted bronze rim, on iron.
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { WOLF_EYES, WOLF_GEM, WOLF_HEAD, WOLF_LINES, WOLF_NOSE } from "../src/lib/wolf-mark";

const WOAD = "#2f5578";
const WOAD_DARK = "#284b6b";
const WOAD_DEEP = "#1d3850";
const IRON = "#12171c";
const BONE = "#e6e3d8";
const BRONZE = "#d1a64f";
const BRONZE_DIM = "#8a6a1c";
const BRONZE_LINE = "#c0a95e";

/** The wolf on its 48-unit grid, drawn in bone with a bronze gem and eyes. */
const wolf = `
  <path d="${WOLF_HEAD}" fill="${BONE}" opacity="0.13"/>
  <path d="${WOLF_HEAD}" fill="none" stroke="${BONE}" stroke-width="2" stroke-linejoin="round"/>
  ${WOLF_LINES.map((d) => `<path d="${d}" fill="none" stroke="${BONE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`).join("\n  ")}
  <path d="${WOLF_EYES}" fill="${BRONZE}" stroke="${BRONZE}" stroke-width="1" stroke-linejoin="round"/>
  <path d="${WOLF_GEM}" fill="${BRONZE}"/>
  <path d="${WOLF_NOSE}" fill="${BONE}" stroke="${BONE}" stroke-width="1.5" stroke-linejoin="round"/>`;

/**
 * Younger Futhark staves on a 10-unit-tall box centred on the origin, so
 * the band never depends on a runic font being installed: ᚢᛅᚱᚴ, VARG.
 */
const RUNES = [
  "M-2 5 V-5 L2 -1 V5", // ᚢ ur (v)
  "M0 -5 V5 M-2.5 -2.5 L2.5 1.5", // ᛅ ar (a)
  "M-2 5 V-5 L2 -2.5 L-2 0 L2 5", // ᚱ reið (r)
  "M-1.5 5 V-5 M-1.5 0 L2.5 -4", // ᚴ kaun (g)
];
const DIAMOND = "M0 -2.2 L1.6 0 L0 2.2 L-1.6 0 Z";

/**
 * A painted Viking round shield, centred at (c, c) with radius r: a
 * bronze rim with rivets, a band of runes reading VARG three times with
 * diamond stops, and the wolf on a quartered woad field.
 */
const shield = (c: number, r: number) => {
  const f = (n: number) => n.toFixed(2);
  const pt = (rad: number, deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [c + rad * Math.cos(a), c + rad * Math.sin(a)];
  };
  const rimIn = r * 0.9;
  const bandIn = r * 0.72;
  const field = bandIn;
  // Eight painted segments, alternating woad and a shade darker.
  const segs = Array.from({ length: 8 }, (_, i) => {
    const [x1, y1] = pt(field, i * 45);
    const [x2, y2] = pt(field, (i + 1) * 45);
    return `<path d="M${f(c)} ${f(c)} L${f(x1)} ${f(y1)} A${f(field)} ${f(field)} 0 0 1 ${f(x2)} ${f(y2)} Z" fill="${i % 2 ? WOAD_DARK : WOAD}"/>`;
  }).join("");
  const rivets = Array.from({ length: 16 }, (_, i) => {
    const [x, y] = pt((r + rimIn) / 2, i * 22.5 + 11.25);
    return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.022)}" fill="${BRONZE_DIM}"/>`;
  }).join("");
  // 15 slots: VARG ◆ VARG ◆ VARG ◆, upright and pointing outward.
  const bandMid = (rimIn + bandIn) / 2;
  const scale = (rimIn - bandIn) * 0.075;
  const glyphs = Array.from({ length: 15 }, (_, i) => {
    const deg = i * 24;
    const [x, y] = pt(bandMid, deg);
    const k = i % 5;
    const d = k === 4 ? DIAMOND : RUNES[k];
    const paint = k === 4 ? `fill="${BRONZE}"` : `fill="none" stroke="${BRONZE}" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"`;
    return `<path transform="translate(${f(x)} ${f(y)}) rotate(${f(deg)}) scale(${f(scale)})" d="${d}" ${paint}/>`;
  }).join("");
  const wolfScale = (field * 1.62) / 48;
  const wolfOff = c - 24 * wolfScale;
  return `
  <circle cx="${f(c)}" cy="${f(c)}" r="${f(r)}" fill="${BRONZE_LINE}"/>
  <circle cx="${f(c)}" cy="${f(c)}" r="${f(r)}" fill="none" stroke="${IRON}" stroke-opacity="0.35" stroke-width="${f(r * 0.012)}"/>
  ${rivets}
  <circle cx="${f(c)}" cy="${f(c)}" r="${f(rimIn)}" fill="${WOAD_DEEP}"/>
  ${glyphs}
  ${segs}
  <circle cx="${f(c)}" cy="${f(c)}" r="${f(field)}" fill="none" stroke="${BRONZE_LINE}" stroke-width="${f(r * 0.012)}"/>
  <g transform="translate(${f(wolfOff)} ${f(wolfOff)}) scale(${f(wolfScale)})">${wolf}</g>`;
};

const SIZE = 1024;
const icon = `
<svg xmlns="http://www.w3.org/2000/svg" width="${String(SIZE)}" height="${String(SIZE)}" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="200" fill="${IRON}"/>
  ${shield(512, 448)}
</svg>`;

/**
 * Adaptive foreground: a 108 dp canvas whose middle 66 dp always shows.
 * The shield fills that circle; iron is the background around it.
 */
const foreground = (px: number) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${String(px)}" height="${String(px)}" viewBox="0 0 ${String(px)} ${String(px)}">
  ${shield(px / 2, (33 * px) / 108)}
</svg>`;

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
  <color name="ic_launcher_background">${IRON}</color>
</resources>
`);
  console.log(`Wrote ${bg}`);
} else {
  const out = "assets/icon.png";
  mkdirSync(dirname(out), { recursive: true });
  await sharp(Buffer.from(icon)).png().toFile(out);
  console.log(`Wrote ${out} (${String(SIZE)}x${String(SIZE)})`);
}
