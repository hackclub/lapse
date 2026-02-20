/**
 * Shared encryption types and interfaces used across client and server
 */

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
