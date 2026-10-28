/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#08090A',
        graphite: '#0F1113',
        panel: '#14171A',
        raised: '#1B1F23',
        hairline: '#252A30',
        ink: '#EDEFF2',
        muted: '#858D97',
        faint: '#5A626C',
        signal: '#79A9FF',
        moss: '#3FB68B',
        clay: '#DC5F52',
        amber: '#D8A13A',
        halt: '#E0483C',
      },
      fontFamily: {
        sans: ['"Inter Tight"', 'Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Cascadia Mono', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['10.5px', '14px'],
        xs: ['11.5px', '16px'],
        sm: ['12.5px', '18px'],
        base: ['13.5px', '20px'],
      },
      borderRadius: { xs: '4px', DEFAULT: '6px', md: '8px', lg: '11px', xl: '14px' },
      transitionTimingFunction: { swift: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    },
  },
  plugins: [],
};
