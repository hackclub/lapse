import type { AppType } from "next/app";

import "@/styles/globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { KeyRelayProvider } from "@/context/KeyRelayContext";
import { initLogBucket } from "@/logBucket";

initLogBucket();

const App: AppType = ({ Component, pageProps }) => {
  return (
    <AuthProvider>
      <KeyRelayProvider>
        <Component {...pageProps} />
      </KeyRelayProvider>
    </AuthProvider>
  );
};

export default App;
