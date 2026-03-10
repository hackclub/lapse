import type { AppType } from "next/app";

import "@/styles/globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { KeyRelayProvider } from "@/context/KeyRelayContext";
import { LegacyMigrationGuard } from "@/migration";
import { initLogBucket } from "@/logBucket";

initLogBucket();

const App: AppType = ({ Component, pageProps }) => {
  return (
    <AuthProvider>
      <KeyRelayProvider>
        <LegacyMigrationGuard>
          <Component {...pageProps} />
        </LegacyMigrationGuard>
      </KeyRelayProvider>
    </AuthProvider>
  );
};

export default App;
