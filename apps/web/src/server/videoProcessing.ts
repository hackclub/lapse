import "@/server/allow-only-server";

import ffmpeg from "fluent-ffmpeg";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";

import { logWarning } from "@/server/serverCommon";

export async function generateThumbnail(videoBuffer: Buffer): Promise<Buffer> {
    const tempDir = tmpdir();
    const inputPath = join(tempDir, `input-${randomUUID()}.mp4`);
    const outputPath = join(tempDir, `thumbnail-${randomUUID()}.jpg`);
    
    const WIDTH = 1280, HEIGHT = 720, QUALITY = 5;

    try {
        await fs.writeFile(inputPath, videoBuffer);

        await new Promise<void>((resolve, reject) => {
            ffmpeg(inputPath)
                .outputOptions([
                    "-frames:v 1",
                    `-vf thumbnail,scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}`,
                    `-q:v ${QUALITY}`
                ])
                .output(outputPath)
                .on("end", () => resolve())
                .on("error", (apiErr) => reject(apiErr))
                .run();
        });
        
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
