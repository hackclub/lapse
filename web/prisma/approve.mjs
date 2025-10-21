// @ts-check
"use strict";

import { PrismaClient } from "../src/generated/prisma/index.js";
import { parseArgs } from "node:util";
import { confirm } from "@inquirer/prompts";

const prisma = new PrismaClient();
async function main() {
    const args = parseArgs({
        options: {
            email: { type: "string" },
            slackId: { type: "string" }
        }
    });

    console.log("");

    if (!args.values.email && !args.values.slackId) {
        const pendingUsers = await prisma.user.findMany({
            where: { permissionLevel: "UNCONFIRMED" },
            orderBy: { createdAt: "desc" }
        });

        if (pendingUsers.length === 0) {
            console.log("(info) No users are pending approval.");
            return;
        }

        console.log(`Found ${pendingUsers.length} user${pendingUsers.length !== 1 ? "s" : ""} pending approval:`);

        for (const user of pendingUsers) {
            console.log(`  - @${user.handle} (${user.displayName})`);
            console.log(`    id:           ${user.id}`);
            console.log(`    email:        ${user.email}`);
            console.log(`    slack ID:     ${user.slackId}`);
            console.log(`    created on:   ${user.createdAt.toISOString()}`);
            console.log(`    command:      node ./prisma/approve.mjs --email ${user.email}`);
            console.log("");
        }

        return;
    }

    if (args.values.email && args.values.slackId) {
        console.error("(error) Please specify either e-mail OR Slack ID, not both. Aborting.");
        return;
    }

    const whereClause = args.values.email 
        ? { email: args.values.email }
        : { slackId: args.values.slackId };

    const user = await prisma.user.findFirst({
        where: whereClause
    });

    if (!user) {
        const identifier = args.values.email || args.values.slackId;
        console.error(`(error) No user with ${args.values.email ? "e-mail" : "Slack ID"} ${identifier} exists!`);
        return;
    }

    if (user.permissionLevel !== "UNCONFIRMED") {
        console.error(`(error) User ${user.handle} (${user.displayName}) is already approved with permission level ${user.permissionLevel}.`);
        return;
    }

    console.log(`(info) This will approve ${user.handle} (${user.displayName}, ID ${user.id}, ${user.email}) for the closed beta.`);
    if (!await confirm({ message: "Do you wish to continue? (Y/N)" })) {
        console.log("(info) Aborted. No changes were made.");
        return;
    }

    await prisma.user.update({
        where: { id: user.id },
        data: { permissionLevel: "USER" }
    });

    console.log("(info) User approved successfully. They now have USER permissions.");
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });
