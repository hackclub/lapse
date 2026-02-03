import platform from "platform";

import type { KnownDevice } from "@/client/api";
import { deviceStorage, LocalDevice } from "@/client/deviceStorage";
import { trpc } from "@/client/trpc";

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

export async function registerCurrentDevice(): Promise<LocalDevice> {
    const res = await trpc.user.registerDevice.mutate({
        name: platform.description ?? navigator.platform
    });

    if (!res.ok)
        throw new Error(res.error);

    const assignedDevice = res.data.device;
    const device: LocalDevice = {
        id: assignedDevice.id,
        passkey: generatePasskey(),
        thisDevice: true
    };
    
    await deviceStorage.saveDevice(device);
    await deviceStorage.sync();
    return device;
}

export async function getCurrentDevice(): Promise<LocalDevice> {
    const existing = (await deviceStorage.getAllDevices()).find(x => x.thisDevice);
    if (existing) {
        const res = await trpc.user.getDevices.query({});

        if (res.ok) {
            if (res.data.devices.some((d: KnownDevice) => d.id === existing.id))
                return existing;
            
            console.warn("(encryption.ts) this device has been removed remotely. re-registering!");
            await deviceStorage.deleteDevice(existing.id);
        }
        else {
            console.error("(encryption.ts) user.getDevices failed!", res);
            console.error("(encryption.ts) assuming this device exists on the server, but something went ary!");
        }
    }

    // We haven't registered this device with the server yet! Assign it an ID.
    return await registerCurrentDevice();
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

export interface EncryptedDataStream {
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

export async function encryptData(
    dataBlob: Blob, 
    timelapseId: string,
    onProgress?: (stage: string, progress: number) => void
): Promise<EncryptedDataStream> {
    onProgress?.("Deriving encryption keys...", 5);
    const { key, iv, keySalt, ivSalt } = await deriveKeyIvPair(timelapseId);
    
    onProgress?.("Reading data...", 15);
    const dataBuffer = await dataBlob.arrayBuffer();

    onProgress?.("Preparing encryption...", 25);
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key,
        { name: "AES-CBC" },
        false,
        ["encrypt"]
    );
    
    onProgress?.("Encrypting data...", 30);
    
    // Encrypt the entire data as one continuous stream to avoid IV reuse
    // AES-CBC requires unique IVs or proper chaining between blocks
    const encryptedBuffer = await crypto.subtle.encrypt(
        { name: "AES-CBC", iv: iv },
        cryptoKey,
        dataBuffer
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

export async function encryptVideo(
    videoBlob: Blob, 
    timelapseId: string,
    onProgress?: (stage: string, progress: number) => void
): Promise<EncryptedVideoStream> {
    return encryptData(videoBlob, timelapseId, onProgress);
}

export async function decryptData(
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

    try {
        return await crypto.subtle.decrypt(
            { name: "AES-CBC", iv: iv },
            cryptoKey,
            inputBuffer
        );
    }
    catch (err) {
        console.warn(`(encryption.ts) decryption failed! passkey=${passkey}, id=${timelapseId}`, err, encryptedData);
        throw err;
    }
}

export async function decryptVideo(
    encryptedData: ArrayBuffer | Uint8Array,
    timelapseId: string,
    passkey: string
): Promise<ArrayBuffer> {
    return decryptData(encryptedData, timelapseId, passkey);
}