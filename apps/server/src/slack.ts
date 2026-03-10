import { env } from "@/env.js";
import { logError } from "@/logging.js";

export interface SlackUser {
    id: string;
    team_id: string;
    name: string;
    deleted: boolean;
    color: string;
    real_name: string;
    tz: string;
    tz_label: string;
    tz_offset: number;
    profile: {
        avatar_hash: string;
        status_text: string;
        status_emoji: string;
        real_name: string;
        display_name: string;
        real_name_normalized: string;
        email: string;
        image_original: string;
        image_24: string;
        image_32: string;
        image_48: string;
        image_72: string;
        image_192: string;
        image_512: string;
        team: string;
        title: string;
    }
    is_admin: boolean;
    is_owner: boolean;
    is_primary_owner: boolean;
    is_restricted: boolean;
    is_ultra_restricted: boolean;
    is_bot: boolean;
    updated: number;
    is_app_user: boolean;
    has_2fa: boolean;
}

type SlackResponse<T, TDataKey extends PropertyKey> =
    | ({ ok: true }) & { [K in TDataKey]: T }
    | { ok: false, error: string };

export async function slackQueryProfile(id: string): Promise<SlackUser | null> {
    try {
        const res = await fetch(`${env.SLACK_API_URL}/users.info`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${env.SLACK_BOT_TOKEN}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `user=${id}`,
        });

        const data = await res.json() as SlackResponse<SlackUser, "user">; 
        if (!data.ok) {
            logError(`Could not query Slack profile ${id} - error ${data.error}.`);
            return null;
        }
        
        return data.user;
    }
    catch (err) {
        logError(`Could not query Slack profile ${id} - internal error ${err}`, { err });
        return null;
    }
}