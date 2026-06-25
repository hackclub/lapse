import dynamic from "next/dynamic";

import RootLayout from "@/components/layout/RootLayout";

const LegacyRecoveryView = dynamic(
  () => import("@/components/legacy/LegacyRecoveryView").then(m => m.LegacyRecoveryView),
  {
    ssr: false,
    loading: () => (
      <RootLayout showHeader>
        <div className="flex items-center justify-center h-screen text-muted">Looking for recordings...</div>
      </RootLayout>
    ),
  },
);

export default function Page() {
  return <LegacyRecoveryView />;
}
