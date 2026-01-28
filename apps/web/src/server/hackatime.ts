import "@/server/allow-only-server";

import { logError } from "@/server/serverCommon";

export interface WakaTimeCategorizedStat {
    name: string;
    total_seconds: number;
    percent: number;
    digital: string;
    text: string;
    hours: number;
    minutes: number;
    seconds: number;
}

/**
 * Data sent by `/api/hackatime/v1/users/current/stats/last_7_days`.
 * @see https://github.com/hackclub/hackatime/blob/81369f52eb6672c446e6ca0355fe417451d10a6b/app/controllers/api/hackatime/v1/hackatime_controller.rb#L111
 */
export interface WakaTimeUserStats {
    data: {
        /**
         * The username of the requesting user in Hackatime.
         */
        username: string;

        /**
         * Equivalent to `username` for Hackatime.
         */
        user_id: string;

        start: string;
        end: string;
        status: "ok";
        total_seconds: number;
        daily_average: number;
        days_including_holidays: number;
        range: "last_7_days";
        human_readable_range: "Last 7 Days";
        human_readable_total: string;
        human_readable_daily_average: string;
        is_coding_activity_visible: true;
        is_other_usage_visible: true;
        editors: WakaTimeCategorizedStat[];
        languages: WakaTimeCategorizedStat[];
        machines: WakaTimeCategorizedStat[];
        projects: WakaTimeCategorizedStat[];
        operating_system: WakaTimeCategorizedStat[];
        categories: WakaTimeCategorizedStat[];
    }
}

export type HackatimeCategory =
    "coding" |
    "building" |
    "indexing" |
    "debugging" |
    "running tests" |
    "writing tests" |
    "manual testing" |
    "writing docs" |
    "communicating" |
    "code reviewing" |
    "notes" |
    "researching" |
    "learning" |
    "designing" |
    "ai coding";

export interface WakaTimeHeartbeat {
    /** Entity heartbeat is logging time against, such as an absolute file path or domain. */
    entity: string;

    /** Type of entity. */
    type: string;

    /** Category for this activity (optional); normally this is inferred automatically from `type`. */
    category?: string;

    /** UNIX epoch timestamp; numbers after decimal point are fractions of a second. */
    time: number;

    /** Project name. */
    project?: string;

    /**
     * Count of the number of folders in the project root path (optional); for ex: if the project
     * folder is `/Users/user/projects/wakatime` and the entity path is `/Users/user/projects/wakatime/models/user.py`
     * then the `project_root_count` is `5` and the relative entity path after removing `5` prefix
     * folders is `models/user.py`.
     */
    project_root_count?: number;

    /** Branch name. */
    branch?: string;

    /** Language name. */
    language?: string;

    /** Comma separated list of dependencies detected from entity file. */
    dependencies?: string;

    /** Total number of lines in the entity (when entity type is `file`). */
    lines?: number;

    /** Number of lines added or removed by GenAI since last heartbeat in the current file. */
    ai_line_changes?: number;

    /** Number of lines added or removed by old-school typing since last heartbeat in the current file. */
    human_line_changes?: number;

    /** Current line row number of cursor with the first line starting at 1. */
    lineno?: number;

    /** Current cursor column position starting from 1. */
    cursorpos?: number;

    /** Whether this heartbeat was triggered from writing to a file. */
    is_write?: boolean;

    /** The user agent that created this heartbeat. */
    user_agent: string;
}

export interface CreatedWakaTimeHeartbeat {
    /** An ID like `379587014`. */
    id: number;

    /** An ID like `652`. */
    user_id: number;

    branch: string | null;
    category: HackatimeCategory | null;
    dependencies: string[];
    editor: string;
    entity: string;
    language: string | null;
    machine: string | null;
    operating_system: string;
    project: string;
    type: string | null;
    user_agent: string | null;
    line_additions: number | null;
    line_deletions: number | null;
    lineno: number | null; 
    lines: number | null; 
    cursorpos: number | null; 
    project_root_count: number | null; 
    time: number | null; 
    is_write: boolean | null; 
    created_at: string; 
    updated_at: string; 
    fields_hash: string; 
    source_type: "direct_entry" | "wakapi_import" | "test_entry"; 
    ip_address: string;
    ysws_program: string;
    deleted_at: string | null;
    raw_data: {
        time: number;
        type: string;
        lines: number | null;
        branch: number | null;
        editor: string;
        entity: string;
        lineno: number | null;
        machine: string | null;
        project: string;
        user_id: number;
        category: HackatimeCategory;
        is_write: boolean | null;
        language: string | null;
        cursorpos: number | null;
        user_agent: string;
        dependencies: string[];
        line_additions: number | null;
        line_deletions: number | null;
        operating_system: string;
        project_root_count: number | null;
    };
    raw_heartbeat_upload_id: number;
}

export type WakaTimeResponse<T> = { data: T }

class HackatimeBase {
    private token: string;

    constructor(token: string) {
        this.token = token;
    }

    protected async query<T>(method: "GET" | "POST", endpoint: string, params: object = {}) {
        const req = await fetch(`https://hackatime.hackclub.com/api/${endpoint}`, {
            method,
            body: (method === "GET" || !params) ? undefined : JSON.stringify(params),
            headers: new Headers({
                "Authorization": `Bearer ${this.token}`,
                "User-Agent": "lapse/0.1.0",
                "Content-Type": "application/json"
            })
        });

        if (!req.ok) {
            logError("hackatime", "API request failed!", { req, method, params });
            throw new Error(`Hackatime API request failed with HTTP ${req.status}`);
        }

        return await req.json() as T;
    }
}

/**
 * Hackatime API client using a user's personal API key.
 * Used for pushing heartbeats and fetching WakaTime-compatible stats.
 */
export class HackatimeUserApi extends HackatimeBase {
    constructor(apiKey: string) {
        super(apiKey);
    }

    async currentUserStats() {
        return await this.query<WakaTimeUserStats>(
            "GET", "hackatime/v1/users/current/stats/last_7_days"
        );
    }

    async pushHeartbeats(heartbeats: WakaTimeHeartbeat[]) {
        return await this.query<{
            responses: [CreatedWakaTimeHeartbeat, number][]
        }>(
            "POST", "hackatime/v1/users/current/heartbeats.bulk",
            { heartbeats }
        );
    }
}

/**
 * Hackatime API client using an OAuth access token.
 * Used for OAuth-authenticated endpoints like fetching user info and API keys.
 */
export class HackatimeOAuthApi extends HackatimeBase {
    constructor(accessToken: string) {
        super(accessToken);
    }

    /**
     * Gets or creates the current user's API key.
     * This can be used to instantiate a HackatimeUserApi for pushing heartbeats.
     */
    async apiKey() {
        const res = await this.query<{ token: string }>("GET", "v1/authenticated/api_keys");
        return res.token;
    }

    /**
     * Gets all projects for the authenticated user.
     */
    async getProjects() {
        const res = await this.query<{
            projects: {
                name: string;
                total_seconds: number;
                most_recent_heartbeat: string | null;
                languages: string[];
                archived: boolean;
            }
        }>(
            "GET", "v1/authenticated/projects"
        );

        return res.projects;
    }
}
