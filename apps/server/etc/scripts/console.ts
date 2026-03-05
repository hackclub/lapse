// This is a simple script providing a REPL interface with some Lapse-specific goodies.
// Use it when you need to do something with the database!

import { PrismaPg } from "@prisma/adapter-pg";
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
