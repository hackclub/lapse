import type { AppType } from "next/app";

import "@/client/styles/globals.css";
import { AuthProvider } from "@/client/context/AuthContext";
import { initLogBucket } from "@/client/logBucket";

initLogBucket();

const App: AppType = ({ Component, pageProps }) => {
  return (
    <AuthProvider>
      <Component {...pageProps} />
    </AuthProvider>
  );
};

export default App;
