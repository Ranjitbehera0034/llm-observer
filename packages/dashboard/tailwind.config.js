/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0B0D17', // Deep dark blue/black
        surface: '#1A1C29', // Slightly lighter surface
        surfaceHighlight: '#2A2C3C',
        primary: '#4F46E5', // Indigo-600
        primaryHover: '#6366F1', // Indigo-500
        accent: '#06B6D4', // Cyan-500
        textMain: '#F8FAFC', // Slate-50
        textMuted: '#94A3B8', // Slate-400
        success: '#10B981', // Emerald-500
        danger: '#EF4444', // Red-500
        warning: '#F59E0B', // Amber-500
        border: '#334155', // Slate-700
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.4s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        }
      }
    },
  },
  plugins: [],
}
