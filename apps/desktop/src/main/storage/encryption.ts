import {
  encryptData as sharedEncrypt,
  decryptData as sharedDecrypt,
  toHex,
  fromHex
} from "@hackclub/lapse-shared";

export { toHex, fromHex };

/**
 * Converts a Node.js `Buffer` (or `Uint8Array`) to an `ArrayBuffer`.
 * If the input is already an `ArrayBuffer`, it is returned as-is.
 */
function toArrayBuffer(input: Buffer | ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof ArrayBuffer) {
    return input;
  }

  // Buffer and Uint8Array may share an underlying ArrayBuffer with an offset,
  // so we need to slice to get a clean copy.
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    const buf = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    return buf as ArrayBuffer;
  }

  return input as ArrayBuffer;
}

/**
 * Encrypts `data` using AES-128-CBC via the given `key` and `iv`.
 * Accepts `Buffer`, `Uint8Array`, or `ArrayBuffer` inputs (in addition to the
 * `Blob | ArrayBuffer` accepted by the shared library).
 */
export async function encryptData(
  key: ArrayBuffer | Buffer | Uint8Array,
  iv: ArrayBuffer | Buffer | Uint8Array,
  data: ArrayBuffer | Buffer | Uint8Array
): Promise<ArrayBuffer> {
  return await sharedEncrypt(
    toArrayBuffer(key),
    toArrayBuffer(iv),
    toArrayBuffer(data)
  );
}

/**
 * Decrypts `data` using AES-128-CBC via the given `key` and `iv`.
 * Accepts `Buffer`, `Uint8Array`, or `ArrayBuffer` inputs (in addition to the
 * `Blob | ArrayBuffer` accepted by the shared library).
 */
export async function decryptData(
  key: ArrayBuffer | Buffer | Uint8Array,
  iv: ArrayBuffer | Buffer | Uint8Array,
  data: ArrayBuffer | Buffer | Uint8Array
): Promise<ArrayBuffer> {
  return await sharedDecrypt(
    toArrayBuffer(key),
    toArrayBuffer(iv),
    toArrayBuffer(data)
  );
}
