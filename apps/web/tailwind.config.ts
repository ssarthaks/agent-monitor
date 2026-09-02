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
        alabaster: {
          DEFAULT: "#FAFAFA",
          surface: "#FFFFFF",
          muted: "#F4F4F6",
          elevated: "#EEEEF1",
          border: "#E2E4E9",
          borderDark: "#D0D3DB",
        },
        ink: {
          DEFAULT: "#2B2D42",
          dark: "#202232",
          surface: "#353852",
          muted: "#5D617A",
          faint: "#8D92A8",
        },
        terracotta: {
          DEFAULT: "#D46A43",
          hover: "#E27D60",
          light: "#FDF3EF",
          border: "#F7CABA",
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
