import type { NextConfig } from "next";
import type { Configuration } from "webpack";
import TerserPlugin from "terser-webpack-plugin";
import { withPostHogConfig } from "@posthog/nextjs-config";

let config: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  productionBrowserSourceMaps: true,
  poweredByHeader: false,

  webpack: (config: Configuration, { isServer, dev }) => {
    if (!dev) {
      config.optimization = {
        ...config.optimization,
        minimizer: [
          new TerserPlugin({
            terserOptions: {
              mangle: false,
            },
          }),
        ],
      };
    }
    // Configure SVGR for SVG imports
    config.module!.rules!.push({
      test: /\.svg$/i,
      issuer: /\.[jt]sx?$/,
      use: ['@svgr/webpack'],
    });

    if (!isServer) {
      config.resolve!.fallback = {
        ...config.resolve!.fallback,
        fs: false,
        path: false,
        crypto: false,
        stream: false,
        util: false,
        buffer: false,
      };
    }
    
    return config;
  },

  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },

  // Required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,

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

if (process.env.POSTHOG_PERSONAL_API_KEY && process.env.POSTHOG_ENV_ID) {
  config = withPostHogConfig(config, {
    personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY,
    envId: process.env.POSTHOG_ENV_ID,
    host: "https://us.i.posthog.com",
    sourcemaps: {
      enabled: true,
      deleteAfterUpload: false
    }
  });
}

export default config;
