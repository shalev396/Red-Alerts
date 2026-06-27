/**
 * Generate the Home Screen / PWA icons and the default social image from the
 * alert-triangle logo (public/alert.svg, also the NavBar brand mark).
 *
 * Output (public/, committed):
 * - icon-192.png, icon-512.png   manifest icons ("any" purpose)
 * - icon-512-maskable.png        manifest icon (purpose "maskable"): logo inside the 80% safe zone
 * - apple-touch-icon.png         180x180 iOS Home Screen icon
 * - og-default.png               1200x630 Open Graph image (DEFAULT_METADATA.image)
 *
 * Every icon is square and fully opaque: iOS paints transparent pixels black,
 * and maskable icons are cropped to arbitrary shapes, so the background must
 * reach the edges.
 *
 * Keep BACKGROUND in sync with --background (.dark) in src/index.css, the
 * theme-color tag in index.html, THEME_COLOR in src/components/theme-provider.tsx
 * and background_color/theme_color in public/manifest.webmanifest.
 *
 * Regenerate (from Client/): npm run generate:icons
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

const BACKGROUND = '#0a0a0a';
const RED = '#dc2626';
const APP_NAME = 'Red Alerts';
const TAGLINE = 'Live alert map for Israel';

/** NavBar brand mark (red-tinted tile + the alert.svg triangle, 24x24 viewBox) at any size and position. */
function logo(x, y, size) {
  const scale = size / 24;
  return `
    <g transform="translate(${x} ${y}) scale(${scale})">
      <rect width="24" height="24" rx="6" fill="${RED}" fill-opacity="0.16"/>
      <g transform="translate(12 12) scale(0.66) translate(-12 -12.2)" fill="none" stroke="${RED}"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
          fill="${RED}" fill-opacity="0.2"/>
        <path d="M12 9v4"/>
        <path d="M12 17h.01"/>
      </g>
    </g>`;
}

/** Square icon with the logo centered at `ratio` of the canvas. */
function iconSvg(size, ratio) {
  const logoSize = Math.round(size * ratio);
  const offset = Math.round((size - logoSize) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="100%" height="100%" fill="${BACKGROUND}"/>
    ${logo(offset, offset, logoSize)}
  </svg>`;
}

function ogSvg() {
  const width = 1200;
  const height = 630;
  const logoSize = 220;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <radialGradient id="glow" cx="25%" cy="50%" r="60%">
        <stop offset="0%" stop-color="${RED}" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="${RED}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="${BACKGROUND}"/>
    <rect width="100%" height="100%" fill="url(#glow)"/>
    ${logo(140, (height - logoSize) / 2, logoSize)}
    <text x="420" y="300" fill="#ffffff" font-family="Segoe UI, Helvetica, Arial, sans-serif"
      font-size="112" font-weight="700">${APP_NAME}</text>
    <text x="424" y="380" fill="#a3a3a3" font-family="Segoe UI, Helvetica, Arial, sans-serif"
      font-size="44" font-weight="400">${TAGLINE}</text>
  </svg>`;
}

const outputs = [
  // Regular icons: generous logo, the platform applies its own corner rounding.
  { file: 'icon-192.png', svg: iconSvg(192, 0.75) },
  { file: 'icon-512.png', svg: iconSvg(512, 0.75) },
  { file: 'apple-touch-icon.png', svg: iconSvg(180, 0.75) },
  // Maskable: the safe zone is a centered circle 80% wide. A rounded square fits
  // inside it when its side is at most ~0.8 / sqrt(2) of the canvas; 0.55 leaves
  // a margin for the rounding.
  { file: 'icon-512-maskable.png', svg: iconSvg(512, 0.55) },
  { file: 'og-default.png', svg: ogSvg() },
];

mkdirSync(PUBLIC_DIR, { recursive: true });

for (const { file, svg } of outputs) {
  const target = `${PUBLIC_DIR}${file}`;
  // flatten() guarantees an opaque image even if the renderer leaves anti-aliased edges transparent.
  await sharp(Buffer.from(svg))
    .flatten({ background: BACKGROUND })
    .png({ compressionLevel: 9 })
    .toFile(target);
  console.log(`Wrote ${target}`);
}
