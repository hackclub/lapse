import z from "zod";
import { oc, type HTTPMethod } from "@orpc/contract";

import { apiResult } from "@/common";

/**
 * Equivalent to `z.object({})`.
 */
export const NO_INPUT = z.object({});

/**
 * Equivalent to `apiResult({})`.
 */
export const NO_OUTPUT = apiResult({});

/**
 * Equivalent to `oc` from `@orpc/contract`, but when `method` and `path` are specified,
 * associates HTTP method and path information with the contract via `.route`.
 */
export function contract(method?: HTTPMethod, path?: `/${string}`) {
    if (method && path)
        return oc.route({ method, path });

    return oc;
}