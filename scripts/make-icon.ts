/**
 * Renders the Varg app icon (assets/icon.png) from an inline SVG.
 * Run via `bun run icons`, which then calls `tauri icon` to fan out
 * every platform size (including Android mipmaps).
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SIZE = 1024;

// Varg = Old Norse for "wolf". Angular front-facing wolf head,
// same geometry as the in-app <Mark/> (48-unit grid scaled ×18, centered).
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1a1f14"/>
      <stop offset="1" stop-color="#0b0d08"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="200" fill="url(#bg)"/>
  <rect x="70" y="70" width="884" height="884" rx="150" fill="none" stroke="#333a29" stroke-width="10"/>
  <g transform="translate(80 71) scale(18)">
    <path d="M12 4 L18 12 L24 10 L30 12 L36 4 L38 16 L40 25 L32 37 L24 45 L16 37 L8 25 L10 16 Z"
          fill="#a4c639" opacity="0.12"/>
    <path d="M12 4 L18 12 L24 10 L30 12 L36 4 L38 16 L40 25 L32 37 L24 45 L16 37 L8 25 L10 16 Z"
          fill="none" stroke="#a4c639" stroke-width="2" stroke-linejoin="round"/>
    <path d="M15 22 L21 25 M33 22 L27 25"
          fill="none" stroke="#a4c639" stroke-width="2" stroke-linecap="round"/>
    <path d="M21 33 L27 33 L24 37 Z"
          fill="#a4c639" stroke="#a4c639" stroke-width="1.5" stroke-linejoin="round"/>
  </g>
</svg>`;

const out = "assets/icon.png";
mkdirSync(dirname(out), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(out);
console.log(`Wrote ${out} (${SIZE}x${SIZE})`);
