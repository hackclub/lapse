/**
 * Finds the closest number to `x` in `array`.
 */
export function closest(x: number, array: number[]): number;

/**
 * Finds the closest item to `x` in `array` using a selector function.
 */
export function closest<T>(x: number, array: T[], selector: (item: T) => number): T;

export function closest<T>(x: number, array: T[] | number[], selector?: (item: T) => number): T | number {
    if (selector) {
        const typedArray = array as T[];
        const match = typedArray.find(item => selector(item) === x);
        if (match) return match;

        return typedArray.reduce((prev, curr) => 
            Math.abs(selector(curr) - x) < Math.abs(selector(prev) - x) ? curr : prev
        );
    }
    
    const numberArray = array as number[];
    if (numberArray.find(y => x === y))
        return x;

    return numberArray.reduce((prev, curr) => Math.abs(curr - x) < Math.abs(prev - x) ? curr : prev);
}

/**
 * Generates a random number between `min` (inclusive) and `max` (exclusive).
 */
export function rng(min: number, max: number) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min)) + min;
}

/**
 * Similar to `rng`, but generates a floating-point number instead.
 */
export function frng(min: number, max: number) {
    return Math.random() * (max - min) + min;
}