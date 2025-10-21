import { useRouter } from "next/router";
import { useState } from "react";

import type { User } from "@/server/routers/api/user";

import { trpc } from "../trpc";
import { useOnce } from "./useOnce";

export function useAuth(required: boolean, allowUnconfirmed = true) {
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

        if (!allowUnconfirmed && req.data.user.private.permissionLevel == "UNCONFIRMED") {
            console.log("(auth) user needs to be confirmed to access this page");
            router.push("/");
            setIsLoading(false);
            return;
        }

        console.log("(auth) user is authenticated");

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
        currentUser,
        isLoading,
        signOut
    };
}
