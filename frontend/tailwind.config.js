/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Mirrors Telegram's theme variables so the Mini App blends with the
        // user's chosen Telegram theme (see src/lib/telegram.ts).
        background: 'var(--tg-theme-bg-color, #ffffff)',
        foreground: 'var(--tg-theme-text-color, #000000)',
        primary: {
          DEFAULT: 'var(--tg-theme-button-color, #2481cc)',
          foreground: 'var(--tg-theme-button-text-color, #ffffff)',
        },
        muted: {
          DEFAULT: 'var(--tg-theme-secondary-bg-color, #f4f4f5)',
          foreground: 'var(--tg-theme-hint-color, #707579)',
        },
        accent: {
          DEFAULT: 'var(--tg-theme-link-color, #2481cc)',
          foreground: 'var(--tg-theme-button-text-color, #ffffff)',
        },
        border: 'var(--tg-theme-section-separator-color, #e4e4e7)',
      },
      borderRadius: {
        lg: '0.75rem',
        md: '0.5rem',
        sm: '0.375rem',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
