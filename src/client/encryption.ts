import platform from "platform";

import { deviceStorage, LocalDevice } from "./deviceStorage";
import { trpc } from "./trpc";

/**
 * Derives deterministic key and IV salts from a timelapse ID.
 * This allows users to decrypt timelapses on any device using just the passkey and timelapse ID.
 */
async function deriveSaltsFromTimelapseId(timelapseId: string): Promise<{ keySalt: ArrayBuffer; ivSalt: ArrayBuffer }> {
    const encoder = new TextEncoder();
    
    // Use HMAC to derive deterministic salts from the timelapse ID
    const keySaltKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode("timelapse-key-salt"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const keySalt = await crypto.subtle.sign("HMAC", keySaltKey, encoder.encode(timelapseId));
    
    const ivSaltKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode("timelapse-iv-salt"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const ivSalt = await crypto.subtle.sign("HMAC", ivSaltKey, encoder.encode(timelapseId));
    
    return { keySalt, ivSalt };
}

function generatePasskey() {
    const RANGE = 1_000_000; // 10^6 possible PINs: 000000 .. 999999
    const UINT32_MAX_PLUS_ONE = 2 ** 32; // since getRandomValues gives 0..2^32-1

    // Largest multiple of RANGE less than 2^32 to avoid modulo bias
    const threshold = Math.floor(UINT32_MAX_PLUS_ONE / RANGE) * RANGE;

    const buf = new Uint32Array(1);
    while (true) {
        crypto.getRandomValues(buf);
        const r = buf[0];
        if (r < threshold) { // rejection sampling
            const pin = String(r % RANGE).padStart(6, '0');
            return pin;
        }

        // otherwise try again (very low chance)
    }
}

export async function getCurrentDevice(): Promise<LocalDevice> {
    const existing = (await deviceStorage.getAllDevices()).find(x => x.thisDevice);
    if (existing)
        return existing;

    // We haven't registered this device with the server yet! Assign it an ID.
    const req = await trpc.user.registerDevice.mutate({
        name: platform.description ?? navigator.platform
    });

    if (!req.ok)
        throw new Error(req.error);

    const assignedDevice = req.data.device;
    const device: LocalDevice = {
        id: assignedDevice.id,
        name: assignedDevice.name,
        passkey: generatePasskey(),
        thisDevice: true
    };
    
    deviceStorage.saveDevice(device);
    return device;
}

export interface KeyIvPair {
    key: ArrayBuffer;
    iv: ArrayBuffer;
    keySalt: ArrayBuffer;
    ivSalt: ArrayBuffer;
}

export interface EncryptedVideoStream {
    data: ArrayBuffer;
    key: string;
    iv: string;
    keySalt: string;
    ivSalt: string;
}

export async function deriveKeyAndIvWithTimelapseId(timelapseId: string, passkey?: string): Promise<KeyIvPair> {
    const actualPasskey = passkey || (await getCurrentDevice()).passkey;
    const { keySalt, ivSalt } = await deriveSaltsFromTimelapseId(timelapseId);

    const encoder = new TextEncoder();
    const passkeyBuffer = encoder.encode(actualPasskey);
    
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        passkeyBuffer,
        { name: "PBKDF2" },
        false,
        ["deriveKey", "deriveBits"]
    );

    const key = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: keySalt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-CBC", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );

    // Derive IV (128 bits for AES-CBC)
    const ivBuffer = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: ivSalt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        128
    );

    const keyBuffer = await crypto.subtle.exportKey("raw", key);
    
    return {
        key: keyBuffer,
        iv: ivBuffer,
        keySalt,
        ivSalt
    };
}



export async function encryptVideo(videoBlob: Blob, timelapseId: string): Promise<EncryptedVideoStream> {
    const { key, iv, keySalt, ivSalt } = await deriveKeyAndIvWithTimelapseId(timelapseId);
    const videoBuffer = await videoBlob.arrayBuffer();

    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key,
        { name: "AES-CBC" },
        false,
        ["encrypt"]
    );

    // Encrypt the video data
    const encryptedBuffer = await crypto.subtle.encrypt(
        { name: "AES-CBC", iv: iv },
        cryptoKey,
        videoBuffer
    );

    return {
        data: encryptedBuffer,
        key: Array.from(new Uint8Array(key)).map(b => b.toString(16).padStart(2, "0")).join(""),
        iv: Array.from(new Uint8Array(iv)).map(b => b.toString(16).padStart(2, "0")).join(""),
        keySalt: Array.from(new Uint8Array(keySalt)).map(b => b.toString(16).padStart(2, "0")).join(""),
        ivSalt: Array.from(new Uint8Array(ivSalt)).map(b => b.toString(16).padStart(2, "0")).join("")
    };
}

