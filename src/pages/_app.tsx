import type { AppType } from "next/app";

import "@/client/styles/globals.css";
import RootLayout from "../client/components/RootLayout";

const App: AppType = ({ Component, pageProps }) => {
  return (
    <RootLayout>
      <Component {...pageProps} />
    </RootLayout>
  );
};

export default App;
