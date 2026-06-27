import { useEffect, useRef, useCallback } from 'react';
import { maplibregl } from '@/lib/map/maplibre';
import type { FilterSpecification } from 'maplibre-gl';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import { CONFIG } from '@/data/config';
import { MAP_COLORS } from '@/data/mapColors';
import { cityKey, resolveCity } from '@/lib/geo';
import { localizeCityName } from '@/lib/geo/cityNames';
import { escapeHtml } from '@/lib/html';
import { useAlertsStore } from '@/store/alertsStore';
import { useBasemapStore } from '@/store/basemapStore';
import type { CityFeatureCollection, MapCityMeta } from '@/types/alerts';
import type { AlertMapProps } from '@/types/ui';
import { getBasemapStyle, getBasemapMaxZoom, MAPLIBRE_ATTRIBUTION } from './mapStyle';
import {
  applyLabelLanguage,
  ensureRtlTextPlugin,
  normalizeLabelLang,
} from './labels';
import { MapZoomControls } from './MapZoomControls';
import { ensureColoredPinImages, pinImageId } from './pin';

const SOURCE_ID = 'cities';
const LAYER_RECENT = 'alerts-recent-fill';
const LAYER_ACTIVE_FILL = 'alerts-active-fill';
const LAYER_ACTIVE_LINE = 'alerts-active-line';
const LAYER_SELECTED_FILL = 'alerts-selected-fill';
const LAYER_SELECTED_LINE = 'alerts-selected-line';
const LAYER_RECENT_MARKER = 'alerts-recent-marker';
const LAYER_ACTIVE_MARKER = 'alerts-active-marker';
const LAYER_SELECTED_MARKER = 'alerts-selected-marker';

const INTERACTIVE_LAYERS = [
  LAYER_ACTIVE_FILL,
  LAYER_RECENT,
  LAYER_SELECTED_FILL,
  LAYER_ACTIVE_MARKER,
  LAYER_RECENT_MARKER,
  LAYER_SELECTED_MARKER,
];

const FILL_COLOR: maplibregl.ExpressionSpecification = [
  'coalesce',
  ['get', 'color'],
  MAP_COLORS.recent,
];
const ACTIVE_FILL_COLOR: maplibregl.ExpressionSpecification = [
  'coalesce',
  ['get', 'color'],
  MAP_COLORS.active,
];
const PIN_IMAGE: maplibregl.ExpressionSpecification = [
  'coalesce',
  ['get', 'pinImage'],
  ['literal', pinImageId(MAP_COLORS.recent)],
];

function inNames(keys: string[]): FilterSpecification {
  return ['in', ['get', 'name'], ['literal', keys]] as unknown as FilterSpecification;
}

function areasInNames(keys: string[]): FilterSpecification {
  return [
    'all',
    ['==', ['geometry-type'], 'Polygon'],
    ['in', ['get', 'name'], ['literal', keys]],
  ] as unknown as FilterSpecification;
}

function pointsInNames(keys: string[], exclude: string[] = []): FilterSpecification {
  const parts: unknown[] = [
    'all',
    ['==', ['geometry-type'], 'Point'],
    ['in', ['get', 'name'], ['literal', keys]],
  ];
  if (exclude.length) parts.push(['!', ['in', ['get', 'name'], ['literal', exclude]]]);
  return parts as unknown as FilterSpecification;
}

function withoutKeys(keys: string[], exclude: string[]): string[] {
  if (exclude.length === 0) return keys;
  const skip = new Set(exclude);
  return keys.filter((k) => !skip.has(k));
}

/**
 * MapLibre opens the compact attribution expanded by default, which sprawls over
 * the bottom UI on narrow screens. Collapse it to the ⓘ toggle (tap to reveal),
 * matching MapLibre's own collapse behaviour.
 */
function collapseAttribution(map: maplibregl.Map) {
  const attrib = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
  if (!attrib) return;
  attrib.classList.remove('maplibregl-compact-show');
  attrib.setAttribute('open', '');
}

function popupHtml(name: string, meta: MapCityMeta | undefined): string {
  const row = meta
    ? `<div class="alert-popup__row"><span class="alert-popup__dot" style="background:${meta.color}"></span><span style="color:${meta.color}">${escapeHtml(meta.label)}</span></div>`
    : '';
  return `${row}<div class="alert-popup__name">${escapeHtml(name)}</div>`;
}

