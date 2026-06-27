import { maplibregl } from '@/lib/map/maplibre';
import type {
  ExpressionSpecification,
  LayerSpecification,
  SourceSpecification,
} from 'maplibre-gl';

/**
 * Keyless, no-account, unlimited bilingual map labels for the satellite view.
 * Vector tiles + glyphs come from OpenFreeMap (OpenStreetMap data, OpenMapTiles
 * schema). Hebrew uses the local name; English uses name_en. Right-to-left
 * shaping is handled by the self-hosted MapLibre RTL text plugin.
 */

export type LabelLang = 'he' | 'en';

export const OPENFREEMAP_GLYPHS =
  'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

export const LABEL_SOURCE_ID = 'ofm-labels';

/** Vector source (TileJSON). Carries its own OSM/OpenFreeMap attribution too. */
export const LABEL_SOURCE: SourceSpecification = {
  type: 'vector',
  url: 'https://tiles.openfreemap.org/planet',
  attribution:
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · tiles <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>',
};

/** Layers whose label language can be flipped live without a full style reload. */
export const LABEL_LAYER_IDS = ['label-road', 'label-place'] as const;

export function normalizeLabelLang(language: string | undefined): LabelLang {
  return language?.toLowerCase().startsWith('he') ? 'he' : 'en';
}

function textField(lang: LabelLang): ExpressionSpecification {
  return lang === 'he'
    ? ['coalesce', ['get', 'name:nonlatin'], ['get', 'name'], ['get', 'name:latin']]
    : ['coalesce', ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];
}

/** Text-only label layers (no sprite needed) styled to read on satellite. */
export function buildLabelLayers(lang: LabelLang): LayerSpecification[] {
  const field = textField(lang);
  return [
    {
      id: 'label-road',
      type: 'symbol',
      source: LABEL_SOURCE_ID,
      'source-layer': 'transportation_name',
      minzoom: 12,
      layout: {
        'symbol-placement': 'line',
        'text-field': field,
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 14, 12],
      },
      paint: {
        'text-color': '#f5f5f5',
        'text-halo-color': 'rgba(0,0,0,0.8)',
        'text-halo-width': 1.2,
      },
    },
    {
      id: 'label-place',
      type: 'symbol',
      source: LABEL_SOURCE_ID,
      'source-layer': 'place',
      filter: [
        'match',
        ['get', 'class'],
        ['city', 'town', 'village', 'suburb', 'neighbourhood'],
        true,
        false,
      ],
      layout: {
        'text-field': field,
        'text-font': ['Noto Sans Regular'],
        'text-max-width': 8,
        'text-size': ['interpolate', ['linear'], ['zoom'], 7, 11, 11, 14, 14, 16],
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.85)',
        'text-halo-width': 1.4,
      },
    },
  ];
}

/** Flip label language in place (no style reload) when the UI language changes. */
export function applyLabelLanguage(map: maplibregl.Map, lang: LabelLang): void {
  const field = textField(lang);
  for (const id of LABEL_LAYER_IDS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'text-field', field);
  }
}

let rtlRequested = false;

/** Load the self-hosted RTL plugin once (lazily) so Hebrew renders correctly. */
export function ensureRtlTextPlugin(): void {
  if (rtlRequested) return;
  rtlRequested = true;
  if (maplibregl.getRTLTextPluginStatus() === 'unavailable') {
    void maplibregl.setRTLTextPlugin('/mapbox-gl-rtl-text.js', true);
  }
}
