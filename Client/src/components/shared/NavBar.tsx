import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart3, Map as MapIcon, MapPin, TriangleAlert } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { ROUTES, pathTo } from '@/router/routes';
import { isLocalhost } from '@/lib/env';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher';
import { ModeToggle } from '@/components/shared/ModeToggle';
import { LiveIndicator } from '@/components/shared/LiveIndicator';

export function NavBar() {
  const { t } = useTranslation();
  const { language } = useLanguage();

  const links = [
    { to: pathTo(ROUTES.HOME, language), label: t('nav.home'), icon: MapIcon, end: true },
    { to: pathTo(ROUTES.ANALYTICS, language), label: t('nav.analytics'), icon: BarChart3, end: false },
    // Local-only geocoding correction tool (hidden in the deployed site).
    ...(isLocalhost()
      ? [{ to: pathTo(ROUTES.ADMIN_GEO, language), label: 'Geo', icon: MapPin, end: false }]
      : []),
  ];

  return (
    // In the Home Screen web app the page draws under the status bar: the top
    // inset extends the bar behind it (0 everywhere else).
    <header className="z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between gap-2 border-b bg-background/80 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-md sm:px-4">
      <div className="flex min-w-0 items-center gap-2 sm:gap-6">
        <NavLink to={pathTo(ROUTES.HOME, language)} className="flex min-w-0 shrink items-center gap-1.5 sm:gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <TriangleAlert className="size-4" />
          </span>
          {/* Icon-only below 380px — a truncated "…lerts" looks broken. */}
          <span className="truncate font-display text-sm tracking-tight max-[379px]:hidden sm:text-base">
            {t('nav.brand')}
          </span>
        </NavLink>

        <nav className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors sm:px-3 sm:py-1.5',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <LiveIndicator />
        <LanguageSwitcher />
        <ModeToggle />
      </div>
    </header>
  );
}
