/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        guitar: {
          DEFAULT: "#f97316",
          light: "#fdba74",
          dark: "#c2410c",
        },
        reading: {
          DEFAULT: "#3b82f6",
          light: "#93c5fd",
          dark: "#1d4ed8",
        },
        leetcode: {
          DEFAULT: "#a855f7",
          light: "#d8b4fe",
          dark: "#7e22ce",
        },
        tasks: {
          DEFAULT: "#22c55e",
          light: "#86efac",
          dark: "#15803d",
        },
        // Mac OS X Aqua: light window chrome, white panels, dark ink.
        surface: {
          DEFAULT: "rgb(var(--c-surface) / <alpha-value>)",
          card: "rgb(var(--c-card) / <alpha-value>)",
          border: "rgb(var(--c-border) / <alpha-value>)",
          muted: "rgb(var(--c-muted) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--c-ink) / <alpha-value>)",
          soft: "rgb(var(--c-ink-soft) / <alpha-value>)",
        },
        aqua: {
          DEFAULT: "#3d86e0",
          light: "#8cc1ff",
          dark: "#1f5bb5",
        },
      },
      fontFamily: {
        sans: ['"Lucida Grande"', '"Lucida Sans Unicode"', '"Lucida Sans"', '"Helvetica Neue"', "Helvetica", "Arial", "sans-serif"],
      },
      keyframes: {
        slideIn: {
          "0%": { opacity: 0, transform: "translateX(24px)" },
          "100%": { opacity: 1, transform: "translateX(0)" },
        },
        pop: {
          "0%": { opacity: 0, transform: "scale(0.85)" },
          "60%": { opacity: 1, transform: "scale(1.06)" },
          "100%": { opacity: 1, transform: "scale(1)" },
        },
        fadeIn: {
          "0%": { opacity: 0, transform: "translateY(4px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        pop: "pop 0.28s ease-out",
        "slide-in": "slideIn 0.22s ease-out",
      },
    },
  },
  plugins: [],
};
