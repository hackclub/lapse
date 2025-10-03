import { useRouter } from "next/router";
import { trpc } from "../trpc";

export function useAuth() {
    const router = useRouter();
    const { data: myselfResult, isLoading, error, refetch } = trpc.user.myself.useQuery(
        {},
        {
            retry: false,
            refetchOnWindowFocus: false,
        }
    );

    const user = myselfResult?.ok ? myselfResult.data.user : null;
    const isAuthenticated = !!user && !error;

    const signOut = () => {
        // Clear the auth cookie by setting it to expire in the past
        document.cookie = "lapse-auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax";
        
        // Redirect to auth page
        router.push("/auth");
    };

    const requireAuth = () => {
        if (!isLoading && !isAuthenticated) {
            router.push("/auth");
        }
    };

    return {
        user,
        isAuthenticated,
        isLoading,
        error,
        signOut,
        requireAuth,
        refetch
    };
}
