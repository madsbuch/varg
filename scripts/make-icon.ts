/**
 * Renders the Varg app icon (assets/icon.png) from an inline SVG.
 * Run via `bun run icons`, which then calls `tauri icon` to fan out
 * every platform size (including Android mipmaps).
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SIZE = 1024;

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
  <g fill="none" stroke="#a4c639" stroke-width="34" stroke-linejoin="round" stroke-linecap="round">
    <path d="M512 200 L250 320 l40 190 -80 80 150 60 80 150 100 -55 100 55 80 -150 150 -60 -80 -80 40 -190 Z"/>
    <path d="M400 470 l55 70 M624 470 l-55 70 M512 590 l-45 70 h90 Z"/>
  </g>
</svg>`;

const out = "assets/icon.png";
mkdirSync(dirname(out), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(out);
console.log(`Wrote ${out} (${SIZE}x${SIZE})`);
