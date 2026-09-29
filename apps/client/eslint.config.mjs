// @ts-check

import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      semi: ["error", "always"],
      "brace-style": ["error", "stroustrup", { allowSingleLine: true }]
    }
  },
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "**/generated/**"]
  }
];

export default eslintConfig;
