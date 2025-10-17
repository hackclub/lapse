// @ts-check
"use strict";

import { PrismaClient } from "../src/generated/prisma/index.js";
import { parseArgs } from "node:util";
import { confirm } from "@inquirer/prompts";

const prisma = new PrismaClient();
async function main() {
    const args = parseArgs({
        options: {
            email: { type: "string" }
        }
    });

    console.log("");

    if (!args.values.email) {
        console.error("(error) No e-mail specified. Aborting.");
        return;
    }

    const user = await prisma.user.findFirst({
        where: { email: args.values.email }
    });

    if (!user) {
        console.error(`(error) No user with e-mail ${args.values.email} exists!`);
        return;
    }

    console.log(`(info) This will promote ${user.handle} (${user.displayName}, ID ${user.id}, ${user.email}) to a root user.`);
    if (!await confirm({ message: "Do you wish to continue? (Y/N)" })) {
        console.log("(info) Aborted. No changes were made.");
        return;
    }

    await prisma.user.update({
        where: { id: user.id },
        data: { permissionLevel: "ROOT" }
    });

    console.log("(info) User promoted successfully.");
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
