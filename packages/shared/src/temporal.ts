import { maybe } from "@/functional";

/**
 * Returns a `Date` equal to the current date, `days` days ago.
 */
export function daysAgo(days: number) {
    const now = new Date();
    now.setDate(now.getDate() - days);
    return now;
}

function extractTimespanComponents(seconds: number) {
    seconds = Math.floor(seconds);

    return {
        h: Math.floor(seconds / 3600),
        m: Math.floor((seconds % 3600) / 60),
        s: seconds % 60
    };
}

/**
 * Formats a duration, represented in the form of a number of seconds, to a string like `3h 2m`.
 */
export function formatDuration(seconds: number) {
    if (seconds == 0)
        return "0s";

    const { h, m, s } = extractTimespanComponents(seconds);

    return [
        ...maybe(`${h}h`, h != 0),
        ...maybe(`${m}m`, m != 0),
        ...maybe(`${s}s`, s != 0)
    ].join(" ");
}