export function AlertMap({
  featureCollection,
  activeKeys,
  recentKeys,
  selectedKeys,
  cityMeta,
  onSelectEvent,
}: AlertMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const { resolvedTheme } = useTheme();
  const { i18n } = useTranslation();
  const basemap = useBasemapStore((s) => s.basemap);
  const focusRequest = useAlertsStore((s) => s.focusRequest);

  const labelLang = normalizeLabelLang(i18n.language);
  const labelLangRef = useRef(labelLang);
  labelLangRef.current = labelLang;

  const styleForMap = useCallback(
    () => getBasemapStyle(basemap, resolvedTheme, labelLangRef.current),
    [basemap, resolvedTheme],
  );

  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn({ duration: 200 });
  }, []);

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut({ duration: 200 });
  }, []);

  const collectionRef = useRef(featureCollection);
  collectionRef.current = featureCollection;

  const cityMetaRef = useRef(cityMeta);
  cityMetaRef.current = cityMeta;
  const onSelectEventRef = useRef(onSelectEvent);
  onSelectEventRef.current = onSelectEvent;

  const syncPinImages = (map: maplibregl.Map) => {
    const colors = new Set<string>();
    for (const meta of Object.values(cityMetaRef.current)) colors.add(meta.color);
    ensureColoredPinImages(map, colors);
  };

  useEffect(() => {
    ensureRtlTextPlugin();
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleForMap(),
      center: CONFIG.MAP_CENTER,
      zoom: CONFIG.MAP_ZOOM,
      minZoom: CONFIG.MAP_MIN_ZOOM,
      maxZoom: getBasemapMaxZoom(basemap),
      maxBounds: CONFIG.MAP_MAX_BOUNDS,
      attributionControl: { compact: true, customAttribution: MAPLIBRE_ATTRIBUTION },
    });
    mapRef.current = map;

    map.on('load', () => {
      map.addSource(SOURCE_ID, { type: 'geojson', data: collectionRef.current });
      syncPinImages(map);
      reAddLayers(map);

      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'alert-popup',
      });
      const showFeature = (e: maplibregl.MapLayerMouseEvent) => {
        const key = e.features?.[0]?.properties?.name;
        if (typeof key !== 'string') return;
        const meta = cityMetaRef.current[key];
        map.getCanvas().style.cursor = 'pointer';
        popup
          .setLngLat(e.lngLat)
          .setHTML(popupHtml(localizeCityName(meta?.name ?? key, i18n.language), meta))
          .addTo(map);
      };
      const hideFeature = () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
      };
      const selectFeature = (e: maplibregl.MapLayerMouseEvent) => {
        const key = e.features?.[0]?.properties?.name;
        if (typeof key !== 'string') return;
        const meta = cityMetaRef.current[key];
        if (meta) onSelectEventRef.current(meta.eventId);
      };
      INTERACTIVE_LAYERS.forEach((layer) => {
        map.on('mousemove', layer, showFeature);
        map.on('mouseleave', layer, hideFeature);
        map.on('click', layer, selectFeature);
      });

      readyRef.current = true;
      applyFilters(map, activeKeys, recentKeys, selectedKeys);
      collapseAttribution(map);
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const maxZoom = getBasemapMaxZoom(basemap);
    map.setMaxZoom(maxZoom);
    if (map.getZoom() > maxZoom) map.setZoom(maxZoom);
    map.setStyle(styleForMap(), { diff: false });
    map.once('styledata', () => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: collectionRef.current });
      }
      syncPinImages(map);
      reAddLayers(map);
      applyFilters(map, activeKeys, recentKeys, selectedKeys);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, resolvedTheme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    syncPinImages(map);
  }, [cityMeta]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(featureCollection);
  }, [featureCollection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyFilters(map, activeKeys, recentKeys, selectedKeys);
  }, [activeKeys, recentKeys, selectedKeys]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyLabelLanguage(map, labelLang);
  }, [labelLang]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !focusRequest) return;
    const center = focusCenter(focusRequest.area, collectionRef.current);
    if (center) {
      map.flyTo({ center, zoom: CONFIG.MAP_FOCUS_ZOOM, speed: 1.2, essential: true });
    }
  }, [focusRequest]);

  return (
    <div className="absolute inset-0 h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <MapZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} />
    </div>
  );
}

function focusCenter(
  area: string,
  collection: CityFeatureCollection,
): [number, number] | null {
  const key = cityKey(area);
  const feature = collection.features.find((f) => f.properties?.name === key);
  const center = feature?.properties?.center;
  if (center) return center;
  return resolveCity(area)?.center ?? null;
}

