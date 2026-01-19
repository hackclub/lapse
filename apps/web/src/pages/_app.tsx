import type { AppType } from "next/app";
import { useRouter } from "next/router";
import { useEffect } from "react";

import "@/client/styles/globals.css";
import { AuthProvider, useAuthContext } from "@/client/context/AuthContext";
import { initLogBucket } from "@/client/logBucket";
import { isBannedError } from "@/client/trpc";

initLogBucket();

if (typeof window !== "undefined") {
    window.addEventListener("unhandledrejection", (event) => {
        if (isBannedError(event.reason)) {
            event.preventDefault();
            window.location.href = "/banned";
        }
    });
}

function BanRedirect({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const { isBanned, isLoading } = useAuthContext();

    useEffect(() => {
        if (!isLoading && isBanned && router.pathname !== "/banned") {
            router.replace("/banned");
        }
    }, [isBanned, isLoading, router]);

    return <>{children}</>;
}

const App: AppType = ({ Component, pageProps }) => {
    return (
        <AuthProvider>
            <BanRedirect>
                <Component {...pageProps} />
            </BanRedirect>
        </AuthProvider>
    );
};

export default App;
