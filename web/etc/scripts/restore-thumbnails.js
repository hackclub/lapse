// @ts-check
"use strict";

import { parseArgs } from "node:util";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";

import { confirm } from "@inquirer/prompts";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import ffmpeg from "fluent-ffmpeg";

const WIDTH = 1280, HEIGHT = 720, QUALITY = 5;

/**
 * Generates a thumbnail from a video buffer using ffmpeg.
 * This matches the production logic in src/server/videoProcessing.ts.
 * @param {Buffer} videoBuffer
 * @returns {Promise<Buffer>}
 */
async function generateThumbnail(videoBuffer) {
    const tempDir = tmpdir();
    const inputPath = join(tempDir, `input-${randomUUID()}.mp4`);
    const outputPath = join(tempDir, `thumbnail-${randomUUID()}.jpg`);

    try {
        await fs.writeFile(inputPath, videoBuffer);

        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .outputOptions([
                    "-frames:v 1",
                    `-vf thumbnail,scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}`,
                    `-q:v ${QUALITY}`
                ])
                .output(outputPath)
                .on("end", () => resolve(undefined))
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
            catch {
                // Ignore cleanup errors
            }
        }
    }
}

/**
 * Checks if an S3 object exists.
 * @param {S3Client} s3
 * @param {string} bucket
 * @param {string} key
 * @returns {Promise<boolean>}
 */
async function s3ObjectExists(s3, bucket, key) {
    try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
    }
    catch (error) {
        if (error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404) {
            return false;
        }
        throw error;
    }
}

/**
 * Downloads an S3 object as a Buffer.
 * @param {S3Client} s3
 * @param {string} bucket
 * @param {string} key
 * @returns {Promise<Buffer>}
 */
