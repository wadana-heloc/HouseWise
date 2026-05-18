/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#2D6A4F',
        'primary-light': '#52B788',
        'primary-dark': '#1B4332',
        accent: '#F4A261',
        danger: '#E76F51',
        warning: '#F4A261',
        success: '#52B788',
        surface: '#F8F9FA',
        border: '#DEE2E6',
      },
      fontFamily: {
        sans: ['System'],
      },
    },
  },
  plugins: [],
};
