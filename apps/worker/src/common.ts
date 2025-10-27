/**
 * Identifies an S3 object by its bucket and object name.
 */
export interface S3Object {
    bucket: string;
    name: string;
}

/**
 * Data required to decrypt data encrypted on the client-side.
 */
export interface CryptographicData {
    timelapseId: string;
    passkey: string;
}