import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "oklch(87% 0.018 92)",
        panel: "oklch(98.6% 0.008 92)",
        ink: "oklch(24% 0.026 82)",
        muted: "oklch(50% 0.022 82)",
        accent: "oklch(53% 0.13 154)",
        warn: "oklch(67% 0.14 72)",
        danger: "oklch(55% 0.19 28)"
      },
      borderRadius: {
        ui: "8px"
      }
    },
  },
  plugins: [],
};

export default config;
