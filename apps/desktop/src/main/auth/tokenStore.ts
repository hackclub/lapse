import * as fs from "node:fs/promises";
import * as path from "node:path";
import { app, safeStorage } from "electron";

/**
 * Returns the path to the encrypted auth token file.
 */
function getTokenPath(): string {
  return path.join(app.getPath("userData"), "lapse", "auth.enc");
}

/**
 * Persists an OAuth access token to disk.
 *
 * When Electron's `safeStorage` is available (Keychain on macOS, DPAPI on
 * Windows, libsecret on Linux), the token is encrypted before writing. If
 * `safeStorage` is not available, the token is stored as plain text so that
 * the app still works on minimal environments.
 */
export async function saveToken(token: string): Promise<void> {
  const tokenPath = getTokenPath();
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(token);
    await fs.writeFile(tokenPath, encrypted);
  } else {
    console.warn("(tokenStore.ts) safeStorage unavailable -- storing token as plain text");
    await fs.writeFile(tokenPath, token, "utf-8");
  }
}

/**
 * Loads a previously persisted OAuth access token from disk.
 * Returns `null` if no token has been saved or the file cannot be read.
 */
export async function loadToken(): Promise<string | null> {
  const tokenPath = getTokenPath();

  let data: Buffer;
  try {
    data = await fs.readFile(tokenPath);
  } catch {
    return null;
  }

  if (data.length === 0) {
    return null;
  }

  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(data);
    } catch {
      // The file may have been written as plain text on a previous run where
      // safeStorage was unavailable. Fall through to return as UTF-8.
      console.warn("(tokenStore.ts) decryption failed -- attempting plain text read");
      return data.toString("utf-8");
    }
  }

  return data.toString("utf-8");
}

/**
 * Removes the persisted token from disk.
 */
export async function clearToken(): Promise<void> {
  const tokenPath = getTokenPath();

  try {
    await fs.unlink(tokenPath);
  } catch {
    // File may not exist -- that is fine.
  }
}
