import { useRouter } from "next/router";
import { useEffect } from "react";

import { useAuthContext } from "@/client/context/AuthContext";

export function useAuth(required: boolean) {
    const router = useRouter();
    const { currentUser, isLoading, signOut } = useAuthContext();

    useEffect(() => {
        if (!isLoading && required && currentUser === null) {
            router.push("/auth");
        }
    }, [isLoading, required, currentUser, router]);

    return {
        currentUser,
        isLoading,
        signOut
    };
}
