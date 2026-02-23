import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client.js";

if (!process.env["DATABASE_URL"])
    throw new Error("DATABASE_URL environment variable is not set");

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"] });
export const database = new PrismaClient({ adapter });