function applyFilters(
  map: maplibregl.Map,
  activeKeys: string[],
  recentKeys: string[],
  selectedKeys: string[],
) {
  const activeFillKeys = withoutKeys(activeKeys, selectedKeys);
  const recentFillKeys = withoutKeys(recentKeys, [...activeKeys, ...selectedKeys]);

  if (map.getLayer(LAYER_RECENT)) map.setFilter(LAYER_RECENT, areasInNames(recentFillKeys));
  if (map.getLayer(LAYER_ACTIVE_FILL)) map.setFilter(LAYER_ACTIVE_FILL, areasInNames(activeFillKeys));
  if (map.getLayer(LAYER_ACTIVE_LINE)) map.setFilter(LAYER_ACTIVE_LINE, areasInNames(activeFillKeys));
  if (map.getLayer(LAYER_SELECTED_FILL)) {
    map.setFilter(LAYER_SELECTED_FILL, areasInNames(selectedKeys));
  }
  if (map.getLayer(LAYER_RECENT_MARKER)) {
    map.setFilter(LAYER_RECENT_MARKER, pointsInNames(recentKeys, [...activeKeys, ...selectedKeys]));
  }
  if (map.getLayer(LAYER_ACTIVE_MARKER)) {
    map.setFilter(LAYER_ACTIVE_MARKER, pointsInNames(activeKeys, selectedKeys));
  }
  if (map.getLayer(LAYER_SELECTED_MARKER)) {
    map.setFilter(LAYER_SELECTED_MARKER, pointsInNames(selectedKeys));
  }
  if (map.getLayer(LAYER_SELECTED_LINE)) {
    map.setFilter(LAYER_SELECTED_LINE, areasInNames(selectedKeys));
  }
}

function markerLayout(iconSize: number): maplibregl.SymbolLayerSpecification['layout'] {
  return {
    'icon-image': PIN_IMAGE,
    'icon-size': iconSize,
    'icon-anchor': 'bottom',
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
  };
}

function reAddLayers(map: maplibregl.Map) {
  if (!map.getLayer(LAYER_RECENT)) {
    map.addLayer({
      id: LAYER_RECENT,
      type: 'fill',
      source: SOURCE_ID,
      paint: { 'fill-color': FILL_COLOR, 'fill-opacity': 0.18 },
      filter: inNames([]),
    });
  }
  if (!map.getLayer(LAYER_ACTIVE_FILL)) {
    map.addLayer({
      id: LAYER_ACTIVE_FILL,
      type: 'fill',
      source: SOURCE_ID,
      paint: { 'fill-color': ACTIVE_FILL_COLOR, 'fill-opacity': 0.45 },
      filter: inNames([]),
    });
  }
  if (!map.getLayer(LAYER_ACTIVE_LINE)) {
    map.addLayer({
      id: LAYER_ACTIVE_LINE,
      type: 'line',
      source: SOURCE_ID,
      paint: { 'line-color': ACTIVE_FILL_COLOR, 'line-width': 2 },
      filter: inNames([]),
    });
  }
  if (!map.getLayer(LAYER_SELECTED_FILL)) {
    map.addLayer({
      id: LAYER_SELECTED_FILL,
      type: 'fill',
      source: SOURCE_ID,
      paint: { 'fill-color': FILL_COLOR, 'fill-opacity': 0.4 },
      filter: inNames([]),
    });
  }
  if (!map.getLayer(LAYER_RECENT_MARKER)) {
    map.addLayer({
      id: LAYER_RECENT_MARKER,
      type: 'symbol',
      source: SOURCE_ID,
      layout: markerLayout(0.85),
      filter: pointsInNames([]),
    });
  }
  if (!map.getLayer(LAYER_ACTIVE_MARKER)) {
    map.addLayer({
      id: LAYER_ACTIVE_MARKER,
      type: 'symbol',
      source: SOURCE_ID,
      layout: markerLayout(1),
      filter: pointsInNames([]),
    });
  }
  if (!map.getLayer(LAYER_SELECTED_MARKER)) {
    map.addLayer({
      id: LAYER_SELECTED_MARKER,
      type: 'symbol',
      source: SOURCE_ID,
      layout: markerLayout(1.15),
      filter: pointsInNames([]),
    });
  }
  if (!map.getLayer(LAYER_SELECTED_LINE)) {
    map.addLayer({
      id: LAYER_SELECTED_LINE,
      type: 'line',
      source: SOURCE_ID,
      paint: { 'line-color': '#ffffff', 'line-width': 3 },
      filter: inNames([]),
    });
  }
}
