/**
 * Used as an ascending numeric sort function for a `T[]` with a key selector.
 * For example, `x.sort(descending(x => x.someNumber))`.
 */
export function ascending<T>(picker: (x: T) => number): (a: T, b: T) => number;

/**
 * Used as an ascending numeric sort function for a `number[]`. For example, `x.sort(descending())`.
 */
export function ascending(): (a: number, b: number) => number;

export function ascending<T>(picker?: (x: T) => number) {
    if (!picker)
        return (a: number, b: number) => a - b;

    return (a: T, b: T) => picker(a) - picker(b); 
}

/**
 * Used as a descending numeric sort function for a `T[]` with a key selector.
 * For example, `x.sort(descending(x => x.someNumber))`.
 */
export function descending<T>(picker: (x: T) => number): (a: T, b: T) => number;

/**
 * Used as a descending numeric sort function for a `number[]`. For example, `x.sort(descending())`.
 */
export function descending(): (a: number, b: number) => number;

export function descending<T>(picker?: (x: T) => number) {
    if (!picker)
        return (a: number, b: number) => b - a;

    return (a: T, b: T) => picker(b) - picker(a);
}

/**
 * Creates an array of chunks of size `n` derived from `array`.
 * For example, an input of `( [1, 2, 3, 4, 5], 2 )` yields `[1, 2], [3, 4], [5]`.
 */
export function* chunked<T>(array: T[], n: number) {
    for (let i = 0; i < array.length; i += n) {
        yield array.slice(i, i + n);
    }
}
