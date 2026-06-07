import { useEffect } from 'react';
import { useThemeParams, useViewport } from '@tma.js/sdk-react';

// Mirrors Telegram's theme params onto CSS custom properties so Tailwind's
// `background` / `foreground` / `primary` / ... colors (see tailwind.config.js)
// automatically follow the user's Telegram theme (light/dark/custom).
export function useTelegramTheme() {
  const themeParams = useThemeParams();
  const viewport = useViewport();

  useEffect(() => {
    const root = document.documentElement;
    const vars: Record<string, string | undefined> = {
      '--tg-theme-bg-color': themeParams.backgroundColor,
      '--tg-theme-text-color': themeParams.textColor,
      '--tg-theme-hint-color': themeParams.hintColor,
      '--tg-theme-link-color': themeParams.linkColor,
      '--tg-theme-button-color': themeParams.buttonColor,
      '--tg-theme-button-text-color': themeParams.buttonTextColor,
      '--tg-theme-secondary-bg-color': themeParams.secondaryBackgroundColor,
    };
    for (const [key, value] of Object.entries(vars)) {
      if (value) root.style.setProperty(key, value);
    }
  }, [themeParams]);

  useEffect(() => {
    viewport?.expand();
  }, [viewport]);
}
