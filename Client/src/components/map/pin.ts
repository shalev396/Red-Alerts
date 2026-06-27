import type * as maplibregl from 'maplibre-gl';
import { MAP_COLORS } from '@/data/mapColors';

/**
 * Shared teardrop-pin rendering for the maps. Kept in one place so the live
 * alert map and the geo-admin preview map draw IDENTICAL markers (the admin tool
 * previews how a city would look "if there was an event in it").
 */

export const PIN_ACTIVE_IMAGE = 'alert-pin-active';
export const PIN_RECENT_IMAGE = 'alert-pin-recent';
export const PIN_SELECTED_IMAGE = 'alert-pin-selected';

/** Stable map image id for a hex alert color. */
export function pinImageId(color: string): string {
  return `alert-pin-${color.replace('#', '').toLowerCase()}`;
}

/** Register teardrop pin sprites for each distinct alert color on the map. */
export function ensureColoredPinImages(map: maplibregl.Map, colors: Iterable<string>) {
  for (const color of colors) {
    const id = pinImageId(color);
    if (!map.hasImage(id)) {
      map.addImage(id, makePinImage(color), { pixelRatio: 2 });
    }
  }
}

/** Draw a Google-Maps-style teardrop pin (colored body, outline + hole). */
export function makePinImage(fill: string, stroke = '#ffffff', hole = '#ffffff'): ImageData {
  const pr = 2; // render at 2x for crisp edges (addImage uses pixelRatio: 2)
  const w = 30 * pr;
  const h = 40 * pr;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new ImageData(w, h);

  const cx = w / 2;
  const r = w * 0.32;
  const lw = w * 0.06;
  const cy = r + lw;
  const tipY = h - lw;

  // Teardrop silhouette: top semicircle with straight sides meeting at the tip.
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI, false);
  ctx.lineTo(cx, tipY);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  // Hole in the head.
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, 2 * Math.PI);
  ctx.fillStyle = hole;
  ctx.fill();

  return ctx.getImageData(0, 0, w, h);
}

/** Register the pin images on the map (idempotent; images are wiped by setStyle). */
export function ensurePinImages(map: maplibregl.Map) {
  if (!map.hasImage(PIN_ACTIVE_IMAGE)) {
    map.addImage(PIN_ACTIVE_IMAGE, makePinImage(MAP_COLORS.active), { pixelRatio: 2 });
  }
  if (!map.hasImage(PIN_RECENT_IMAGE)) {
    map.addImage(PIN_RECENT_IMAGE, makePinImage(MAP_COLORS.recent), { pixelRatio: 2 });
  }
  // Selected pin: white body + dark outline + red hole, distinct on any basemap.
  if (!map.hasImage(PIN_SELECTED_IMAGE)) {
    map.addImage(
      PIN_SELECTED_IMAGE,
      makePinImage(MAP_COLORS.selectedFill, '#1f2937', MAP_COLORS.active),
      { pixelRatio: 2 },
    );
  }
}