async function downloadS3Object(s3, bucket, key) {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks = [];
    // @ts-ignore - Body is a readable stream
    for await (const chunk of response.Body) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

async function main() {
    const args = parseArgs({
        options: {
            "database-url": { type: "string" },
            "s3-endpoint": { type: "string" },
            "s3-access-key-id": { type: "string" },
            "s3-secret-access-key": { type: "string" },
            "s3-public-bucket": { type: "string" },
            "dry-run": { type: "string" }
        }
    });

    console.log("");

    const databaseUrl = args.values["database-url"];
    const s3Endpoint = args.values["s3-endpoint"];
    const s3AccessKeyId = args.values["s3-access-key-id"];
    const s3SecretAccessKey = args.values["s3-secret-access-key"];
    const s3PublicBucket = args.values["s3-public-bucket"];
    const dryRunOutputDir = args.values["dry-run"];

    if (!databaseUrl) {
        console.error("(error) Missing required parameter: --database-url");
        return;
    }
    if (!s3Endpoint) {
        console.error("(error) Missing required parameter: --s3-endpoint");
        return;
    }
    if (!s3AccessKeyId) {
        console.error("(error) Missing required parameter: --s3-access-key-id");
        return;
    }
    if (!s3SecretAccessKey) {
        console.error("(error) Missing required parameter: --s3-secret-access-key");
        return;
    }
    if (!s3PublicBucket) {
        console.error("(error) Missing required parameter: --s3-public-bucket");
        return;
    }

    const adapter = new PrismaPg({ connectionString: databaseUrl });
    const prisma = new PrismaClient({ adapter });

    const s3 = new S3Client({
        region: "auto",
        endpoint: `https://${s3Endpoint}`,
        credentials: {
            accessKeyId: s3AccessKeyId,
            secretAccessKey: s3SecretAccessKey
        }
    });

    try {
        const publishedTimelapses = await prisma.timelapse.findMany({
            where: { isPublished: true }
        });

        console.log(`(info) Found ${publishedTimelapses.length} published timelapse(s).`);

        const timelapsesNeedingThumbnails = [];

        for (const timelapse of publishedTimelapses) {
            const expectedThumbnailKey = timelapse.s3Key.replace(/\.(webm|mp4)$/, "-thumbnail.jpg");

            if (timelapse.thumbnailS3Key === null) {
                console.log(`(info) [${timelapse.id}] Thumbnail S3 key is NULL in database.`);
                timelapsesNeedingThumbnails.push({ timelapse, thumbnailKey: expectedThumbnailKey });
            }
            else {
                const exists = await s3ObjectExists(s3, s3PublicBucket, timelapse.thumbnailS3Key);
                if (!exists) {
                    console.log(`(info) [${timelapse.id}] Thumbnail S3 object is missing: ${timelapse.thumbnailS3Key}`);
                    timelapsesNeedingThumbnails.push({ timelapse, thumbnailKey: timelapse.thumbnailS3Key });
                }
            }
        }

        if (timelapsesNeedingThumbnails.length === 0) {
            console.log("(info) All published timelapses have valid thumbnails. Nothing to do.");
            return;
        }

        console.log(`(info) Found ${timelapsesNeedingThumbnails.length} timelapse(s) with missing thumbnails.`);

        if (dryRunOutputDir) {
            console.log(`(info) Dry run mode. Thumbnails will be saved to: ${dryRunOutputDir}`);
            await fs.mkdir(dryRunOutputDir, { recursive: true });

            let successCount = 0;
            let failureCount = 0;

            for (const { timelapse, thumbnailKey } of timelapsesNeedingThumbnails) {
                try {
                    console.log(`(info) [${timelapse.id}] Processing: ${timelapse.name}`);

                    console.log(`(info) [${timelapse.id}] Downloading video from S3...`);
                    const videoBuffer = await downloadS3Object(s3, s3PublicBucket, timelapse.s3Key);

                    console.log(`(info) [${timelapse.id}] Generating thumbnail...`);
                    const thumbnailBuffer = await generateThumbnail(videoBuffer);

                    const outputFileName = `${timelapse.id}.jpg`;
                    const outputPath = join(dryRunOutputDir, outputFileName);

                    console.log(`(info) [${timelapse.id}] Saving thumbnail to: ${outputPath}`);
                    await fs.writeFile(outputPath, thumbnailBuffer);

                    console.log(`(info) [${timelapse.id}] Thumbnail generated successfully.`);
                    successCount++;
                }
                catch (error) {
                    console.error(`(error) [${timelapse.id}] Failed to generate thumbnail:`, error);
                    failureCount++;
                }
            }

            console.log("");
            console.log(`(info) Dry run completed. ${successCount} thumbnail(s) generated, ${failureCount} failure(s).`);
            return;
        }

        if (!await confirm({ message: `Do you wish to restore ${timelapsesNeedingThumbnails.length} thumbnail(s)? (Y/N)` })) {
            console.log("(info) Aborted. No changes were made.");
            return;
        }

        let successCount = 0;
        let failureCount = 0;

        for (const { timelapse, thumbnailKey } of timelapsesNeedingThumbnails) {
            try {
                console.log(`(info) [${timelapse.id}] Processing: ${timelapse.name}`);

                console.log(`(info) [${timelapse.id}] Downloading video from S3...`);
                const videoBuffer = await downloadS3Object(s3, s3PublicBucket, timelapse.s3Key);

                console.log(`(info) [${timelapse.id}] Generating thumbnail...`);
                const thumbnailBuffer = await generateThumbnail(videoBuffer);

                console.log(`(info) [${timelapse.id}] Uploading thumbnail to S3: ${thumbnailKey}`);
                await s3.send(new PutObjectCommand({
                    Bucket: s3PublicBucket,
                    Key: thumbnailKey,
                    Body: thumbnailBuffer,
                    ContentType: "image/jpeg"
                }));

                console.log(`(info) [${timelapse.id}] Updating database...`);
                await prisma.timelapse.update({
                    where: { id: timelapse.id },
                    data: { thumbnailS3Key: thumbnailKey }
                });

                console.log(`(info) [${timelapse.id}] Thumbnail restored successfully.`);
                successCount++;
            }
            catch (error) {
                console.error(`(error) [${timelapse.id}] Failed to restore thumbnail:`, error);
                failureCount++;
            }
        }

        console.log("");
        console.log(`(info) Completed. ${successCount} thumbnail(s) restored, ${failureCount} failure(s).`);
    }
    finally {
        await prisma.$disconnect();
    }
}

main()
    .catch(async (e) => {
        console.error(e);
        process.exit(1);
    });
