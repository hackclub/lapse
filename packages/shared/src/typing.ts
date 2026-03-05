type UnionToIntersection<U> = (U extends any
    ? (k: U) => void
    : never) extends ((k: infer I) => void)
    ? I
    : never;

/**
 * Flattens multiple union types into a single type with optional values.
 */
export type FlattenUnion<T> = {
    [K in keyof UnionToIntersection<T>]: K extends keyof T ?
    T[K] extends any[] ? T[K]
    : T[K] extends object ? FlattenUnion<T[K]>
    : T[K]
    : UnionToIntersection<T>[K] | undefined
}

export type KeyOfType<T, V> = keyof {
    [P in keyof T as T[P] extends V? P: never]: any
}
