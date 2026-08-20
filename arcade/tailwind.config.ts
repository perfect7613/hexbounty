import type { Config } from "tailwindcss";

const config: Config = {
  important: true,
  corePlugins: {
    preflight: false,
  },
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./node_modules/pixel-retroui/dist/**/*.js",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
