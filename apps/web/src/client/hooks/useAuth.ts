import { useRouter } from "next/router";
import { useState } from "react";

import type { User } from "@/client/api";
import { trpc } from "@/client/trpc";
import { useOnce } from "@/client/hooks/useOnce";
import { useCache } from "@/client/hooks/useCache";

export function useAuth(required: boolean) {
    const router = useRouter();
    
    const [userCache, setUserCache] = useCache<User>("user");
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useOnce(async () => {
        console.log("(auth) authenticating...");
        const req = await trpc.user.myself.query({});

        console.log("(auth) response:", req);

        if (!req.ok || req.data.user === null) {
            console.log("(auth) user is not authenticated");
            setUserCache(null);

            if (required) {
                router.push("/auth");
            }

            setIsLoading(false);
            return;
        }

        console.log("(auth) user is authenticated");
        setUserCache(req.data.user);

        setCurrentUser(req.data.user);
        setIsLoading(false);
    });

    async function signOut() {
        console.log("(auth) signing out...");
        await trpc.user.signOut.mutate({});
        setCurrentUser(null);
        router.push("/");
        router.reload();
    };

    return {
        currentUser: isLoading ? userCache : currentUser,
        isLoading,
        signOut
    };
}
