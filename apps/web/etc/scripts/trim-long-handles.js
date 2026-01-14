// @ts-check
"use strict";

import { parseArgs } from "node:util";

import { confirm } from "@inquirer/prompts";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";

const MAX_HANDLE_LENGTH = 16;

async function main() {
    const args = parseArgs({
        options: {
            "database-url": { type: "string" },
            "dry-run": { type: "boolean", default: false }
        }
    });

    console.log("");

    const databaseUrl = args.values["database-url"];
    const dryRun = args.values["dry-run"] ?? false;

    if (!databaseUrl) {
        console.error("(error) Missing required parameter: --database-url");
        return;
    }

    const adapter = new PrismaPg({ connectionString: databaseUrl });
    const prisma = new PrismaClient({ adapter });

    try {
        console.log("(info) Finding users with handles longer than 16 characters...");

        const usersWithLongHandles = await prisma.user.findMany({
            where: {
                handle: {
                    not: {
                        // Prisma doesn't support length filters directly, so we fetch all and filter
                    }
                }
            },
            select: { id: true, handle: true, displayName: true }
        });

        const affectedUsers = usersWithLongHandles.filter(user => user.handle.length > MAX_HANDLE_LENGTH);

        if (affectedUsers.length === 0) {
            console.log("(info) No users found with handles longer than 16 characters. Nothing to do.");
            return;
        }

        console.log(`(info) Found ${affectedUsers.length} user(s) with handles longer than 16 characters:`);
        console.log("");

        for (const user of affectedUsers) {
            const trimmedHandle = user.handle.substring(0, MAX_HANDLE_LENGTH);
            console.log(`  - [${user.id}] "${user.handle}" (${user.handle.length} chars) -> "${trimmedHandle}"`);
        }

        console.log("");

        if (dryRun) {
            console.log("(info) Dry run mode. No changes were made.");
            return;
        }

        if (!await confirm({ message: `Do you wish to trim ${affectedUsers.length} handle(s)? (Y/N)` })) {
            console.log("(info) Aborted. No changes were made.");
            return;
        }

        let successCount = 0;
        let failureCount = 0;

        for (const user of affectedUsers) {
            const trimmedHandle = user.handle.substring(0, MAX_HANDLE_LENGTH);

            try {
                await prisma.user.update({
                    where: { id: user.id },
                    data: { handle: trimmedHandle }
                });

                console.log(`(info) [${user.id}] Handle updated: "${user.handle}" -> "${trimmedHandle}"`);
                successCount++;
            }
            catch (error) {
                console.error(`(error) [${user.id}] Failed to update handle:`, error);
                failureCount++;
            }
        }

        console.log("");
        console.log(`(info) Completed. ${successCount} handle(s) trimmed, ${failureCount} failure(s).`);
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