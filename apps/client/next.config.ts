import fs from "fs";
import path from "path";
import type { NextConfig } from "next";
import type { Configuration } from "webpack";
import { withSentryConfig } from "@sentry/nextjs/config";

const root = path.resolve(__dirname, "..", "..");

function resolveSquircle(): Record<string, string> {
  const candidates = [
    path.join(root, "vendor", "lookout", "node_modules", "@squircle-js", "react", "dist", "index.mjs"),
    path.join(root, "vendor", "lookout", "clients", "react", "node_modules", "@squircle-js", "react", "dist", "index.mjs"),
  ];

  // Also check the pnpm store
  const pnpmDir = path.join(root, "node_modules", ".pnpm");
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (entry.startsWith("@squircle-js+react@")) {
        candidates.push(path.join(pnpmDir, entry, "node_modules", "@squircle-js", "react", "dist", "index.mjs"));
      }
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { "@squircle-js/react": candidate };
    }
  }

  return {};
}

const config: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@lookout/react", "@squircle-js/react"],
  productionBrowserSourceMaps: true,
  poweredByHeader: false,

  webpack: (config: Configuration) => {
    // Configure SVGR for SVG imports
    config.module!.rules!.push({
      test: /\.svg$/i,
      issuer: /\.[jt]sx?$/,
      use: ['@svgr/webpack'],
    });

    // Force a single copy of React for linked packages (vendor/lookout)
    const reactDir = path.dirname(require.resolve("react/package.json"));
    const reactDomDir = path.dirname(require.resolve("react-dom/package.json"));
    config.resolve!.alias = {
      ...config.resolve!.alias,
      react: reactDir,
      "react-dom": reactDomDir,
      "react/jsx-runtime": path.join(reactDir, "jsx-runtime"),
      "react/jsx-dev-runtime": path.join(reactDir, "jsx-dev-runtime"),
      ...resolveSquircle(),
    };

    return config;
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "unsafe-none",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          }
        ],
      },
    ];
  },
};

// Source maps are already public (`productionBrowserSourceMaps`), so uploading them is only a nicety - it
// happens when a build has SENTRY_AUTH_TOKEN, and is skipped otherwise.
export default withSentryConfig(config, {
  org: "hack-club",
  project: "lapse-client",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
});
