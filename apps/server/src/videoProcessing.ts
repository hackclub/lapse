import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";

import { logWarning } from "@/logging.js";

const execFileAsync = promisify(execFile);

export async function generateThumbnail(videoBuffer: Buffer): Promise<Buffer> {
    const tempDir = tmpdir();
    const inputPath = join(tempDir, `input-${randomUUID()}.mp4`);
    const outputPath = join(tempDir, `thumbnail-${randomUUID()}.jpg`);
    
    const WIDTH = 1280, HEIGHT = 720, QUALITY = 5;

    try {
        await fs.writeFile(inputPath, videoBuffer);

        await execFileAsync("ffmpeg", [
            "-i", inputPath,
            "-frames:v", "1",
            "-vf", `thumbnail,scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}`,
            "-q:v", `${QUALITY}`,
            outputPath
        ]);

        return await fs.readFile(outputPath);
    }
    finally {
        for (const path of [inputPath, outputPath]) {
            try {
                await fs.unlink(path);
            }
            catch (error) {
                logWarning("video", `could not delete temporary file ${path}!`, { error });
            }
        }
    }
}
