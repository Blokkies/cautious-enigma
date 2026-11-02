import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // New in eslint-plugin-react-hooks v7. Flags the existing "fetch on mount" effects
      // across the app; kept visible as a warning rather than rewriting working loaders.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "dist/**", "public/sw.js", "next-env.d.ts"],
  },
];

export default config;
