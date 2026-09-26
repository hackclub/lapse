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
    },

    async startMaintenance(startsAt: string, endsAt: string) {
        if (!ctx.db)
            return "(x) connect to a database first!";

        const window = { startsAt: new Date(startsAt), endsAt: new Date(endsAt) };
        if (isNaN(window.startsAt.getTime()) || isNaN(window.endsAt.getTime()))
            return "(x) invalid date - use ISO 8601 with an offset, e.g. \"2026-09-27T10:00-04:00\"";

        await ctx.db.maintenance.upsert({
            where: { id: 1 },
            create: window,
            update: window
        });

        return `(✓) maintenance mode ON (${window.startsAt.toISOString()} - ${window.endsAt.toISOString()}) - only admins can use Lapse`;
    },

    async endMaintenance() {
        if (!ctx.db)
            return "(x) connect to a database first!";

        await ctx.db.maintenance.deleteMany();
        return "(✓) maintenance mode OFF";
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
        key == "startMaintenance" ? `await startMaintenance(startsAt: string, endsAt: string), sends every non-admin to the maintenance page. dates are ISO 8601, e.g. "2026-09-27T10:00-04:00"` :
        key == "endMaintenance" ? `await endMaintenance(), turns maintenance mode off` :
        key
    );

    console.log(`) - ${usage}`);
}

console.log();

term = repl.start({ preview: true });
for (let key in ctx) {
    term.context[key] = ctx[key as keyof typeof ctx];
}
