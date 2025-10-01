import "@/client/styles/globals.css";
import type { AppType } from "next/app";
import { trpc } from "../client/trpc";
import RootLayout from "../client/components/RootLayout";

const App: AppType = ({ Component, pageProps }) => {
  return (
    <RootLayout>
      <Component {...pageProps} />
    </RootLayout>
  );
};

export default trpc.withTRPC(App);
