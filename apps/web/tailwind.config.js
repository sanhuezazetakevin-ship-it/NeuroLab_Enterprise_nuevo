/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        // Escala mínima legible: 11 px solo metadatos, 12 px etiquetas, 14 px contenido.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        'xs': ['0.75rem', { lineHeight: '1.05rem' }],
        'sm': ['0.875rem', { lineHeight: '1.3rem' }],
        'base': ['0.9375rem', { lineHeight: '1.45rem' }],
      },
      colors: {
        glass: {
          50: 'rgba(255, 255, 255, 0.03)',
          100: 'rgba(255, 255, 255, 0.06)',
          200: 'rgba(255, 255, 255, 0.10)',
          300: 'rgba(255, 255, 255, 0.15)',
          400: 'rgba(255, 255, 255, 0.20)',
          border: 'rgba(255, 255, 255, 0.08)',
          borderHover: 'rgba(255, 255, 255, 0.18)',
        },
        zinc: {
          850: '#1c1d22',
          900: '#14151a',
          925: '#0f1014',
          950: '#0a0a0d',
        },
        // Semántica de estado: verde = correcto, ámbar = advertencia, rojo = error.
        ok: {
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
        },
        warn: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
        danger: {
          400: '#fb7185',
          500: '#f43f5e',
          600: '#e11d48',
        },
        chart: {
          train: '#38bdf8',
          validation: '#fbbf24',
          best: '#34d399',
        },
        vengeance: {
          void: '#040507',
          obsidian: '#07080c',
          carbon: '#0c0d13',
          border: 'rgba(225, 29, 72, 0.25)',
          borderHover: 'rgba(244, 63, 94, 0.55)',
          glow: 'rgba(225, 29, 72, 0.40)',
          50: '#fff1f2',
          100: '#ffe4e6',
          200: '#fecdd3',
          300: '#fda4af',
          400: '#fb7185',
          500: '#f43f5e',
          600: '#e11d48',
          700: '#be123c',
          800: '#9f1239',
          900: '#881337',
          950: '#4c0519',
        }
      },
      borderRadius: {
        'app-sm': '0.5rem',
        'app': '0.75rem',
        'app-lg': '1rem',
        'app-xl': '1.25rem',
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.45), inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
        'glass-hover': '0 16px 40px 0 rgba(0, 0, 0, 0.65), 0 0 20px -3px rgba(225, 29, 72, 0.25), inset 0 1px 0 0 rgba(255, 255, 255, 0.16)',
        'glass-sm': '0 4px 16px 0 rgba(0, 0, 0, 0.35), inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
        'glass-light': '0 8px 30px 0 rgba(0, 0, 0, 0.04), inset 0 1px 0 0 rgba(255, 255, 255, 0.95)',
        'glass-light-hover': '0 14px 35px 0 rgba(0, 0, 0, 0.08), inset 0 1px 0 0 rgba(255, 255, 255, 1)',
        'vengeance-glow': '0 0 25px 0 rgba(225, 29, 72, 0.4)',
        'vengeance-glow-lg': '0 0 45px 2px rgba(225, 29, 72, 0.35)',
        'vengeance-card': '0 12px 40px 0 rgba(0, 0, 0, 0.7), 0 0 18px -4px rgba(225, 29, 72, 0.18)',
        'focus': '0 0 0 3px rgba(244, 63, 94, 0.35)',
      },
      backdropBlur: {
        'xs': '2px',
        '2xl': '24px',
        '3xl': '32px',
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
