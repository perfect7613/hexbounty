import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    "**/* [0-9].*",
    "**/* [0-9]",
  ]),
  {
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  {
    files: ["components/player/game-boy-player.tsx"],
    rules: {
      // Reused emulator player mutates Game Boy input registers from pointer
      // handlers. React 19 compiler lint treats that as render-time ref access.
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
    },
  },
]);

export default eslintConfig;
