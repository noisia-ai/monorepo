import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        ink: "var(--ink)",
        signal: "var(--signal)",
        tension: "var(--tension)",
        positive: "var(--positive)"
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"]
      },
      borderRadius: {
        noisia: "var(--radius-lg)",
        pill: "var(--radius-pill)"
      }
    }
  },
  plugins: []
};

export default config;
