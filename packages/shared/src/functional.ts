/**
 * Throws `err`. 
 */
export function raise(err: Error): never {
    throw err;
}

/**
 * Returns `value` when `condition` is `true` - otherwise, returns an empty object (`{}`).
 * This function is usually used for conditional object construction via the spread operator.
 */
export function when<T>(condition: boolean, value: T) {
    if (condition)
        return value;

    return {};
}

/**
 * Throws an error if `condition` is `false`.
 */
export function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

/**
 * Emulates a `switch` expression present in languages like C#. For example:
 * 
 * ```
 * // 'result' will be equal to 420.
 * const result = match("c", {
 *      "a": 727,
 *      "b": 67,
 *      "c": 420,
 *      "d": 2137
 * });
 * ```
 */
export function match<K extends string | number, T>(selector: K, cases: Record<K, T>) {
    if (!(selector in cases)) {
        console.error("(common.ts) Could not find", selector, "from cases", cases);
        throw new Error(`Could not match value ${selector} in "match" block`);
    }

    return cases[selector];
}

/**
 * Transforms an array like `["a", "b"]` to an object like `{ a: true, b: true }`.
 * This function is usually used for expressions like `choice in oneOf("a", "b")`.
 */
export function oneOf<T extends PropertyKey>(...values: T[]): Record<T, true> {
    return Object.fromEntries(values.map(x => [x, true])) as Record<T, true>;
}

/**
 * Returns a one-element array when `condition` is `true` - otherwise, returns `[]`.
 */
export function maybe<T>(element: T, condition: boolean) {
    return condition ? [element] as const : [] as const;
}
