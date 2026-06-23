import dynamic from "next/dynamic";

import RootLayout from "@/components/layout/RootLayout";
import { LoadingModal } from "@/components/layout/LoadingModal";

const LookoutRecorder = dynamic(() => import("@/components/lookout/LookoutRecorder"), {
  ssr: false,
  loading: () => (
    <RootLayout showHeader={false}>
      <LoadingModal isOpen title="Setting up" message="Loading recorder..." />
    </RootLayout>
  ),
});

export default function Page() {
  return <LookoutRecorder />;
}
