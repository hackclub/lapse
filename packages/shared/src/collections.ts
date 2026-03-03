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

/**
 * Returns `true` if `a` and `b` are of equal length and contain the same elements, irrespective of order.
 */
export function arraysEqual<T>(a: T[], b: T[]) {
    if (a.length != b.length)
        return false;

    a = a.toSorted();
    b = b.toSorted();

    for (let i = 0; i < a.length; i++) {
        if (a[i] != b[i]) {
            return false;
        }
    }

    return true;
}

/**
 * Returns an array of `[0, ..., n-1]`.
 */
export function range(n: number) {
    const arr: number[] = [];
    for (let i = 0; i < n; i++) {
        arr.push(i);
    }

    return arr;
}
