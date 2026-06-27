import { useEffect, useMemo, useRef } from 'react';
import { maplibregl } from '@/lib/map/maplibre';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { CONFIG } from '@/data/config';
import { localizeCityName } from '@/lib/geo/cityNames';
import { buildHeatData, buildHeatFeatureCollection } from '@/lib/geo/heat';
import { escapeHtml } from '@/lib/html';
import { cn } from '@/lib/utils';
import { useBasemapStore } from '@/store/basemapStore';
import { ensureRtlTextPlugin } from '@/components/map/labels';
import {
  getBasemapMaxZoom,
  getBasemapStyle,
  MAPLIBRE_ATTRIBUTION,
} from '@/components/map/mapStyle';
import { HeatLegend } from '@/components/pages/analytics/HeatLegend';
import type { AlertEvent, CityCoords, CityFeatureCollection } from '@/types/alerts';

const SOURCE_ID = 'analytics-heat';
const FILL_LAYER = 'analytics-heat-fill';
const LINE_LAYER = 'analytics-heat-line';
const POINT_LAYER = 'analytics-heat-point';

function addLayers(map: maplibregl.Map) {
  if (!map.getLayer(FILL_LAYER)) {
    map.addLayer({
      id: FILL_LAYER,
      type: 'fill',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.55 },
    });
  }
  if (!map.getLayer(LINE_LAYER)) {
    map.addLayer({
      id: LINE_LAYER,
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 },
    });
  }
  if (!map.getLayer(POINT_LAYER)) {
    map.addLayer({
      id: POINT_LAYER,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 6,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });
  }
}

/** Hover popup: localized city name + event count (reads i18n at hover time). */
function bindHover(map: maplibregl.Map) {
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'alert-popup',
  });
  const show = (e: maplibregl.MapLayerMouseEvent) => {
    const props = e.features?.[0]?.properties;
    const name = props?.name;
    if (typeof name !== 'string') return;
    const count = typeof props?.count === 'number' ? props.count : 0;
    map.getCanvas().style.cursor = 'pointer';
    const display = escapeHtml(localizeCityName(name, i18n.language));
    const countLabel = escapeHtml(i18n.t('analytics.heatmap.alertsCount', { count }));
    popup
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="alert-popup__name">${display}</div><div class="alert-popup__row">${countLabel}</div>`,
      )
      .addTo(map);
  };
  const hide = () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  };
  for (const layer of [FILL_LAYER, POINT_LAYER]) {
    map.on('mousemove', layer, show);
    map.on('mouseleave', layer, hide);
  }
}

interface AnalyticsHeatMapProps {
  /** The filtered window's events (drives counts + colors). */
  events: AlertEvent[];
  cityCoords: CityCoords;
  className?: string;
}

/**
 * City-gradient heat map: every affected city drawn with its geocoded shape
 * (or bundled fallback circle), colored green -> yellow -> red by how many
 * events hit it in the filtered window.
 */
export function AnalyticsHeatMap({ events, cityCoords, className }: AnalyticsHeatMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const { resolvedTheme } = useTheme();
  const { i18n: i18nHook } = useTranslation();
  const basemap = useBasemapStore((s) => s.basemap);

  const heat = useMemo(() => buildHeatData(events), [events]);
  const collection = useMemo(
    () => buildHeatFeatureCollection(events, cityCoords, heat),
    [events, cityCoords, heat],
  );

  const collectionRef = useRef<CityFeatureCollection>(collection);
  collectionRef.current = collection;

  function addSource(map: maplibregl.Map) {
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: 'geojson', data: collectionRef.current });
    }
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensureRtlTextPlugin();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getBasemapStyle(basemap, resolvedTheme, i18nHook.language),
      center: CONFIG.MAP_CENTER,
      zoom: CONFIG.MAP_ZOOM,
      minZoom: CONFIG.MAP_MIN_ZOOM,
      maxZoom: getBasemapMaxZoom(basemap),
      maxBounds: CONFIG.MAP_MAX_BOUNDS,
      attributionControl: { compact: true, customAttribution: MAPLIBRE_ATTRIBUTION },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

    map.on('load', () => {
      addSource(map);
      addLayers(map);
      bindHover(map);
      readyRef.current = true;
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap basemap on theme/basemap/language change, re-adding source + layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setMaxZoom(getBasemapMaxZoom(basemap));
    map.setStyle(getBasemapStyle(basemap, resolvedTheme, i18nHook.language), { diff: false });
    map.once('styledata', () => {
      addSource(map);
      addLayers(map);
    });
  }, [basemap, resolvedTheme, i18nHook.language]);

  // Push new heat data whenever the filtered window changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(collection);
  }, [collection]);

  return (
    <div className={cn('relative overflow-hidden rounded-xl border', className)}>
      <div ref={containerRef} className="h-full w-full" />
      <HeatLegend max={heat.max} />
    </div>
  );
}
