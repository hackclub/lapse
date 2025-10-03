import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

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
