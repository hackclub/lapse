/**
 * Validates if a string is a valid URL.
 * @param url - The string to validate
 * @returns `true` if the URL is valid, `false` otherwise
 */
export function validateUrl(url: string): boolean {
    try {
        new URL(url);
        return true;
    }
    catch {
        return false;
    }
}
