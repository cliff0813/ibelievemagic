import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50: "#eef6ff", 100: "#d9eaff", 500: "#2563eb", 600: "#1d4ed8", 700: "#1e40af", 900: "#0f1f4d" },
        gold: { 500: "#c9a24b" },
      },
      fontFamily: { sans: ['"Noto Sans TC"', "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
