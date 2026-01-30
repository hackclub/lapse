import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { appRouter } from "@/server/routers/_app";
import { getRestAuthContext } from "@/server/auth";
import { getRestProcedure } from "@/server/rest";

const ParamSchema = z.object({
  router: z.string(),
  procedure: z.string(),
});

function mapMethodToProcedureType(method: string | undefined) {
  if (!method) return null;

  if (method === "GET") return "query" as const;

  if (method === "POST" || method === "PATCH" || method === "DELETE")
    return "mutation" as const;

  return null;
}

function parseInput(req: NextApiRequest) {
  if (req.method === "GET") {
    if (typeof req.query.input === "string") {
      try {
        return JSON.parse(req.query.input);
      } catch {
        return null;
      }
    }

    return {};
  }

  if (!req.body) return {};

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  return req.body;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const params = ParamSchema.safeParse(req.query);
  if (!params.success)
    return res
      .status(400)
      .json({
        error: "invalid_request",
        error_description: "Missing router or procedure.",
      });

  const { router, procedure } = params.data;
  const restProcedure = getRestProcedure(router, procedure);
  if (!restProcedure)
    return res
      .status(404)
      .json({
        error: "not_found",
        error_description: "Unknown REST procedure.",
      });

  if (restProcedure.method !== req.method)
    return res
      .status(405)
      .json({
        error: "invalid_request",
        error_description: "Method not allowed.",
      });

  const procedureType = mapMethodToProcedureType(req.method);
  if (!procedureType)
    return res
      .status(405)
      .json({
        error: "invalid_request",
        error_description: "Unsupported method.",
      });

  const input = parseInput(req);
  if (input === null)
    return res
      .status(400)
      .json({
        error: "invalid_request",
        error_description: "Invalid input payload.",
      });

  const authContext = await getRestAuthContext(req);
  if (restProcedure.requiresAuth && !authContext.user)
    return res
      .status(401)
      .json({
        error: "unauthorized",
        error_description: "Authentication required.",
      });

  if (authContext.actor && restProcedure.scopes.length > 0) {
    const scopeSet = new Set(authContext.scopes);
    const allowed = restProcedure.scopes.every((scope) => scopeSet.has(scope));
    if (!allowed)
      return res
        .status(403)
        .json({
          error: "forbidden",
          error_description: "Missing required scope.",
        });
  }

  const ctx = {
    req,
    res,
    user: authContext.user,
  };

  const caller = appRouter.createCaller(ctx);
  const target = (
    caller as Record<string, Record<string, (arg: unknown) => Promise<unknown>>>
  )[router]?.[procedure];

  if (!target)
    return res
      .status(404)
      .json({
        error: "not_found",
        error_description: "Unknown tRPC procedure.",
      });

  try {
    const result = await target(input);
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(500)
      .json({
        error: "internal_error",
        error_description: "Failed to execute procedure.",
      });
  }
}
