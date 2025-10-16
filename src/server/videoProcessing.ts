import "@/server/allow-only-server";

import ffmpeg from "fluent-ffmpeg";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";

/**
 * Generates a thumbnail image from video data using FFmpeg on the server.
 */
export async function generateServerThumbnail(
    videoBuffer: Buffer,
    options?: {
        width?: number;
        height?: number;
        timeOffset?: number;
        quality?: number;
    }
): Promise<Buffer> {
    const { width = 480, height = 360, timeOffset = 1, quality = 3 } = options || {};
    
    const tempDir = tmpdir();
    const inputPath = join(tempDir, `input-${randomUUID()}.mp4`);
    const outputPath = join(tempDir, `thumbnail-${randomUUID()}.jpg`);
    
    try {
        // Write video buffer to temporary file
        await fs.writeFile(inputPath, videoBuffer);
        
        // Generate thumbnail using fluent-ffmpeg
        await new Promise<void>((resolve, reject) => {
            ffmpeg(inputPath)
                .seekInput(timeOffset)
                .outputOptions([
                    "-vframes 1",
                    `-vf scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
                    `-q:v ${quality}`
                ])
                .output(outputPath)
                .on("end", () => resolve())
                .on("error", (err) => reject(err))
                .run();
        });
        
        // Read the generated thumbnail
        const thumbnailBuffer = await fs.readFile(outputPath);
        
        return thumbnailBuffer;
    }
    finally {
        // Clean up temporary files
        try {
            await fs.unlink(inputPath);
        }
        catch {}
        
        try {
            await fs.unlink(outputPath);
        }
        catch {}
    }
}

/**
 * Checks if FFmpeg is available on the system.
 */
export function checkFFmpegAvailability(): Promise<boolean> {
    return new Promise((resolve) => {
        ffmpeg()
            .getAvailableFormats((err) => {
                resolve(!err);
            });
    });
}