export async function encryptVideoWithTimelapseId(videoBlob: Blob, timelapseId: string): Promise<EncryptedVideoStream> {
    const { key, iv, keySalt, ivSalt } = await deriveKeyAndIvWithTimelapseId(timelapseId);
    const videoBuffer = await videoBlob.arrayBuffer();

    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key,
        { name: "AES-CBC" },
        false,
        ["encrypt"]
    );

    // Encrypt the video data
    const encryptedBuffer = await crypto.subtle.encrypt(
        { name: "AES-CBC", iv: iv },
        cryptoKey,
        videoBuffer
    );

    return {
        data: encryptedBuffer,
        key: Array.from(new Uint8Array(key)).map(b => b.toString(16).padStart(2, "0")).join(""),
        iv: Array.from(new Uint8Array(iv)).map(b => b.toString(16).padStart(2, "0")).join(""),
        keySalt: Array.from(new Uint8Array(keySalt)).map(b => b.toString(16).padStart(2, "0")).join(""),
        ivSalt: Array.from(new Uint8Array(ivSalt)).map(b => b.toString(16).padStart(2, "0")).join("")
    };
}

export async function deriveKeyAndIvFromSalts(keySalt: ArrayBuffer, ivSalt: ArrayBuffer): Promise<KeyIvPair> {
    const currentDevice = await getCurrentDevice();

    const encoder = new TextEncoder();
    const passkeyBuffer = encoder.encode(currentDevice.passkey);
    
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        passkeyBuffer,
        { name: "PBKDF2" },
        false,
        ["deriveKey", "deriveBits"]
    );

    const key = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: keySalt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-CBC", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );

    // Derive IV (128 bits for AES-CBC)
    const ivBuffer = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: ivSalt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        128
    );

    const keyBuffer = await crypto.subtle.exportKey("raw", key);
    
    return {
        key: keyBuffer,
        iv: ivBuffer,
        keySalt,
        ivSalt
    };
}

export async function decryptVideo(
    encryptedData: ArrayBuffer | Uint8Array,
    keySalt: string,
    ivSalt: string,
    passkey: string
): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const passkeyBuffer = encoder.encode(passkey);
    
    // Convert hex strings back to Uint8Arrays
    const keySaltBuffer = new Uint8Array(keySalt.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
    const ivSaltBuffer = new Uint8Array(ivSalt.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
    
    // Convert input data to ArrayBuffer
    const inputBuffer = encryptedData instanceof Uint8Array 
        ? encryptedData.slice().buffer
        : encryptedData;
    
    // Import the passkey as key material
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        passkeyBuffer,
        { name: "PBKDF2" },
        false,
        ["deriveKey", "deriveBits"]
    );

    // Derive the encryption key
    const derivedKey = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: keySaltBuffer,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-CBC", length: 256 },
        false,
        ["decrypt"]
    );

    // Derive the IV
    const derivedIv = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: ivSaltBuffer,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        128
    );

    // Decrypt the video data
    const decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: derivedIv },
        derivedKey,
        inputBuffer
    );

    return decryptedBuffer;
}

export async function decryptVideoWithTimelapseId(
    encryptedData: ArrayBuffer | Uint8Array,
    timelapseId: string,
    passkey: string
): Promise<ArrayBuffer> {
    const { key, iv } = await deriveKeyAndIvWithTimelapseId(timelapseId, passkey);
    
    // Convert input data to ArrayBuffer
    const inputBuffer = encryptedData instanceof Uint8Array 
        ? encryptedData.slice().buffer
        : encryptedData;
    
    // Import the derived key
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key,
        { name: "AES-CBC" },
        false,
        ["decrypt"]
    );

    // Decrypt the video data
    const decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: iv },
        cryptoKey,
        inputBuffer
    );

    return decryptedBuffer;
}