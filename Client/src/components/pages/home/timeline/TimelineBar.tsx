import { useEffect, useRef } from 'react';
import { Clock, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  formatIsraelClock,
  israelMinutesFromMidnight,
} from '@/lib/israelTime';
import { cn } from '@/lib/utils';
import { useTimelineStore } from '@/store/timelineStore';
import type { TimelineBarProps } from '@/types/ui';
import { DatePickerControl } from './DatePickerControl';
import { DayScrubber } from './DayScrubber';

export function TimelineBar({ dayEvents }: TimelineBarProps) {
  const { t, i18n } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const isOpen = useTimelineStore((s) => s.isOpen);
  const openTimeline = useTimelineStore((s) => s.openTimeline);
  const closeTimeline = useTimelineStore((s) => s.closeTimeline);
  const setPanelHeightPx = useTimelineStore((s) => s.setPanelHeightPx);
  const hasCustomRange = useTimelineStore((s) => s.hasCustomRange);
  const rangeStartMs = useTimelineStore((s) => s.rangeStartMs);
  const rangeEndMs = useTimelineStore((s) => s.rangeEndMs);
  const clearRange = useTimelineStore((s) => s.clearRange);

  const rangeLabel = hasCustomRange
    ? `${formatIsraelClock(israelMinutesFromMidnight(new Date(rangeStartMs)), i18n.language)} – ${formatIsraelClock(israelMinutesFromMidnight(new Date(rangeEndMs)), i18n.language)}`
    : t('timeline.noRange');

  useEffect(() => {
    if (!isOpen) {
      setPanelHeightPx(0);
      return;
    }
    const el = panelRef.current;
    if (!el) return;

    const report = () => setPanelHeightPx(el.getBoundingClientRect().height);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => {
      ro.disconnect();
      setPanelHeightPx(0);
    };
  }, [isOpen, setPanelHeightPx]);

  if (!isOpen) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 hidden justify-center md:flex">
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
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className={cn(
        // pb: the panel reaches the bottom edge, its content stays above the
        // home indicator. The measured height includes it (see HomePage).
        'absolute inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-lg backdrop-blur-md',
        'max-h-[50svh] md:max-h-none',
      )}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-3 py-3 sm:gap-3 sm:px-4 2xl:max-w-screen-xl">
        <div className="flex items-center justify-between gap-2">
          <DatePickerControl />
          <div className="flex shrink-0 items-center gap-1">
            {hasCustomRange && (
              <Button type="button" variant="ghost" size="sm" onClick={clearRange}>
                {t('timeline.clearRange')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={closeTimeline}
            >
              <X className="size-4" />
              <span className="hidden sm:inline">{t('timeline.backToLive')}</span>
            </Button>
          </div>
        </div>
        {hasCustomRange && (
          <p className="text-sm font-medium text-foreground">
            {/* Times are a LTR run even in Hebrew — the isolate stops the bidi
                algorithm from flipping "09:36 – 10:36". */}
            <span dir="ltr" className="font-mono tabular-nums">
              {rangeLabel}
            </span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t('timeline.dragHint')}</p>
        <DayScrubber dayEvents={dayEvents} />
      </div>
    </div>
  );
}
