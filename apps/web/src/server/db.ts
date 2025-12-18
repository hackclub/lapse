import "@/server/allow-only-server";

import { PrismaClient } from "@/generated/prisma";

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

export const database =
    globalForPrisma.prisma ??
    new PrismaClient();

if (process.env.NODE_ENV !== "production")
    globalForPrisma.prisma = database;
