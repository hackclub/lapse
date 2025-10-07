import { useRouter } from "next/router";
import { trpc } from "../trpc";
import { useState } from "react";

import { User } from "@/server/routers/api/user";
import { useOnce } from "./useOnce";

export function useAuth(required: boolean) {
    const router = useRouter();
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useOnce(async () => {
        console.log("(auth) authenticating...");
        const req = await trpc.user.myself.query({});

        console.log("(auth) response:", req);

        if (!req.ok || req.data.user === null) {
            console.log("(auth) user is not authenticated");

            if (required) {
                router.push("/auth");
            }

            setIsLoading(false);
            return;
        }

        console.log("(auth) user is authenticated");

        setCurrentUser(req.data.user);
        setIsLoading(false);
    });

    function signOut() {
        console.log("(auth) signing out...");
        document.cookie = "lapse-auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax";
        router.push("/auth");
    };

    return {
        currentUser,
        isLoading,
        signOut
    };
}
