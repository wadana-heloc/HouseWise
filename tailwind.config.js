// // /** @type {import('tailwindcss').Config} */
// // module.exports = {
// //   content: [
// //     './app/**/*.{js,jsx,ts,tsx}',
// //     './components/**/*.{js,jsx,ts,tsx}',
// //   ],
// //   presets: [require('nativewind/preset')],
// //   theme: {
// //     extend: {
// //       colors: {
// //         primary: '#2D6A4F',
// //         'primary-light': '#52B788',
// //         'primary-dark': '#1B4332',
// //         accent: '#F4A261',
// //         danger: '#E76F51',
// //         warning: '#F4A261',
// //         success: '#52B788',
// //         surface: '#F8F9FA',
// //         border: '#DEE2E6',
// //       },
// //       fontFamily: {
// //         sans: ['System'],
// //       },
// //     },
// //   },
// //   plugins: [],
// // };
// /** @type {import('tailwindcss').Config} */
// module.exports = {
//   content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
//   presets: [require('nativewind/preset')],
//   theme: {
//     extend: {
//       colors: {
//         teal: {
//           50:  '#E1F5EE',
//           400: '#5DCAA5',
//           600: '#1D9E75',
//           800: '#0F6E56',
//         },
//         bg: {
//           primary:   '#F5F7F5',
//           secondary: '#FFFFFF',
//         },
//         border: {
//           DEFAULT: '#D6EDE5',
//         },
//         text: {
//           primary:   '#0D2D1F',
//           secondary: '#3D6B55',
//           muted:     '#7AAA96',
//           faint:     '#A8C4B8',
//         },
//       },
//       fontFamily: {
//         display: ['Georgia', 'serif'],
//         body:    ['System'],
//       },
//       borderRadius: {
//         sm: '8px',
//         md: '12px',
//         lg: '14px',
//         xl: '24px',
//       },
//     },
//   },
//   plugins: [],
// };
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './constants/**/*.{js,ts,jsx,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {

      // ─── Colors ───────────────────────────────────────────────────────────
      colors: {

        // Primary brand — teal green
        teal: {
          50:  '#E1F5EE',   // bg-teal-50  → icon backgrounds, light fills
          100: '#C3EBD9',   // bg-teal-100 → hover states
          400: '#5DCAA5',   // bg-teal-400 → accents
          600: '#1D9E75',   // bg-teal-600 → buttons, logo, active nav  ← MAIN
          800: '#0F6E56',   // bg-teal-800 → pressed / dark variant
        },

        // Page & surface backgrounds
        bg: {
          primary:   '#F5F7F5',  // bg-bg-primary   → page background
          secondary: '#FFFFFF',  // bg-bg-secondary  → card surface
        },

        // Borders
        border: '#D6EDE5',       // border-border → all card / input borders

        // Text scale
        text: {
          primary:   '#0D2D1F',  // text-text-primary   → headings, item names
          secondary: '#3D6B55',  // text-text-secondary → body text
          muted:     '#7AAA96',  // text-text-muted     → labels, subtitles
          faint:     '#A8C4B8',  // text-text-faint     → placeholders, meta
        },

        // Semantic — status & alerts
        amber: {
          50:  '#FFFBEB',
          100: '#FEF3C7',
          400: '#FBBF24',
          700: '#B45309',
          800: '#92400E',
        },
        red: {
          50:  '#FEF2F2',
          100: '#FEE2E2',
          500: '#EF4444',
          700: '#B91C1C',
        },
        green: {
          50:  '#F0FDF4',
          100: '#DCFCE7',
          600: '#16A34A',
          700: '#15803D',
        },
      },

      // ─── Border radius ─────────────────────────────────────────────────────
      borderRadius: {
        sm:    '8px',    // rounded-sm   → tags, pills
        md:    '12px',   // rounded-md   → inputs, small cards
        lg:    '14px',   // rounded-lg   → buttons, cards      ← most common
        xl:    '20px',   // rounded-xl   → large cards
        '2xl': '24px',   // rounded-2xl  → greeting card, modals
        full:  '9999px', // rounded-full → avatars, member chips
      },

      // ─── Font family ────────────────────────────────────────────────────────
      fontFamily: {
        display: ['Georgia', 'serif'],      // font-display → app name, big titles
        body:    ['System', 'sans-serif'],  // font-body    → everything else
      },

      // ─── Font sizes (pixel-precise for mobile) ───────────────────────────
      fontSize: {
        '10': ['10px', { lineHeight: '14px' }],
        '11': ['11px', { lineHeight: '16px' }],
        '12': ['12px', { lineHeight: '18px' }],
        '13': ['13px', { lineHeight: '20px' }],
        '14': ['14px', { lineHeight: '22px' }],
        '15': ['15px', { lineHeight: '22px' }],
        '16': ['16px', { lineHeight: '24px' }],
        '17': ['17px', { lineHeight: '24px' }],
        '18': ['18px', { lineHeight: '26px' }],
        '20': ['20px', { lineHeight: '28px' }],
        '22': ['22px', { lineHeight: '30px' }],
        '24': ['24px', { lineHeight: '32px' }],
        '26': ['26px', { lineHeight: '34px' }],
        '28': ['28px', { lineHeight: '36px' }],
        '32': ['32px', { lineHeight: '40px' }],
        '36': ['36px', { lineHeight: '44px' }],
      },

      // ─── Spacing ────────────────────────────────────────────────────────────
      spacing: {
        '0.5':  '2px',
        '1':    '4px',
        '1.5':  '6px',
        '2':    '8px',
        '2.5':  '10px',
        '3':    '12px',
        '3.5':  '14px',
        '4':    '16px',
        '5':    '20px',
        '6':    '24px',
        '7':    '28px',
        '8':    '32px',
        '10':   '40px',
        '12':   '48px',
        '14':   '56px',
        '16':   '64px',
        '20':   '80px',
        '24':   '96px',
      },

      // ─── Shadows ────────────────────────────────────────────────────────────
      boxShadow: {
        'teal-sm': '0 4px 12px rgba(29, 158, 117, 0.20)',
        'teal-md': '0 8px 24px rgba(29, 158, 117, 0.28)',
        'card':    '0 2px 8px  rgba(0, 0, 0, 0.04)',
        'none':    'none',
      },
    },
  },
  plugins: [],
};