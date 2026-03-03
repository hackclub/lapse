// This is a simple script providing a REPL interface with some Lapse-specific goodies.
// Use it when you need to do something with the database!

import { randomBytes, scryptSync } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { input } from "@inquirer/prompts";
import * as repl from "node:repl";

import { PrismaClient } from "../../src/generated/prisma/client.js";

let term: repl.REPLServer | null = null;

// Define everything that should be accessible from the REPL here!
const ctx = {
    db: null as PrismaClient | null,

    connect(url: string) {
        if (url.includes("localhost") || url.includes("127.0.0.1")) {
            console.log(") warning: connecting to a localhost database!");
        }

        const adapter = new PrismaPg({ connectionString: url });
        ctx.db = new PrismaClient({ adapter });

        if (term) {
            term.context.db = ctx.db;
        }

        return "connected! use 'db' to access the database!";
    },

    exit() {
        process.exit(0);
    },

    async createCanonicalApp() {
        if (!ctx.db)
            return "(x) connect to a database first!";

        const name = await input({ message: "app name:", default: "Lapse (web)" });
        const description = await input({ message: "description:", default: "The official Lapse web client." });
        const homepageUrl = await input({ message: "homepage url:", default: "https://lapse.hackclub.com" });
        const redirectUrisRaw = await input({ message: "redirect URIs (comma-separated):", default: `${homepageUrl}/auth` });
        const redirectUris = redirectUrisRaw.split(",").map(u => u.trim()).filter(Boolean);

        const ownerHandle = await input({ message: "owner handle (leave empty to skip):", default: "" });
        let createdByUserId: string | undefined;

        if (ownerHandle) {
            const user = await ctx.db.user.findFirst({ where: { handle: ownerHandle } });
            if (!user)
                return `(x) no user found with handle @${ownerHandle}`;

            createdByUserId = user.id;
        }

        const clientId = `svc_${randomBytes(12).toString("hex")}`;
        const clientSecret = `scs_${randomBytes(24).toString("hex")}`;
        const salt = randomBytes(16).toString("hex");
        const clientSecretHash = `${salt}:${scryptSync(clientSecret, salt, 64).toString("hex")}`;

        const client = await ctx.db.serviceClient.create({
            data: {
                name,
                description,
                homepageUrl,
                redirectUris,
                scopes: ["elevated"],
                trustLevel: "TRUSTED",
                clientId,
                clientSecretHash,
                createdByUserId
            }
        });

        return [
            `(✓) canonical app created!`,
            `    client ID:     ${client.clientId}`,
            `    client secret: ${clientSecret}`,
            ``,
            `    set CANONICAL_OAUTH_CLIENT_ID=${client.clientId} on the server`,
            `    set NEXT_PUBLIC_OAUTH_CLIENT_ID=${client.clientId} on the client`,
        ].join("\n");
    },

    async promoteUser(email: string) {
        if (!ctx.db)
            return "(x) connect to a database first!";

        const user = await ctx.db.user.findFirst({ where: { email } });
        if (!user)
            return "(x) no user found";

        await ctx.db.user.update({
            where: { id: user.id },
            data: { permissionLevel: "ROOT" }
        });

        return `(✓) user @${user.handle} (${user.email}) promoted to ROOT`;
    }
};

if (process.env.DATABASE_URL) {
    ctx.connect(process.env.DATABASE_URL);
}
else {
    console.log(`) not connected to a database - use 'connect("<URL>")' to connect!`);
}

console.log();
console.log(") available functions:")
for (let untypedKey in ctx) {
    let key = untypedKey as keyof typeof ctx;
    
    const usage = (
        key == "connect" ? `connect(url: string), connects to a database` :
        key == "db" ? `db: PrismaClient, exposes raw access to the database. can only use after calling 'connect'` :
        key == "exit" ? `exit(), exits the REPL` :
        key == "createCanonicalApp" ? `await createCanonicalApp(), interactively creates a canonical OAuth app` :
        key == "promoteUser" ? `await promoteUser(email: string), grants ROOT permission to the user with the given e-mail` :
        key
    );

    console.log(`) - ${usage}`);
}

console.log();

term = repl.start({ preview: true });
for (let key in ctx) {
    term.context[key] = ctx[key as keyof typeof ctx];
}
