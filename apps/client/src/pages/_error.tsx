import * as Sentry from "@sentry/nextjs";
import type { NextPageContext } from "next";

import { StatusPage, NOT_FOUND_STATUS, SERVER_ERROR_STATUS } from "@/components/layout/StatusPage";

type ErrorPageProps = {
    statusCode: number;
};

export default function ErrorPage({ statusCode }: ErrorPageProps) {
    return <StatusPage {...(statusCode === 404 ? NOT_FOUND_STATUS : SERVER_ERROR_STATUS)} />;
}

ErrorPage.getInitialProps = async (context: NextPageContext): Promise<ErrorPageProps> => {
    await Sentry.captureUnderscoreErrorException(context);
    return { statusCode: context.res?.statusCode ?? context.err?.statusCode ?? 500 };
};
