import { StatusPage, SERVER_ERROR_STATUS } from "@/components/layout/StatusPage";

export default function Page() {
  return <StatusPage {...SERVER_ERROR_STATUS} />;
}
