import { invoke } from "@tauri-apps/api/core";
import { encryptData, fromHex } from "@hackclub/lapse-shared";
import { api, apiUpload } from "./api";
import { getCurrentDevice } from "./device";

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

export interface UploadProgress {
  stage: string;
  progress: number;
}

export async function uploadTimelapse(params: {
  outputPath: string;
  thumbnailPath: string;
  snapshots: number[];
  onProgress: (p: UploadProgress) => void;
}): Promise<{ draftId: string; devicePasskey: string }> {
  const { outputPath, thumbnailPath, snapshots, onProgress } = params;

  onProgress({ stage: "Registering device...", progress: 0 });
  const device = await getCurrentDevice();

  onProgress({ stage: "Reading files...", progress: 0.05 });
  const videoB64 = await invoke<string>("read_file_bytes", { path: outputPath });
  const videoBytes = base64ToArrayBuffer(videoB64);
  const thumbB64 = await invoke<string>("read_file_bytes", { path: thumbnailPath });
  const thumbBytes = base64ToArrayBuffer(thumbB64);

  const videoSize = videoBytes.byteLength;
  const thumbSize = thumbBytes.byteLength;
  // AES-CBC padding adds up to 16 bytes
  const encryptedVideoSize = Math.ceil(videoSize / 16 + 1) * 16;
  const encryptedThumbSize = Math.ceil(thumbSize / 16 + 1) * 16;

  onProgress({ stage: "Creating draft...", progress: 0.1 });
  const draftRes = await api.draftTimelapse.create({
    name: "Lapse Recording",
    snapshots,
    deviceId: device.id,
    sessions: [{ fileSize: encryptedVideoSize }],
    thumbnailSize: encryptedThumbSize,
  });

  if (!draftRes.ok) {
    throw new Error(`Failed to create draft: ${draftRes.message}`);
  }

  const { draftTimelapse, sessionUploadTokens, thumbnailUploadToken } =
    draftRes.data;
  const iv = fromHex(draftTimelapse.iv);
  const key = fromHex(device.passkey);

  onProgress({ stage: "Encrypting video...", progress: 0.2 });
  const encryptedVideo = await encryptData(
    key.buffer as ArrayBuffer,
    iv.buffer as ArrayBuffer,
    videoBytes
  );

  onProgress({ stage: "Uploading video...", progress: 0.3 });
  await apiUpload(
    sessionUploadTokens[0],
    new Blob([encryptedVideo]),
    (uploaded, total) => {
      const fraction = total > 0 ? uploaded / total : 0;
      onProgress({
        stage: "Uploading video...",
        progress: 0.3 + fraction * 0.5,
      });
    }
  );

  onProgress({ stage: "Encrypting thumbnail...", progress: 0.8 });
  const encryptedThumb = await encryptData(
    key.buffer as ArrayBuffer,
    iv.buffer as ArrayBuffer,
    thumbBytes
  );

  onProgress({ stage: "Uploading thumbnail...", progress: 0.85 });
  await apiUpload(thumbnailUploadToken, new Blob([encryptedThumb]));

  onProgress({ stage: "Done!", progress: 1.0 });
  return { draftId: draftTimelapse.id, devicePasskey: device.passkey };
}
