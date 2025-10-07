import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Derives deterministic key and IV salts from a timelapse ID.
 * This allows users to decrypt timelapses on any device using just the passkey and timelapse ID.
 */
export function deriveSaltsFromTimelapseId(timelapseId: string): { keySalt: Buffer; ivSalt: Buffer } {
    // Use HMAC to derive deterministic salts from the timelapse ID
    const keySalt = crypto.createHmac('sha256', 'timelapse-key-salt').update(timelapseId).digest();
    const ivSalt = crypto.createHmac('sha256', 'timelapse-iv-salt').update(timelapseId).digest();
    
    return { keySalt, ivSalt };
}

/**
 * Encrypts a plaintext string using AES-256-GCM encryption.
 * 
 * @param plaintext The string to encrypt
 * @param key The encryption key as a 64-character hex string (32 bytes)
 * @returns The encrypted data as a hex string containing IV + auth tag + ciphertext
 */
export function encryptString(plaintext: string, key: string): string {
    const keyBuffer = Buffer.from(key, "hex");
    const iv = crypto.randomBytes(IV_LENGTH);
    
    const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
    
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    
    const tag = cipher.getAuthTag();
    
    return iv.toString("hex") + tag.toString("hex") + encrypted;
}

/**
 * Decrypts a hex-encoded encrypted string back to plaintext using AES-256-GCM.
 * 
 * @param encryptedHex The hex string containing IV + auth tag + ciphertext
 * @param key The decryption key as a 64-character hex string (must match the encryption key)
 * @returns The decrypted plaintext string, or `null` if decryption fails due to invalid data
 */
export function decryptString(encryptedHex: string, key: string): string | null {
    const keyBuffer = Buffer.from(key, "hex");
    
    if (encryptedHex.length < (IV_LENGTH + TAG_LENGTH) * 2)
        return null;
    
    const ivHex = encryptedHex.slice(0, IV_LENGTH * 2);
    const tagHex = encryptedHex.slice(IV_LENGTH * 2, (IV_LENGTH + TAG_LENGTH) * 2);
    const encryptedData = encryptedHex.slice((IV_LENGTH + TAG_LENGTH) * 2);
    
    try {
        const iv = Buffer.from(ivHex, "hex");
        const tag = Buffer.from(tagHex, "hex");
        
        const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
        decipher.setAuthTag(tag);
        
        let decrypted = decipher.update(encryptedData, "hex", "utf8");
        decrypted += decipher.final("utf8");
        
        return decrypted;
    }
    catch {
        return null;
    }
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

export function deriveKeyAndIvFromTimelapseId(timelapseId: string, passkey: string): KeyIvPair {
    const { keySalt, ivSalt } = deriveSaltsFromTimelapseId(timelapseId);
    
    const passkeyBuffer = Buffer.from(passkey, 'utf8');
    
    // Derive key (256 bits for AES-256-CBC)
    const key = crypto.pbkdf2Sync(passkeyBuffer, keySalt, 100000, 32, 'sha256');
    
    // Derive IV (128 bits for AES-CBC)
    const iv = crypto.pbkdf2Sync(passkeyBuffer, ivSalt, 100000, 16, 'sha256');
    
    return {
        key,
        iv,
        keySalt,
        ivSalt
    };
}

export function deriveKeyAndIvFromSalts(keySalt: Buffer, ivSalt: Buffer, passkey: string): KeyIvPair {
    const passkeyBuffer = Buffer.from(passkey, 'utf8');
    
    // Derive key (256 bits for AES-256-CBC)
    const key = crypto.pbkdf2Sync(passkeyBuffer, keySalt, 100000, 32, 'sha256');
    
    // Derive IV (128 bits for AES-CBC)
    const iv = crypto.pbkdf2Sync(passkeyBuffer, ivSalt, 100000, 16, 'sha256');
    
    return {
        key,
        iv,
        keySalt,
        ivSalt
    };
}

export function encryptVideoWithTimelapseId(videoBuffer: Buffer, timelapseId: string, passkey: string): EncryptedVideoStream {
    const { key, iv, keySalt, ivSalt } = deriveKeyAndIvFromTimelapseId(timelapseId, passkey);
    
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encryptedBuffer = Buffer.concat([
        cipher.update(videoBuffer),
        cipher.final()
    ]);
    
    return {
        data: encryptedBuffer,
        key: key.toString('hex'),
        iv: iv.toString('hex'),
        keySalt: keySalt.toString('hex'),
        ivSalt: ivSalt.toString('hex')
    };
}

export function decryptVideo(
    encryptedData: ArrayBuffer | Uint8Array,
    keySalt: string,
    ivSalt: string,
    passkey: string
): Buffer {
    const keySaltBuffer = Buffer.from(keySalt, "hex");
    const ivSaltBuffer = Buffer.from(ivSalt, "hex");
    const passkeyBuffer = Buffer.from(passkey, "utf8");
    
    const derivedKey = crypto.pbkdf2Sync(passkeyBuffer, keySaltBuffer, 100000, 32, "sha256");
    const derivedIv = crypto.pbkdf2Sync(passkeyBuffer, ivSaltBuffer, 100000, 16, "sha256");

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

export function decryptVideoWithTimelapseId(
    encryptedData: ArrayBuffer | Uint8Array,
    timelapseId: string,
    passkey: string
): Buffer {
    const { keySalt, ivSalt } = deriveSaltsFromTimelapseId(timelapseId);
    
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
