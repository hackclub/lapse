import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/router";

import type { User } from "@/client/api";
import { trpc } from "@/client/trpc";
import { useOnce } from "@/client/hooks/useOnce";
import { useCache } from "@/client/hooks/useCache";

interface AuthContextValue {
    currentUser: User | null;
    isLoading: boolean;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
    children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
    const router = useRouter();

    const [userCache, setUserCache] = useCache<User>("user");
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useOnce(async () => {
        console.log("(AuthContext) authenticating...");
        const req = await trpc.user.myself.query({});

        console.log("(AuthContext) response:", req);

        if (!req.ok || req.data.user === null) {
            console.log("(AuthContext) user is not authenticated");
            setUserCache(null);
            setIsLoading(false);
            return;
        }

        console.log("(AuthContext) user is authenticated");
        setUserCache(req.data.user);
        setCurrentUser(req.data.user);
        setIsLoading(false);
    });

    const signOut = useCallback(async () => {
        console.log("(AuthContext) signing out...");
        await trpc.user.signOut.mutate({});
        setCurrentUser(null);
        router.push("/");
        router.reload();
    }, [router]);

    const value: AuthContextValue = {
        currentUser: isLoading ? userCache : currentUser,
        isLoading,
        signOut
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuthContext(): AuthContextValue {
    const context = useContext(AuthContext);
    if (context === null)
        throw new Error("useAuthContext must be used within an AuthProvider");

    return context;
}
