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

type Range<N extends number, Acc extends number[] = []> = 
    Acc['length'] extends N 
        ? Acc[number]
        : Range<N, [...Acc, Acc['length']]>;

export class SteppedProgress<const N extends number> {
    private step: number = 0;

    constructor (
        private max: N,
        private stageSetter: (x: string) => void,
        private progressSetter: (x: number) => void
    ) {
        stageSetter("");
        progressSetter(0);
    }

    advance<const I extends Range<N>>(index: I, stage: string) {
        this.step = index as number;
        this.progressSetter(Math.min(Math.floor((this.step / this.max) * 100), 100));
        this.stageSetter(stage);
    }
}
