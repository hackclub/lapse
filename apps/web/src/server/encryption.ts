import "@/server/allow-only-server";

import crypto from "crypto";
import { env } from "./env";

function deriveSalts(timelapseId: string): { keySalt: Buffer; ivSalt: Buffer } {
    const keySalt = crypto.createHmac('sha256', 'timelapse-key-salt').update(timelapseId).digest();
    const ivSalt = crypto.createHmac('sha256', 'timelapse-iv-salt').update(timelapseId).digest();
    
    return { keySalt, ivSalt };
}

export interface KeyIvPair {
    key: Buffer;
    iv: Buffer;
    keySalt: Buffer;
    ivSalt: Buffer;
}

export interface EncryptedVideoStream {
    data: Buffer;
    key: string;
    iv: string;
    keySalt: string;
    ivSalt: string;
}

export function decryptVideo(
    encryptedData: ArrayBuffer | Uint8Array,
    timelapseId: string,
    passkey: string
): Buffer {
    const { keySalt, ivSalt } = deriveSalts(timelapseId);
    
    const passkeyBuffer = Buffer.from(passkey, "utf8");
    
    const derivedKey = crypto.pbkdf2Sync(passkeyBuffer, keySalt, 100000, 32, "sha256");
    const derivedIv = crypto.pbkdf2Sync(passkeyBuffer, ivSalt, 100000, 16, "sha256");

    const decipher = crypto.createDecipheriv("aes-256-cbc", derivedKey, derivedIv);
    const inputBuffer = encryptedData instanceof Uint8Array 
        ? Buffer.from(encryptedData)
        : Buffer.from(new Uint8Array(encryptedData));
        
    const decryptedBuffer = Buffer.concat([
        decipher.update(inputBuffer),
        decipher.final()
    ]);
    
    return decryptedBuffer;
}

export function encryptData(data: Buffer | Uint8Array, key: string, iv: string): Buffer {
    const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(key, "hex"), Buffer.from(iv, "hex"));
    const inputBuffer = data instanceof Uint8Array ? Buffer.from(data) : data;
    const encryptedBuffer = Buffer.concat([
        cipher.update(inputBuffer),
        cipher.final()
    ]);
    
    return encryptedBuffer;
}

export function decryptData(encryptedData: Buffer | Uint8Array, key: string, iv: string): Buffer {
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(key, "hex"), Buffer.from(iv, "hex"));
    const inputBuffer = encryptedData instanceof Uint8Array ? Buffer.from(encryptedData) : encryptedData;
    const decryptedBuffer = Buffer.concat([
        decipher.update(inputBuffer),
        decipher.final()
    ]);

    return decryptedBuffer;
}

// encrypt hackatime tokens using aes-256-gcm
// returns base64 encoded string (iv:authTag:encrypted)
export function encryptToken(plaintext: string): string {
    const key = Buffer.from(env.HACKATIME_TOKEN_ENCRYPTION_KEY, "hex");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    // format: iv:authTag:encrypted (all base64)
    return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

// decrypt hackatime tokens
export function decryptToken(encrypted: string | null): string | null {
    if (!encrypted) return null;

    // check if already plaintext (old tokens not yet migrated)
    if (!encrypted.includes(":")) {
        return encrypted;
    }

    const key = Buffer.from(env.HACKATIME_TOKEN_ENCRYPTION_KEY, "hex");

    try {
        const [ivB64, authTagB64, encryptedB64] = encrypted.split(":");
        const iv = Buffer.from(ivB64, "base64");
        const authTag = Buffer.from(authTagB64, "base64");
        const ciphertext = Buffer.from(encryptedB64, "base64");

        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(authTag);

        const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
        ]);

        return decrypted.toString("utf8");
    } catch {
        // if decryption fails, assume it's plaintext
        return encrypted;
    }
}
