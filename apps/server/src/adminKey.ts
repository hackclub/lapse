import { timingSafeEqual } from "node:crypto";

export function authenticatedWithAdminKey(header: string | undefined, key: string): boolean {
    const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
    const suppliedBuffer = Buffer.from(supplied, "utf8");
    const keyBuffer = Buffer.from(key, "utf8");
    return suppliedBuffer.length === keyBuffer.length
        && timingSafeEqual(suppliedBuffer, keyBuffer);
}
