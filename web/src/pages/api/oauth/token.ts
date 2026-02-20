import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import {
  generateOboJWT,
  OBO_AUDIENCE,
  OBO_ISSUER,
  verifyOAuthCode,
  verifyServiceSecret,
} from "@/server/auth";
import { database } from "@/server/db";
import { logNextRequest } from "@/server/serverCommon";
import { getAllOAuthScopes } from "@/shared/oauthScopes";

const AuthCodeSchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string(),
  redirect_uri: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

const ClientCredentialsSchema = z.object({
  client_id: z.string(),
  client_secret: z.string(),
});

const TOKEN_TTL_SECONDS = 900;

function parseBasicAuth(authorization: string | undefined) {
  if (!authorization)
    return null;

  const match = authorization.match(/^Basic\s+(.*)$/i);
  if (!match)
    return null;

  const decoded = Buffer.from(match[1], "base64").toString("utf-8");
  const [clientId, clientSecret] = decoded.split(":");

  if (!clientId || !clientSecret)
    return null;

  return { clientId, clientSecret };
}

function hasAllScopes(allowed: string[], requested: string[]) {
  if (requested.length === 0)
    return true;

  const allowedSet = new Set(allowed);
  return requested.every((scope) => allowedSet.has(scope));
}

function parseClientCredentials(req: NextApiRequest) {
  const basic = parseBasicAuth(req.headers.authorization);
  if (basic)
    return basic;

  const result = ClientCredentialsSchema.safeParse(req.body);
  if (!result.success)
    return null;

  return {
    clientId: result.data.client_id,
    clientSecret: result.data.client_secret,
  };
}

function sanitizeScopes(scopes: string[]) {
  return scopes
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function getInvalidScopes(scopes: string[]) {
  const allowed = new Set(getAllOAuthScopes());
  return scopes.filter((scope) => !allowed.has(scope));
}

export const config = {
  api: {
    bodyParser: false,
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  logNextRequest("oauth.token", req);

  if (req.method !== "POST")
    return res.status(405).json({
      error: "invalid_request",
      error_description: "Method not allowed.",
    });

  let rawBody = "";
  if (req.body) {
    if (typeof req.body === "string") {
      rawBody = req.body;
    } else if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString("utf-8");
    } else {
      rawBody = JSON.stringify(req.body);
    }
  }
  else {
    // Read the stream manually since bodyParser is off
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }

    rawBody = Buffer.concat(chunks).toString("utf-8");
  }

  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    try {
      const params = new URLSearchParams(rawBody);
      const parsedBody: Record<string, string> = {};

      for (const [key, value] of params.entries()) {
        parsedBody[key] = value;
      }

      req.body = parsedBody;
    }
    catch (e) {
      console.error("Failed to parse x-www-form-urlencoded body", e);
      req.body = {};
    }
  }
  else if (contentType.includes("application/json")) {
    try {
      req.body = JSON.parse(rawBody);
    }
    catch (e) {
      console.error("Failed to parse JSON body", e);
      req.body = {};
    }
  }
  else if (rawBody.trim()) {
    try {
      req.body = JSON.parse(rawBody);
    }
    catch {
      req.body = {};
    }
  }
  else {
    req.body = {};
  }

  const requestBody = AuthCodeSchema.safeParse(req.body);
  if (!requestBody.success) {
    return res
      .status(400)
      .json({
        error: "invalid_request",
        error_description: "Invalid authorization code exchange payload.",
      });
  }

  const credentials = parseClientCredentials(req);
  if (!credentials) {
    return res
      .status(401)
      .json({
        error: "invalid_client",
        error_description: "Missing client credentials.",
      });
  }
  const serviceClient = await database.serviceClient.findFirst({
    where: { clientId: credentials.clientId, revokedAt: null },
  });

  if (
    !serviceClient ||
    !(
      await verifyServiceSecret(
        credentials.clientSecret,
        serviceClient.clientSecretHash,
      )
    )
  ) {
    return res
      .status(401)
      .json({
        error: "invalid_client",
        error_description: "Invalid client credentials.",
      });
  }

  const authCode = verifyOAuthCode(requestBody.data.code);
  if (!authCode) {
    return res
      .status(400)
      .json({
        error: "invalid_grant",
        error_description: "Authorization code is invalid or expired.",
      });
  }

  if (authCode.clientId !== serviceClient.clientId) {
    return res
      .status(400)
      .json({
        error: "invalid_grant",
        error_description: "Authorization code does not match client.",
      });
  }

  const expectedRedirect = requestBody.data.redirect_uri ?? null;
  if (expectedRedirect && expectedRedirect !== authCode.redirectUri) {
    return res
      .status(400)
      .json({
        error: "invalid_grant",
        error_description: "Authorization code redirect URI mismatch.",
      });
  }

  if (!serviceClient.redirectUris.includes(authCode.redirectUri)) {
    return res
      .status(400)
      .json({
        error: "invalid_grant",
        error_description: "Authorization code redirect URI mismatch.",
      });
  }

  const requestedScopes = sanitizeScopes(authCode.scopes);
  const invalidScopes = getInvalidScopes(requestedScopes);
  if (invalidScopes.length > 0) {
    return res
      .status(400)
      .json({
        error: "invalid_scope",
        error_description: `Unknown scopes: ${invalidScopes.join(", ")}`,
      });
  }

  if (!hasAllScopes(serviceClient.scopes, requestedScopes)) {
    return res
      .status(403)
      .json({
        error: "invalid_scope",
        error_description: "Requested scope is not allowed.",
      });
  }

  const subjectUser = await database.user.findFirst({
    where: { id: authCode.userId },
  });

  if (!subjectUser) {
    return res
      .status(400)
      .json({
        error: "invalid_request",
        error_description: "Subject user not found.",
      });
  }

  const grant = await database.serviceGrant.findFirst({
    where: {
      serviceClientId: serviceClient.id,
      userId: subjectUser.id,
      revokedAt: null,
    },
  });

  if (!grant) {
    return res
      .status(403)
      .json({
        error: "access_denied",
        error_description: "User has not granted access.",
      });
  }

  const grantScopes = grant.scopes;
  const finalScopes = sanitizeScopes(
    requestedScopes.length > 0
      ? requestedScopes.filter((scope) => grantScopes.includes(scope))
      : grantScopes,
  );

  if (finalScopes.length === 0) {
    return res
      .status(403)
      .json({
        error: "access_denied",
        error_description: "No allowed scopes for this user.",
      });
  }

  if (finalScopes.length !== new Set(finalScopes).size) {
    return res
      .status(400)
      .json({
        error: "invalid_scope",
        error_description: "Duplicate scopes are not allowed.",
      });
  }

  const oboToken = generateOboJWT(
    subjectUser.id,
    subjectUser.email,
    serviceClient.id,
    finalScopes,
    TOKEN_TTL_SECONDS,
  );

  await database.serviceClient.update({
    where: { id: serviceClient.id },
    data: { lastUsedAt: new Date() },
  });

  await database.serviceGrant.update({
    where: { id: grant.id },
    data: { lastUsedAt: new Date() },
  });

  await database.serviceTokenAudit.create({
    data: {
      serviceClientId: serviceClient.id,
      userId: subjectUser.id,
      scope: finalScopes.join(" "),
      ip: req.headers["x-forwarded-for"]?.toString() ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    },
  });

  return res.status(200).json({
    access_token: oboToken,
    issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SECONDS,
    scope: finalScopes.join(" "),
    audience: OBO_AUDIENCE,
    issuer: OBO_ISSUER,
  });
}
