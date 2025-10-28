import type { AppType } from "next/app";

import "@/client/styles/globals.css";

const App: AppType = ({ Component, pageProps }) => {
  return (
    <Component {...pageProps} />
  );
};

export default App;
