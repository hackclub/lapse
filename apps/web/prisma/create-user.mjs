// @ts-check
"use strict";

import "dotenv/config";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/index.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
async function main() {
    const args = parseArgs({
        options: {
            email: { type: "string", default: "ascpixi@proton.me" },
            sid: { type: "string", default: "U082DPCGPST" },
            handle: { type: "string", default: "ascpixi" },
            name: { type: "string", default: "ascpixi" },
            pfp: { type: "string", default: "https://ca.slack-edge.com/T0266FRGM-U082DPCGPST-0c4754eb6211-512" }
        }
    });

    console.log("");

    const user = await prisma.user.create({
        data: {
            email: args.values.email ?? "ascpixi@proton.me",
            slackId: args.values.sid,
            handle: args.values.handle ?? "ascpixi",
            displayName: args.values.name ?? "ascpixi",
            profilePictureUrl: args.values.pfp,
            bio: "",
            urls: [],
            permissionLevel: "USER",
            createdAt: new Date(),
            hackatimeApiKey: null,
        },
    });

    console.log(`(info) User @${user.handle} created.`);
    console.dir(user);
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
