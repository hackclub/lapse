import "@/server/allow-only-server";
import crypto from "crypto";

function deriveSalts(timelapseId: string): { keySalt: Buffer; ivSalt: Buffer } {
    // Use HMAC to derive deterministic salts from the timelapse ID
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
