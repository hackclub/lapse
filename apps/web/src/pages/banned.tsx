import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Icon from "@hackclub/icons";

import RootLayout from "@/client/components/RootLayout";
import { Button } from "@/client/components/ui/Button";
import { Skeleton } from "@/client/components/ui/Skeleton";
import { useAuthContext } from "@/client/context/AuthContext";

export default function BannedPage() {
  const router = useRouter();
  const { signOut, isBanned, isLoading, banReason } = useAuthContext();
  const [shouldRedirect, setShouldRedirect] = useState(false);

  useEffect(() => {
    if (!isLoading && !isBanned) {
      setShouldRedirect(true);
      router.replace("/");
    }
  }, [isLoading, isBanned, router]);

  if (isLoading || shouldRedirect) {
    return (
      <RootLayout title="Loading - Lapse">
        <div className="min-h-screen flex items-center justify-center p-4">
          <Skeleton className="h-64 w-96" />
        </div>
      </RootLayout>
    );
  }

  return (
    <RootLayout title="Account Banned - Lapse">
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <Icon glyph="private" width={64} height={64} className="mx-auto mb-6 text-red" />
          <h1 className="text-3xl font-bold mb-4">Account Banned</h1>
          <p className="text-muted mb-4">
            Your account has been banned from Lapse.
          </p>
          {banReason && (
            <div className="bg-darker border border-slate rounded-xl p-4 mb-6 text-left">
              <p className="text-sm text-muted mb-1">Reason:</p>
              <p className="text-white">{banReason}</p>
            </div>
          )}
          <p className="text-muted mb-6">
            If you believe this is a mistake, please contact an administrator.
          </p>
          <Button kind="regular" onClick={signOut} className="w-full">
            Sign Out
          </Button>
        </div>
      </div>
    </RootLayout>
  );
}
