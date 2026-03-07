/**
 * The encryption/decryption key length, in bytes.
 */
export const ENCRYPTION_KEY_LENGTH = 128 / 8;

/**
 * Encrypts `data` using AES-128-GCM via the given `key` and `iv`.
 */
export async function encryptData(key: ArrayBuffer, iv: ArrayBuffer, data: Blob | ArrayBuffer): Promise<ArrayBuffer> {
    return await crypto.subtle.encrypt(
        { name: "AES-CBC", iv },
        await crypto.subtle.importKey(
            "raw",
            key,
            { name: "AES-CBC" },
            false,
            ["encrypt"]
        ),
        data instanceof ArrayBuffer ? data : await data.arrayBuffer()
    );
}

/**
 * Decrypts `data` using AES-128-GCM via the given `key` and `iv`.
 */
export async function decryptData(key: ArrayBuffer, iv: ArrayBuffer, data: Blob | ArrayBuffer): Promise<ArrayBuffer> {
    return await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: iv },
        await crypto.subtle.importKey(
            "raw",
            key,
            { name: "AES-CBC" },
            false,
            ["decrypt"]
        ),
        data instanceof ArrayBuffer ? data : await data.arrayBuffer()
    );
}

/**
 * Converts `bytes` into a hexadecimal string.
 */
export function toHex(bytes: Uint8Array) {
    return Array.from(bytes)
        .map(x => x.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Converts a hexadecimal string into the bytes it represents.
 */
export function fromHex(hex: string) {
    return new Uint8Array(
        hex.match(/[\da-f]{2}/gi)!.map(x => parseInt(x, 16))
    );
}