import { useEffect, useRef } from 'react';
import { maplibregl } from '@/lib/map/maplibre';
import { useTheme } from 'next-themes';
import type { LngLat, PreviewCity } from '@/types/alerts';
import type { GeoPreviewMapProps } from '@/types/ui';
import i18n from '@/i18n';
import { CONFIG } from '@/data/config';
import { MAP_COLORS } from '@/data/mapColors';
import { localizeCityName } from '@/lib/geo/cityNames';
import { pointsToGeometry } from '@/lib/geo/geojson';
import { escapeHtml } from '@/lib/html';
import { getBasemapStyle, getBasemapMaxZoom } from './mapStyle';
import { ensurePinImages, PIN_ACTIVE_IMAGE } from './pin';

const SOURCE_ID = 'preview';
// Separate source for the "show all cities" overlay so fitting the camera only
// considers the selected city's current/candidate points, not every city.
const SOURCE_ALL = 'preview-all';

/** Layer ids, one set per "kind" (the saved value vs. the candidate preview). */
const LAYERS = {
  currentFill: 'preview-current-fill',
  currentLine: 'preview-current-line',
  currentPoint: 'preview-current-point',
  candidateFill: 'preview-candidate-fill',
  candidateLine: 'preview-candidate-line',
  candidatePoint: 'preview-candidate-point',
};

// "All cities" overlay layers - drawn exactly like a live event (red active
// area / red active pin) so the operator sees how an event there would look.
const ALL_FILL = 'preview-all-fill';
const ALL_LINE = 'preview-all-line';
const ALL_MARKER = 'preview-all-marker';

type FeatureCollection = GeoJSON.FeatureCollection;

/** A polygon/point feature tagged with its kind (current vs. candidate). */
function toFeature(points: LngLat[], kind: 'current' | 'candidate'): GeoJSON.Feature | null {
  const geometry = pointsToGeometry(points);
  return geometry ? { type: 'Feature', properties: { kind }, geometry } : null;
}

function buildCollection(current: LngLat[] | null, candidate: LngLat[] | null): FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const cur = current && toFeature(current, 'current');
  const cand = candidate && toFeature(candidate, 'candidate');
  if (cur) features.push(cur);
  if (cand) features.push(cand);
  return { type: 'FeatureCollection', features };
}

/** Every city's stored points as event-style features (polygon area / point),
 *  each carrying its `name` so hovering can show which city it is. */
function buildAllCollection(cities: PreviewCity[] | null): FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const city of cities ?? []) {
    const geometry = pointsToGeometry(city.points);
    if (geometry) features.push({ type: 'Feature', properties: { name: city.name }, geometry });
  }
  return { type: 'FeatureCollection', features };
}

function addLayers(map: maplibregl.Map) {
  const fill = (id: string, color: string, kind: string) => {
    if (map.getLayer(id)) return;
    map.addLayer({
      id,
      type: 'fill',
      source: SOURCE_ID,
      filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'kind'], kind]],
      paint: { 'fill-color': color, 'fill-opacity': 0.35 },
    });
  };
  const line = (id: string, color: string, kind: string) => {
    if (map.getLayer(id)) return;
    map.addLayer({
      id,
      type: 'line',
      source: SOURCE_ID,
      filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'kind'], kind]],
      paint: { 'line-color': color, 'line-width': 2 },
    });
  };
  const circle = (id: string, color: string, kind: string) => {
    if (map.getLayer(id)) return;
    map.addLayer({
      id,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'kind'], kind]],
      paint: {
        'circle-radius': 7,
        'circle-color': color,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });
  };
  // "All cities" overlay (own source), drawn first so the selected city's
  // current/candidate layers sit on top. Polygons -> red active-event area;
  // single points -> the same red teardrop pin the live map uses.
  if (!map.getLayer(ALL_FILL)) {
    map.addLayer({
      id: ALL_FILL,
      type: 'fill',
      source: SOURCE_ALL,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': MAP_COLORS.active, 'fill-opacity': 0.45 },
    });
  }
  if (!map.getLayer(ALL_LINE)) {
    map.addLayer({
      id: ALL_LINE,
      type: 'line',
      source: SOURCE_ALL,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'line-color': MAP_COLORS.active, 'line-width': 2 },
    });
  }
  if (!map.getLayer(ALL_MARKER)) {
    map.addLayer({
      id: ALL_MARKER,
      type: 'symbol',
      source: SOURCE_ALL,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: {
        'icon-image': PIN_ACTIVE_IMAGE,
        'icon-size': 1,
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
  }

  fill(LAYERS.currentFill, MAP_COLORS.geoCurrent, 'current');
  line(LAYERS.currentLine, MAP_COLORS.geoCurrent, 'current');
  circle(LAYERS.currentPoint, MAP_COLORS.geoCurrent, 'current');
  fill(LAYERS.candidateFill, MAP_COLORS.geoCandidate, 'candidate');
  line(LAYERS.candidateLine, MAP_COLORS.geoCandidate, 'candidate');
  circle(LAYERS.candidatePoint, MAP_COLORS.geoCandidate, 'candidate');
}

/** Show the city name on hover over the "all cities" overlay (fill + markers). */
function bindHover(map: maplibregl.Map) {
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'alert-popup',
  });
  const show = (e: maplibregl.MapLayerMouseEvent) => {
    const name = e.features?.[0]?.properties?.name;
    if (typeof name !== 'string') return;
    map.getCanvas().style.cursor = 'pointer';
    const display = localizeCityName(name, i18n.language);
    popup.setLngLat(e.lngLat).setHTML(`<div class="alert-popup__name">${escapeHtml(display)}</div>`).addTo(map);
  };
  const hide = () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  };
  for (const layer of [ALL_FILL, ALL_MARKER]) {
    map.on('mousemove', layer, show);
    map.on('mouseleave', layer, hide);
  }
}

