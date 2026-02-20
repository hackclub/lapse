/**
 * Returns a `Date` equal to the current date, `days` days ago.
 */
export function daysAgo(days: number) {
    const now = new Date();
    now.setDate(now.getDate() - days);
    return now;
}