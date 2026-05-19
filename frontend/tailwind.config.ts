import type { Config } from "tailwindcss";

/**
 * Design tokens for the Flugia dashboard.
 *
 *   brand       — primary cyan-blue (logo, CTAs, active states).
 *   ink         — body text in three contrast levels.
 *   surface     — page + card backgrounds and hairline borders.
 *   accent.*    — metric-categorisation colours used on the company
 *                 detail page to give each metric a visual identity
 *                 (revenue = brand cyan, profit = emerald, equity =
 *                 violet, cash = sky, debt = orange, headcount = rose).
 *
 * Each accent has only the three tints we actually use (50 / 600 / 700)
 * to keep the palette focused and prevent ad-hoc inline hex values.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#EBF7FD",
          100: "#D2EEFB",
          200: "#A6DDF6",
          300: "#79CCF2",
          400: "#4DBBED",
          500: "#3CC0E9",
          600: "#0E9EC8",
          700: "#0B7FA0",
          800: "#085F78",
          900: "#053F50",
        },
        ink: {
          DEFAULT: "#0E1B33",
          subtle: "#475569",
          muted: "#94A3B8",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          page: "#F8FAFE",
          sub: "#F1F5F9",
          line: "#E2E8F0",
        },
        accent: {
          // Revenue / topline
          revenue: { 50: "#EBF7FD", 600: "#0E9EC8", 700: "#0B7FA0" },
          // Profit / margins
          profit: { 50: "#ECFDF5", 600: "#059669", 700: "#047857" },
          // Equity / capital
          equity: { 50: "#F5F3FF", 600: "#7C3AED", 700: "#6D28D9" },
          // Cash
          cash: { 50: "#EFF6FF", 600: "#2563EB", 700: "#1D4ED8" },
          // Debt / leverage
          debt: { 50: "#FFF7ED", 600: "#EA580C", 700: "#C2410C" },
          // Headcount / people
          people: { 50: "#FFF1F2", 600: "#E11D48", 700: "#BE123C" },
        },
      },
      backgroundImage: {
        // Sharper, more saturated hero with a hint of cyan-to-violet drift.
        "hero-gradient":
          "linear-gradient(135deg, #D5EEFB 0%, #E8F1FE 40%, #F5EEFD 100%)",
        // For accent cards: soft top-left tint to off-white.
        "card-tint-cyan":
          "linear-gradient(135deg, #EBF7FD 0%, #FFFFFF 60%)",
        "card-tint-emerald":
          "linear-gradient(135deg, #ECFDF5 0%, #FFFFFF 60%)",
        "card-tint-violet":
          "linear-gradient(135deg, #F5F3FF 0%, #FFFFFF 60%)",
        "card-tint-orange":
          "linear-gradient(135deg, #FFF7ED 0%, #FFFFFF 60%)",
        "card-tint-rose":
          "linear-gradient(135deg, #FFF1F2 0%, #FFFFFF 60%)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.04)",
        // Slightly deeper variant for interactive cards on hover.
        "card-lift":
          "0 4px 12px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.04)",
        // Glow for the brand CTA + active sidebar item.
        glow: "0 8px 24px -8px rgba(60, 192, 233, 0.45)",
      },
      borderRadius: {
        card: "16px",
      },
    },
  },
  plugins: [],
};

export default config;