/** Fit the camera to every drawn point (with a little padding). */
function fitToData(map: maplibregl.Map, current: LngLat[] | null, candidate: LngLat[] | null) {
  const all = [...(current ?? []), ...(candidate ?? [])];
  if (all.length === 0) return;
  if (all.length === 1) {
    map.easeTo({ center: all[0], zoom: CONFIG.MAP_FOCUS_ZOOM });
    return;
  }
  const bounds = all.reduce(
    (b, p) => b.extend(p),
    new maplibregl.LngLatBounds(all[0], all[0]),
  );
  map.fitBounds(bounds, { padding: 48, maxZoom: CONFIG.MAP_FOCUS_ZOOM, duration: 600 });
}

/** A small standalone maplibre map that previews stored vs. candidate points. */
export function GeoPreviewMap({ current, candidate, allCities = null }: GeoPreviewMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const { resolvedTheme } = useTheme();

  const dataRef = useRef({ current, candidate, allCities });
  dataRef.current = { current, candidate, allCities };

  function addSources(map: maplibregl.Map) {
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: buildCollection(dataRef.current.current, dataRef.current.candidate),
      });
    }
    if (!map.getSource(SOURCE_ALL)) {
      map.addSource(SOURCE_ALL, {
        type: 'geojson',
        data: buildAllCollection(dataRef.current.allCities),
      });
    }
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getBasemapStyle('satellite', resolvedTheme),
      center: CONFIG.MAP_CENTER,
      zoom: CONFIG.MAP_ZOOM,
      // Same camera limitation as the live map: keep the operator inside the
      // Israel region (no zooming out to the whole world / panning to the ocean).
      minZoom: CONFIG.MAP_MIN_ZOOM,
      maxZoom: getBasemapMaxZoom('satellite'),
      maxBounds: CONFIG.MAP_MAX_BOUNDS,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

    map.on('load', () => {
      addSources(map);
      ensurePinImages(map);
      addLayers(map);
      bindHover(map);
      readyRef.current = true;
      fitToData(map, dataRef.current.current, dataRef.current.candidate);
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap basemap on theme change, re-adding the sources + layers afterwards.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setStyle(getBasemapStyle('satellite', resolvedTheme), { diff: false });
    map.once('styledata', () => {
      addSources(map);
      ensurePinImages(map);
      addLayers(map);
    });
  }, [resolvedTheme]);

  // Push new geometry + refit whenever the selected city's points change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(buildCollection(current, candidate));
    fitToData(map, current, candidate);
  }, [current, candidate]);

  // Update the "all cities" overlay without refitting the camera.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const source = map.getSource(SOURCE_ALL) as maplibregl.GeoJSONSource | undefined;
    source?.setData(buildAllCollection(allCities));
  }, [allCities]);

  return <div ref={containerRef} className="h-full w-full" />;
}
