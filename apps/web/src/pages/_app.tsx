import type { AppType } from "next/app";

import "@/client/styles/globals.css";
import { AuthProvider } from "@/client/context/AuthContext";

const App: AppType = ({ Component, pageProps }) => {
  return (
    <AuthProvider>
      <Component {...pageProps} />
    </AuthProvider>
  );
};

export default App;
