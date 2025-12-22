// @ts-check
"use strict";

import { parseArgs } from "node:util";
import { join } from "path";
import { promises as fs } from "fs";

import { confirm } from "@inquirer/prompts";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

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

/**
 * Lists all objects in an S3 bucket.
 * @param {S3Client} s3
 * @param {string} bucket
 * @returns {Promise<string[]>}
 */
async function listAllS3Objects(s3, bucket) {
    const keys = [];
    let continuationToken = undefined;

    do {
        const response = await s3.send(new ListObjectsV2Command({
            Bucket: bucket,
            ContinuationToken: continuationToken
        }));

        if (response.Contents) {
            for (const obj of response.Contents) {
                if (obj.Key) {
                    keys.push(obj.Key);
                }
            }
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return keys;
}

async function main() {
    const args = parseArgs({
        options: {
            "database-url": { type: "string" },
            "s3-endpoint": { type: "string" },
            "s3-access-key-id": { type: "string" },
            "s3-secret-access-key": { type: "string" },
            "s3-public-bucket": { type: "string" },
            "s3-encrypted-bucket": { type: "string" },
            "output-dir": { type: "string" },
            "dry-run": { type: "boolean", default: false }
        }
    });

    console.log("");

    const databaseUrl = args.values["database-url"];
    const s3Endpoint = args.values["s3-endpoint"];
    const s3AccessKeyId = args.values["s3-access-key-id"];
    const s3SecretAccessKey = args.values["s3-secret-access-key"];
    const s3PublicBucket = args.values["s3-public-bucket"];
    const s3EncryptedBucket = args.values["s3-encrypted-bucket"];
    const outputDir = args.values["output-dir"];
    const dryRun = args.values["dry-run"] ?? false;

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
    if (!s3EncryptedBucket) {
        console.error("(error) Missing required parameter: --s3-encrypted-bucket");
        return;
    }
    if (!outputDir) {
        console.error("(error) Missing required parameter: --output-dir");
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
        console.log("(info) Fetching all database references...");

        const [timelapses, uploadTokens] = await Promise.all([
            prisma.timelapse.findMany({
                select: { id: true, s3Key: true, thumbnailS3Key: true, isPublished: true }
            }),
            prisma.uploadToken.findMany({
                select: { id: true, key: true, bucket: true, uploaded: true }
            })
        ]);

        const referencedPublicKeys = new Set();
        const referencedEncryptedKeys = new Set();

        for (const timelapse of timelapses) {
            if (timelapse.isPublished) {
                referencedPublicKeys.add(timelapse.s3Key);
                if (timelapse.thumbnailS3Key) {
                    referencedPublicKeys.add(timelapse.thumbnailS3Key);
                }
            }
            else {
                referencedEncryptedKeys.add(timelapse.s3Key);
                if (timelapse.thumbnailS3Key) {
                    referencedEncryptedKeys.add(timelapse.thumbnailS3Key);
                }
            }
        }

        for (const token of uploadTokens) {
            if (token.bucket === s3PublicBucket) {
                referencedPublicKeys.add(token.key);
            }
            else if (token.bucket === s3EncryptedBucket) {
                referencedEncryptedKeys.add(token.key);
            }
        }

        console.log(`(info) Found ${referencedPublicKeys.size} referenced key(s) in public bucket.`);
        console.log(`(info) Found ${referencedEncryptedKeys.size} referenced key(s) in encrypted bucket.`);

        console.log("(info) Listing all S3 objects...");

        const [publicObjects, encryptedObjects] = await Promise.all([
            listAllS3Objects(s3, s3PublicBucket),
            listAllS3Objects(s3, s3EncryptedBucket)
        ]);

        console.log(`(info) Found ${publicObjects.length} object(s) in public bucket.`);
        console.log(`(info) Found ${encryptedObjects.length} object(s) in encrypted bucket.`);

        const orphanedPublic = publicObjects.filter(key => !referencedPublicKeys.has(key));
        const orphanedEncrypted = encryptedObjects.filter(key => !referencedEncryptedKeys.has(key));

        console.log(`(info) Found ${orphanedPublic.length} orphaned object(s) in public bucket.`);
        console.log(`(info) Found ${orphanedEncrypted.length} orphaned object(s) in encrypted bucket.`);

        const totalOrphaned = orphanedPublic.length + orphanedEncrypted.length;

        if (totalOrphaned === 0) {
            console.log("(info) No orphaned objects found. Nothing to do.");
            return;
        }

        if (dryRun) {
            console.log("(info) Dry run mode. Listing orphaned objects:");
            console.log("");
            console.log("Public bucket orphans:");
            for (const key of orphanedPublic) {
                console.log(`  - ${key}`);
            }
            console.log("");
            console.log("Encrypted bucket orphans:");
            for (const key of orphanedEncrypted) {
                console.log(`  - ${key}`);
            }
            return;
        }

        console.log("");
        console.log("(warning) This will DELETE the orphaned objects from S3.");
        console.log("(warning) Objects will be downloaded to the output directory before deletion.");

        if (!await confirm({ message: `Do you wish to remove ${totalOrphaned} orphaned object(s)? (Y/N)` })) {
            console.log("(info) Aborted. No changes were made.");
            return;
        }

        const publicOutputDir = join(outputDir, "public");
        const encryptedOutputDir = join(outputDir, "encrypted");

        await fs.mkdir(publicOutputDir, { recursive: true });
        await fs.mkdir(encryptedOutputDir, { recursive: true });

        let successCount = 0;
        let failureCount = 0;

        for (const key of orphanedPublic) {
            try {
                console.log(`(info) [public] Downloading: ${key}`);
                const buffer = await downloadS3Object(s3, s3PublicBucket, key);

                const safeFileName = key.replace(/\//g, "_");
                const outputPath = join(publicOutputDir, safeFileName);
                await fs.writeFile(outputPath, buffer);

                console.log(`(info) [public] Deleting: ${key}`);
                await s3.send(new DeleteObjectCommand({
                    Bucket: s3PublicBucket,
                    Key: key
                }));

                console.log(`(info) [public] Removed: ${key}`);
                successCount++;
            }
            catch (error) {
                console.error(`(error) [public] Failed to process ${key}:`, error);
                failureCount++;
            }
        }

        for (const key of orphanedEncrypted) {
            try {
                console.log(`(info) [encrypted] Downloading: ${key}`);
                const buffer = await downloadS3Object(s3, s3EncryptedBucket, key);

                const safeFileName = key.replace(/\//g, "_");
                const outputPath = join(encryptedOutputDir, safeFileName);
                await fs.writeFile(outputPath, buffer);

                console.log(`(info) [encrypted] Deleting: ${key}`);
                await s3.send(new DeleteObjectCommand({
                    Bucket: s3EncryptedBucket,
                    Key: key
                }));

                console.log(`(info) [encrypted] Removed: ${key}`);
                successCount++;
            }
            catch (error) {
                console.error(`(error) [encrypted] Failed to process ${key}:`, error);
                failureCount++;
            }
        }

        console.log("");
        console.log(`(info) Completed. ${successCount} object(s) removed, ${failureCount} failure(s).`);
        console.log(`(info) Backed up objects saved to: ${outputDir}`);
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
