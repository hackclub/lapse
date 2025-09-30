import { initTRPC, TRPCError } from "@trpc/server";
import { NextApiRequest, NextApiResponse } from "next";
import { getAuthenticatedUser } from "../lib/auth";
import type { User } from "../generated/prisma";

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

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const procedure = t.procedure;

/**
 * Equivalent to `procedure`, but requires a user to be authenticated.
 */
export const protectedProcedure = procedure.use(async (opts) => {
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
