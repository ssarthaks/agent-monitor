import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        base: "#ffffff",
        charcoal: {
          DEFAULT: "#121212",
          surface: "#1a1a1a",
          subtle: "#262626",
          muted: "#595959",
          faint: "#8c8c8c",
        },
        tangerine: {
          DEFAULT: "#ff5a00",
          hover: "#e04f00",
          light: "#fff5f0",
          border: "#ffd2be",
        },
        surface: {
          DEFAULT: "#ffffff",
          muted: "#f9fafb",
          elevated: "#f3f4f6",
          border: "#e5e7eb",
          dark: "#121212",
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          '"Fira Code"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};
export default config;
