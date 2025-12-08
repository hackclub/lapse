// @ts-check
"use strict";

import jwt from "jsonwebtoken";
import { parseArgs } from "node:util";

import { PrismaClient } from "../src/generated/prisma/index.js";

/**
 * @param {string} userId
 * @param {string} email
 */
export function generateJWT(userId, email) {
    if (!process.env.JWT_SECRET)
        throw new Error("Environment variable JWT_SECRET hasn't been set.");

    return jwt.sign(
        { userId, email },
        process.env.JWT_SECRET,
        { expiresIn: "30d" }
    );
}

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
        where: { email: args.values.email.trim() }
    });

    if (!user) {
        console.error("(error) No user found with the specified e-mail. Aborting.");
        return;
    }

    const jwt = generateJWT(user.id, user.email);
    console.log(`(info) Generated JWT: ${jwt}`);
    console.log(`(info) Use the following JavaScript snippet to set the cookie:`);
    console.log(`     > document.cookie = "lapse-auth=${jwt}; Max-Age=2592000"`);
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
