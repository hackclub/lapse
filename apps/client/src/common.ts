import type { glyphs as hackClubGlyphs } from "@hackclub/icons";

export function createFormData(fields: Record<string, Blob | string>): FormData {
    const data = new FormData();

    for (const key in fields) {
        if (!Object.hasOwn(fields, key))
            continue;
        
        data.append(key, fields[key]);
    }

    return data;
}

/**
 * Returns a `Promise<void>` that returns after `ms` milliseconds.
 */
export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export type IconGlyph = keyof typeof hackClubGlyphs;
