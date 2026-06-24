import dynamic from "next/dynamic";

import RootLayout from "@/components/layout/RootLayout";

const LookoutRecorder = dynamic(() => import("@/components/lookout/LookoutRecorder"), {
  ssr: false,
  loading: () => (
    <RootLayout showHeader={false}>
      <div className="flex items-center justify-center h-screen text-muted">Talking to Lookout...</div>
    </RootLayout>
  ),
});

export default function Page() {
  return <LookoutRecorder />;
}
