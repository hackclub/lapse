import fs from "fs";
import path from "path";
import type { NextConfig } from "next";
import type { Configuration } from "webpack";
import { withSentryConfig } from "@sentry/nextjs/config";

import { OPTIMIZED_IMAGE_HOSTS } from "./src/remoteImages";
import { SENTRY_DSN, sentrySecurityReportUrl } from "./src/sentryDsn";

const root = path.resolve(__dirname, "..", "..");

const CSP_REPORT_URL = sentrySecurityReportUrl(SENTRY_DSN);

// The session token lives in `localStorage`, so any script running on this origin owns the account. These
// directives can't break a page that loads its scripts the normal way, so they are enforced.
const ENFORCED_CSP = [
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

// The policy we want to enforce once Sentry shows it breaks nothing: scripts only from our own origin (the
// client has no inline scripts), plus WebAssembly and blob workers for the recorder and legacy recovery.
const REPORT_ONLY_CSP = [
  "script-src 'self' 'wasm-unsafe-eval' blob: 'report-sample'",
  "worker-src 'self' blob:",
  ...ENFORCED_CSP,
  ...(CSP_REPORT_URL ? [`report-uri ${CSP_REPORT_URL}`] : []),
];

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

  // Remote images (timelapse thumbnails, avatars) are only optimized on Vercel, where the optimizer doesn't run in our
  // process. On the standalone Node server, resizing them with `sharp` could exceed the pod's memory limit, so there
  // we neither request optimization for them (see `isOptimizableImage`) nor allow any remote hosts, which keeps
  // `/_next/image` limited to our own static images, exactly as before.
  env: {
    LAPSE_OPTIMIZE_REMOTE_IMAGES: process.env.VERCEL ? "true" : "false",
  },
  images: {
    remotePatterns: process.env.VERCEL
      ? OPTIMIZED_IMAGE_HOSTS.map(hostname => ({ protocol: "https" as const, hostname, pathname: "/**" }))
      : [],
  },

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
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Content-Security-Policy",
            value: ENFORCED_CSP.join("; "),
          },
        ],
      },
      {
        // Everywhere except the publish panel: the Lookout desktop app embeds it, and its URL carries the panel token,
        // which violation reports would otherwise send to Sentry.
        source: "/((?!lookout/panel/).*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Content-Security-Policy-Report-Only",
            value: REPORT_ONLY_CSP.join("; "),
          },
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
