import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';
import { Clock, List } from 'lucide-react';
import { PageMetadata } from '@/components/shared/PageMetadata';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { AlertMap } from '@/components/map/AlertMap';
import { BasemapSwitcher } from '@/components/map/BasemapSwitcher';
import { AlertFeed } from '@/components/pages/home/AlertFeed';
import { ActiveAlertsBanner } from '@/components/pages/home/ActiveAlertsBanner';
import { TimelineBar } from '@/components/pages/home/timeline/TimelineBar';
import { CONFIG } from '@/data/config';
import { useAlertById } from '@/api/queries';
import { useFilteredAlertEvents } from '@/hooks/useFilteredAlertEvents';
import {
  BASE_INSET_PX,
  CONTROL_ROW_PX,
  SELECTED_POPUP_CLEARANCE_PX,
  useMapOverlayBottomInset,
} from '@/hooks/useMapOverlayBottomInset';
import { useSelectedEventUrlSync } from '@/hooks/useSelectedEventUrlSync';
import { useTimelineUrlSync } from '@/hooks/useTimelineUrlSync';
import { cn } from '@/lib/utils';
import { sortEventsByTime } from '@/lib/alerts/events';
import { mapCityKeys } from '@/lib/map/perCity';
import { buildAlertFeatureCollection, cityKey, unmatchedAlertNames } from '@/lib/geo';
import { buildCityMeta } from '@/lib/map/cityMeta';
import { useAlertsStore } from '@/store/alertsStore';
import { useTimelineStore } from '@/store/timelineStore';

