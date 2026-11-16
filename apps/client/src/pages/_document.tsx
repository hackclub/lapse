import { Html, Head, Main, NextScript } from "next/document";

const API_ORIGIN = new URL(process.env.NEXT_PUBLIC_API_URL ?? "https://api.lapse.hackclub.com").origin;

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <link rel="icon" type="image/svg+xml" href="/icon0.svg" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icon1.png" />
        <link rel="apple-touch-icon" href="/apple-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-title" content="Lapse" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="mobile-web-app-capable" content="yes" />

        {/* Every page talks to the API, and most show Lookout's videos and thumbnails - open those connections early. */}
        <link rel="preconnect" href={API_ORIGIN} crossOrigin="use-credentials" />
        <link rel="preconnect" href="https://lookout.hackclub.com" />
        <link rel="preconnect" href="https://lookout.hackclub-assets.com" />
      </Head>
      <body className="antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
