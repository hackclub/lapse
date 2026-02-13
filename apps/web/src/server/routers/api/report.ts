import "@/server/allow-only-server";

import { z } from "zod";

import { apiResult, apiOk, apiErr } from "@/shared/common";

import { router, protectedProcedure } from "@/server/trpc";
import { env } from "@/server/env";
import { logRequest, logError, logInfo } from "@/server/serverCommon";
import { PublicId } from "@/server/routers/common";
import { database } from "@/server/db";

/**
 * Sends a message to a Slack channel via the Slack Web API.
 */
async function sendSlackMessage(channel: string, text: string, blocks: unknown[]): Promise<boolean> {
    const response = await fetch(`${env.SLACK_API_URL}/chat.postMessage`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${env.SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel, text, blocks }),
    });

    const data = await response.json();
    return data.ok === true;
}

const REPORT_CHANNEL_ID = "C0AETBBH0E7";

export default router({
    create: protectedProcedure([], "POST", "/report/create")
        .summary("Reports a timelapse for review by staff.")
        .input(
            z.object({
                timelapseId: PublicId,
                reason: z.string().min(1).max(500),
            })
        )
        .output(apiResult({}))
        .mutation(async ({ input, ctx }) => {
            logRequest("report.create", { input, ctx });

            const timelapse = await database.timelapse.findFirst({
                where: { id: input.timelapseId },
                include: { owner: true },
            });

            if (!timelapse)
                return apiErr("NOT_FOUND", "Timelapse not found.");

            if (!timelapse.isPublished)
                return apiErr("ERROR", "Only published timelapses can be reported.");

            if (timelapse.ownerId === ctx.user.id && process.env.NODE_ENV === "production")
                return apiErr("NO_PERMISSION", "You cannot report your own timelapse.");

            const blocks = [
                {
                    type: "header",
                    text: {
                        type: "plain_text",
                        text: "🚩 Timelapse Report",
                        emoji: true,
                    },
                },
                {
                    type: "section",
                    fields: [
                        {
                            type: "mrkdwn",
                            text: `*Timelapse:*\n${timelapse.name} (\`${timelapse.id}\`)`,
                        },
                        {
                            type: "mrkdwn",
                            text: `*Owner:*\n@${timelapse.owner.handle}`,
                        },
                        {
                            type: "mrkdwn",
                            text: `*Reported by:*\n@${ctx.user.handle}`,
                        },
                    ],
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*Reason:*\n${input.reason}`,
                    },
                },
            ];

            try {
                const success = await sendSlackMessage(
                    REPORT_CHANNEL_ID,
                    `🚩 Timelapse "${timelapse.name}" reported by @${ctx.user.handle}: ${input.reason}`,
                    blocks
                );

                if (!success) {
                    logError("report.create", "Slack API returned ok=false");
                    return apiErr("ERROR", "Failed to submit report. Please try again later.");
                }

                logInfo("report.create", "Report submitted", {
                    timelapseId: timelapse.id,
                    reporterId: ctx.user.id,
                });

                return apiOk({});
            }
            catch (error) {
                logError("report.create", "Failed to send report to Slack", { error });
                return apiErr("ERROR", "Failed to submit report. Please try again later.");
            }
        }),
});
