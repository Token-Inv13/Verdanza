import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        forest: "#0B3D2E",
        sage: "#8FA78B",
        champagne: "#C9A45C",
        cream: "#F5F0E6",
        ivory: "#FAF8F2",
        ink: "#111111",
      },
      fontFamily: {
        display: ["Cormorant Garamond", "Playfair Display", "Georgia", "serif"],
        sans: ["Inter", "Manrope", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 20px 60px rgba(11, 61, 46, 0.12)",
      },
    },
  },
  plugins: [],
} satisfies Config;
