import platform from "platform";

import { deviceStorage, LocalDevice } from "./deviceStorage";
import { trpc } from "./trpc";

/**
 * Derives deterministic key and IV salts from a timelapse ID.
 */
// TODO: We should also probably generate the salt based on the provided passkey
async function deriveSalts(timelapseId: string): Promise<{ keySalt: ArrayBuffer; ivSalt: ArrayBuffer }> {
    const encoder = new TextEncoder();
    
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

async function deriveKeyIvPair(timelapseId: string, passkey?: string): Promise<KeyIvPair> {
    const actualPasskey = passkey || (await getCurrentDevice()).passkey;
    const { keySalt, ivSalt } = await deriveSalts(timelapseId);

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

export async function encryptVideo(
    videoBlob: Blob, 
    timelapseId: string,
    onProgress?: (stage: string, progress: number) => void
): Promise<EncryptedVideoStream> {
    onProgress?.("Deriving encryption keys...", 5);
    const { key, iv, keySalt, ivSalt } = await deriveKeyIvPair(timelapseId);
    
    onProgress?.("Reading video data...", 15);
    const videoBuffer = await videoBlob.arrayBuffer();

    onProgress?.("Preparing encryption...", 25);
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key,
        { name: "AES-CBC" },
        false,
        ["encrypt"]
    );

    const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
    const totalSize = videoBuffer.byteLength;
    
    onProgress?.("Encrypting video data...", 30);
    
    if (totalSize <= CHUNK_SIZE) {
        // Small video - encrypt all at once
        const encryptedBuffer = await crypto.subtle.encrypt(
            { name: "AES-CBC", iv: iv },
            cryptoKey,
            videoBuffer
        );
        
        onProgress?.("Encryption complete", 100);
        
        return {
            data: encryptedBuffer,
            key: Array.from(new Uint8Array(key)).map(b => b.toString(16).padStart(2, "0")).join(""),
            iv: Array.from(new Uint8Array(iv)).map(b => b.toString(16).padStart(2, "0")).join(""),
            keySalt: Array.from(new Uint8Array(keySalt)).map(b => b.toString(16).padStart(2, "0")).join(""),
            ivSalt: Array.from(new Uint8Array(ivSalt)).map(b => b.toString(16).padStart(2, "0")).join("")
        };
    }
    
    const chunks: ArrayBuffer[] = [];
    const numChunks = Math.ceil(totalSize / CHUNK_SIZE);
    
    for (let i = 0; i < numChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, totalSize);
        const chunk = videoBuffer.slice(start, end);
        
        const encryptedChunk = await crypto.subtle.encrypt(
            { name: "AES-CBC", iv: iv },
            cryptoKey,
            chunk
        );
        
        chunks.push(encryptedChunk);
        
        const progress = 30 + Math.floor(((i + 1) / numChunks) * 65);
        onProgress?.(`Encrypting chunk ${i + 1}/${numChunks}...`, progress);
    }
    
    onProgress?.("Combining encrypted chunks...", 95);
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new ArrayBuffer(totalLength);
    const combinedView = new Uint8Array(combined);
    
    let offset = 0;
    for (const chunk of chunks) {
        combinedView.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
    }

    onProgress?.("Encryption complete", 100);

    return {
        data: combined,
        key: Array.from(new Uint8Array(key)).map(b => b.toString(16).padStart(2, "0")).join(""),
        iv: Array.from(new Uint8Array(iv)).map(b => b.toString(16).padStart(2, "0")).join(""),
        keySalt: Array.from(new Uint8Array(keySalt)).map(b => b.toString(16).padStart(2, "0")).join(""),
        ivSalt: Array.from(new Uint8Array(ivSalt)).map(b => b.toString(16).padStart(2, "0")).join("")
    };
}

export async function decryptVideo(
    encryptedData: ArrayBuffer | Uint8Array,
    timelapseId: string,
    passkey: string
): Promise<ArrayBuffer> {
    const { key, iv } = await deriveKeyIvPair(timelapseId, passkey);
    
    const inputBuffer = encryptedData instanceof Uint8Array 
        ? encryptedData.slice().buffer
        : encryptedData;
    
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key,
        { name: "AES-CBC" },
        false,
        ["decrypt"]
    );

    const decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: iv },
        cryptoKey,
        inputBuffer
    );

    return decryptedBuffer;
}