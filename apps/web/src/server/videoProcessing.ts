import "./allow-only-server";

import ffmpeg from "fluent-ffmpeg";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";

import { logWarning } from "./serverCommon";

export async function generateThumbnail(videoBuffer: Buffer): Promise<Buffer> {
    const tempDir = tmpdir();
    const inputPath = join(tempDir, `input-${randomUUID()}.mp4`);
    const outputPath = join(tempDir, `thumbnail-${randomUUID()}.jpg`);
    
    const WIDTH = 480, HEIGHT = 360, QUALITY = 3;

    try {
        await fs.writeFile(inputPath, videoBuffer);

        await new Promise<void>((resolve, reject) => {
            ffmpeg(inputPath)
                .outputOptions([
                    "-frames:v 1",
                    `-vf thumbnail,scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
                    `-q:v ${QUALITY}`
                ])
                .output(outputPath)
                .on("end", () => resolve())
                .on("error", (err) => reject(err))
                .run();
        });
        
        return await fs.readFile(outputPath);
    }
    finally {
        for (const path of [inputPath, outputPath]) {
            try {
                await fs.unlink(path);
            }
            catch (ex) {
                logWarning("video", `could not delete temporary file ${path}:`, ex);
            }
        }
    }
}
