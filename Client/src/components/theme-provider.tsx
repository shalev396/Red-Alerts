import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import { useEffect, type ComponentProps } from 'react';

type ThemeProviderProps = ComponentProps<typeof NextThemesProvider>;

const THEME_STORAGE_KEY = 'red-alerts-theme';
/** Hex of --background in index.css; browsers and the Home Screen web app tint system UI with it. */
const THEME_COLOR: Record<string, string> = {
  light: '#ffffff',
  dark: '#0a0a0a',
};
/** Bump when a one-time theme reset should apply to all returning visitors. */
const THEME_RESET_VERSION = 'v2';

/** One-time: default everyone to dark (drops legacy system/light defaults). */
function migrateStoredTheme(): void {
  try {
    const resetKey = `${THEME_STORAGE_KEY}-reset-${THEME_RESET_VERSION}`;
    if (localStorage.getItem(resetKey)) return;
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem(resetKey, '1');
  } catch {
    // localStorage unavailable (SSR / privacy mode) — ignore
  }
}

/** Keeps <meta name="theme-color"> on the resolved theme's page background. */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const color = resolvedTheme ? THEME_COLOR[resolvedTheme] : undefined;
    if (!color) return;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', color);
  }, [resolvedTheme]);

  return null;
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  useEffect(() => {
    migrateStoredTheme();
  }, []);

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      storageKey={THEME_STORAGE_KEY}
      disableTransitionOnChange
      {...props}
    >
      <ThemeColorSync />
      {children}
    </NextThemesProvider>
  );
}