export default function HomePage() {
  const { t, i18n } = useTranslation();
  const {
    feedEvents,
    mapEvents,
    activeEvents,
    cityCoords,
    dayEvents,
    isLoading,
    isError,
    refetch,
  } = useFilteredAlertEvents();
  const selectedEventId = useAlertsStore((s) => s.selectedEventId);
  const selectEvent = useAlertsStore((s) => s.selectEvent);
  const requestFocus = useAlertsStore((s) => s.requestFocus);
  const hasCustomRange = useTimelineStore((s) => s.hasCustomRange);
  const selectedDate = useTimelineStore((s) => s.selectedDate);
  const bottomInsetPx = useMapOverlayBottomInset();
  const timelineOpen = useTimelineStore((s) => s.isOpen);
  const openTimeline = useTimelineStore((s) => s.openTimeline);

  useTimelineUrlSync();
  const hydratedEventId = useSelectedEventUrlSync();

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const feedCopy = useMemo(() => {
    if (!hasCustomRange) {
      return {
        feedTitle: t('home.feedTitle24h'),
        feedSubtitle: t('home.feedSubtitleDefault', {
          minutes: CONFIG.ACTIVE_ALERT_WINDOW_MINUTES,
        }),
        feedEmpty: t('home.feedEmpty24h'),
      };
    }
    return {
      feedTitle: t('home.feedTitleDay', { date: selectedDate }),
      feedSubtitle: t('home.feedSubtitleDay'),
      feedEmpty: t('home.feedEmptyDay'),
    };
  }, [hasCustomRange, selectedDate, t]);

  /** A shared `?event=` link can point outside every loaded window - fetch by
   *  id only then (normal clicks always resolve from the loaded lists). */
  const inLoadedLists = useMemo(
    () =>
      Boolean(selectedEventId) &&
      (feedEvents.some((e) => e.id === selectedEventId) ||
        mapEvents.some((e) => e.id === selectedEventId)),
    [selectedEventId, feedEvents, mapEvents],
  );
  const byIdQuery = useAlertById(selectedEventId, !inLoadedLists);

  /** Feed selection can point at an event outside the default 5-min map window. */
  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return (
      feedEvents.find((e) => e.id === selectedEventId) ??
      mapEvents.find((e) => e.id === selectedEventId) ??
      byIdQuery.data?.events.find((e) => e.id === selectedEventId) ??
      null
    );
  }, [selectedEventId, feedEvents, mapEvents, byIdQuery.data]);

  // A shared link to an event that no longer exists: drop the selection (the
  // URL param cleans itself up via the sync hook).
  useEffect(() => {
    if (byIdQuery.isError && isAxiosError(byIdQuery.error) && byIdQuery.error.response?.status === 404) {
      selectEvent(null);
    }
  }, [byIdQuery.isError, byIdQuery.error, selectEvent]);

  // Focus the map/feed ONCE on the event a shared URL pointed at, as soon as
  // its data resolves (from the loaded windows or the by-id fetch).
  const focusedFromUrl = useRef(false);
  useEffect(() => {
    if (focusedFromUrl.current || !hydratedEventId) return;
    if (!selectedEvent || selectedEvent.id !== hydratedEventId) return;
    focusedFromUrl.current = true;
    const firstCity = selectedEvent.cities[0];
    if (firstCity) requestFocus(firstCity.name, selectedEvent.id);
  }, [hydratedEventId, selectedEvent, requestFocus]);

  const displayMapEvents = useMemo(() => {
    if (!selectedEvent || mapEvents.some((e) => e.id === selectedEvent.id)) return mapEvents;
    return [...mapEvents, selectedEvent];
  }, [mapEvents, selectedEvent]);

  /** Show a shared out-of-window event in the feed too, in time order. */
  const displayFeedEvents = useMemo(() => {
    if (!selectedEvent || feedEvents.some((e) => e.id === selectedEvent.id)) return feedEvents;
    return sortEventsByTime([...feedEvents, selectedEvent]);
  }, [feedEvents, selectedEvent]);

  /** Polygons for a shared event's cities when outside the loaded windows. */
  const mergedCityCoords = useMemo(() => {
    const byIdCities = byIdQuery.data?.cities;
    if (!byIdCities?.length) return cityCoords;
    const map = new Map(cityCoords);
    for (const city of byIdCities) {
      if (!map.has(city.id)) map.set(city.id, city.coordinates);
    }
    return map;
  }, [cityCoords, byIdQuery.data]);

  const cityMeta = useMemo(
    () => buildCityMeta(displayMapEvents, i18n.language),
    [displayMapEvents, i18n.language],
  );

  const featureCollection = useMemo(() => {
    const colors: Record<string, string> = {};
    for (const [key, meta] of Object.entries(cityMeta)) colors[key] = meta.color;
    return buildAlertFeatureCollection(displayMapEvents, mergedCityCoords, colors);
  }, [displayMapEvents, mergedCityCoords, cityMeta]);

  const activeKeys = useMemo(() => mapCityKeys(activeEvents), [activeEvents]);
  const recentKeys = useMemo(() => mapCityKeys(mapEvents), [mapEvents]);
  const selectedKeys = useMemo(() => {
    if (!selectedEvent) return [];
    return Array.from(new Set(selectedEvent.cities.map((c) => cityKey(c.name))));
  }, [selectedEvent]);
  /** Draw feed-selected cities even when outside the live map window. */
  const displayRecentKeys = useMemo(() => {
    const keys = new Set(recentKeys);
    for (const key of selectedKeys) keys.add(key);
    return Array.from(keys);
  }, [recentKeys, selectedKeys]);

  const unmatchedActive = useMemo(
    () => unmatchedAlertNames(activeEvents, cityCoords),
    [activeEvents, cityCoords],
  );

  const feedProps = {
    events: displayFeedEvents,
    isLoading,
    isError,
    onRetry: refetch,
    ...feedCopy,
  };

  // Overlay offsets from the bottom edge. With the timeline closed they sit on
  // the safe area (above the iOS home indicator in the Home Screen web app; the
  // inset is 0 elsewhere); with it open they are measured from the panel, whose
  // height already includes that inset.
  const fromBottom = (px: number) =>
    timelineOpen ? `${px}px` : `calc(${px}px + env(safe-area-inset-bottom))`;
  const overlayBottom = fromBottom(bottomInsetPx);
  // Nudge the basemap picker up when a city/event is selected so the
  // MapLibre popup near the bottom of the map isn't hidden behind it.
  const basemapBottom = selectedEventId
    ? fromBottom(bottomInsetPx + SELECTED_POPUP_CLEARANCE_PX)
    : overlayBottom;
  // Mobile bottom control row, and the MapLibre attribution one row above it
  // (consumed by the mobile attribution rule in index.css).
  const mobileClusterBottomPx = timelineOpen
    ? bottomInsetPx
    : selectedEventId
      ? SELECTED_POPUP_CLEARANCE_PX
      : BASE_INSET_PX;
  const attribBottom = fromBottom(mobileClusterBottomPx + CONTROL_ROW_PX);

  return (
    <div
      className="relative h-full w-full"
      style={{ '--map-attrib-bottom': attribBottom } as CSSProperties}
    >
      <PageMetadata title={t('home.title')} />

      <AlertMap
        featureCollection={featureCollection}
        activeKeys={activeKeys}
        recentKeys={displayRecentKeys}
        selectedKeys={selectedKeys}
        cityMeta={cityMeta}
        onSelectEvent={selectEvent}
      />

      <ActiveAlertsBanner activeCount={activeEvents.length} />

      <Card
        variant="overlay"
        className="absolute end-3 top-20 z-20 hidden w-[clamp(320px,26vw,460px)] flex-col gap-0 overflow-hidden py-0 shadow-xl sm:end-4 2xl:w-[clamp(360px,22vw,520px)] md:flex"
        style={{ bottom: overlayBottom }}
      >
        <AlertFeed {...feedProps} />
      </Card>

      {/* Mobile controls (md:hidden): history (left) + active alerts (right) sit
          on the bottom row; the layers picker sits above history on the left,
          and the map attribution is lifted to the matching spot on the right
          (see the mobile rule in index.css). When the timeline opens, history is
          replaced by the panel and the remaining controls float just above it. */}
      <div
        className="pointer-events-none absolute inset-x-0 z-20 flex items-end justify-between px-3 md:hidden transition-[bottom] duration-200"
        style={{ bottom: fromBottom(mobileClusterBottomPx) }}
      >
        <div className="flex flex-col items-start gap-2">
          <BasemapSwitcher />
          {!timelineOpen && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              floating
              className="pointer-events-auto"
              onClick={openTimeline}
            >
              <Clock className="size-4" />
              {t('timeline.open')}
            </Button>
          )}
        </div>

        <Sheet>
          <SheetTrigger asChild>
            <Button
              size="lg"
              floating
              variant={activeEvents.length === 0 ? 'success' : 'default'}
              className={cn(
                'pointer-events-auto',
                activeEvents.length > 0 && 'alert-pulse',
              )}
            >
              <List className="size-4" />
              {t('home.activeNow', { count: activeEvents.length })}
            </Button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="h-[min(80svh,40rem)] p-0 pb-[env(safe-area-inset-bottom)]"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{feedCopy.feedTitle}</SheetTitle>
            </SheetHeader>
            <AlertFeed {...feedProps} />
          </SheetContent>
        </Sheet>
      </div>

      {unmatchedActive.length > 0 && (
        <Card
          variant="overlay"
          size="xs"
          className="absolute start-3 z-20 max-w-[min(100%,18rem)] py-2 text-xs text-muted-foreground sm:start-4 sm:max-w-xs"
          style={{ bottom: overlayBottom }}
        >
          <CardContent>{t('map.unmatched')}</CardContent>
        </Card>
      )}

      {/* Desktop basemap picker — bottom-start corner. Mobile uses the cluster above. */}
      <div
        className="pointer-events-none absolute start-3 z-20 hidden sm:start-4 md:block transition-[bottom] duration-200"
        style={{ bottom: basemapBottom }}
      >
        <BasemapSwitcher />
      </div>

      <TimelineBar dayEvents={dayEvents} />
    </div>
  );
}
