import type { NextConfig } from "next";
import type { Configuration } from "webpack";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack: (config: Configuration, { isServer, dev }) => {
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

      // Handle dynamic imports for FFmpeg
      config.module!.rules!.push({
        test: /\.js$/,
        include: /node_modules\/@ffmpeg/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-env"],
            plugins: ["@babel/plugin-syntax-dynamic-import"]
          }
        }
      });
    }

    // Handle WASM files
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Ignore FFmpeg dynamic import warnings in development
    if (dev) {
      config.ignoreWarnings = [
        ...(config.ignoreWarnings || []),
        { message: /Failed to parse source map/ },
        { message: /Cannot find module as expression is too dynamic/ },
      ];
    }

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

export default nextConfig;
