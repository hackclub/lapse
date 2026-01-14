import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/router";

import type { User } from "@/client/api";
import { trpc, handleBanError } from "@/client/trpc";
import { useOnce } from "@/client/hooks/useOnce";
import { useCache } from "@/client/hooks/useCache";

interface AuthContextValue {
    currentUser: User | null;
    isLoading: boolean;
    isBanned: boolean;
    banReason: string | null;
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
    const [isBanned, setIsBanned] = useState(false);

    useOnce(async () => {
        console.log("(AuthContext.tsx) authenticating...");

        try {
            const req = await trpc.user.myself.query({});

            console.log("(AuthContext.tsx) response:", req);

            if (!req.ok || req.data.user === null) {
                console.log("(AuthContext.tsx) user is not authenticated");
                setUserCache(null);
                setIsLoading(false);
                return;
            }

            console.log("(AuthContext.tsx) user is authenticated");
            setUserCache(req.data.user);
            setCurrentUser(req.data.user);
            setIsLoading(false);
        }
        catch (err) {
            if (handleBanError(err)) {
                console.log("(AuthContext.tsx) user is banned");
                setIsBanned(true);
                setUserCache(null);
                setIsLoading(false);
                return;
            }
            throw err;
        }
    });

    const signOut = useCallback(async () => {
        console.log("(AuthContext.tsx) signing out...");
        await trpc.user.signOut.mutate({});
        setUserCache(null);
        setCurrentUser(null);
        router.push("/");
        router.reload();
    }, [router, setUserCache]);

    const effectiveUser = isLoading ? userCache : currentUser;

    const value: AuthContextValue = {
        currentUser: effectiveUser,
        isLoading,
        isBanned,
        banReason: effectiveUser?.private.isBanned ? effectiveUser.private.bannedReason : null,
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
    if (context === null) {
        throw new Error("useAuthContext must be used within an AuthProvider");
    }
    return context;
}
