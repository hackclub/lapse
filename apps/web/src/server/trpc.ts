import "@/server/allow-only-server";

import { initTRPC, TRPCError } from "@trpc/server";
import { NextApiRequest, NextApiResponse } from "next";
import { z, ZodError } from "zod";

import { getAuthenticatedUser } from "@/server/auth";

import type { User } from "@/generated/prisma/client";

export interface Context {
  req: NextApiRequest;
  res: NextApiResponse;
  user: User | null;
}

export async function createContext(opts: { req: NextApiRequest; res: NextApiResponse }): Promise<Context> {
  const user = await getAuthenticatedUser(opts.req);

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}

const t = initTRPC.context<Context>().create({
    errorFormatter({ shape, error }) {
        return {
            ...shape,
            data: {
                ...shape.data,
                zodError: error.cause instanceof ZodError ? z.treeifyError(error.cause) : null,
            },
        };
    },
});

export const router = t.router;
export const procedure = t.procedure;

/**
 * Equivalent to `procedure`, but requires a user to be authenticated.
 */
export function protectedProcedure() {

  return procedure.use(async (opts) => {
    const { ctx } = opts;
    
    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }
    
    return opts.next({
      ctx: {...ctx, user: ctx.user },
    });
  });
}
