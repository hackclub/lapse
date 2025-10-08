import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" type="image/x-icon" href="/src/app/favicon.ico" />
        <link rel="icon" type="image/svg+xml" href="/src/app/icon0.svg" />
        <link rel="icon" type="image/png" sizes="32x32" href="/src/app/icon1.png" />
        <link rel="apple-touch-icon" href="/src/app/apple-icon.png" />
        <link rel="manifest" href="/src/app/manifest.json" />
        <meta name="apple-mobile-web-app-title" content="Lapse" />
      </Head>
      <body className="antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
