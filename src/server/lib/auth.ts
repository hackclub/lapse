import jwt from "jsonwebtoken";
import { NextApiRequest } from "next";

import { PrismaClient } from "../../generated/prisma";
import { JWT_SECRET } from "../env";

const database = new PrismaClient();

export interface JWTPayload {
  userId: string
  email: string
  iat: number
  exp: number
}

export function generateJWT(userId: string, email: string): string {
    return jwt.sign(
        { userId, email },
        JWT_SECRET,
        { expiresIn: "30d" }
    );
}

export function verifyJWT(token: string): JWTPayload | null {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
        return decoded as JWTPayload;
    }
    catch {
        return null;
    }
}

export function extractJWTFromRequest(req: NextApiRequest): string | null {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  // Check cookies
  const cookies = req.headers.cookie;
  if (cookies) {
    const match = cookies.match(/lapse-auth=([^;]+)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

export async function getAuthenticatedUser(req: NextApiRequest) {
  const token = extractJWTFromRequest(req);
  
  if (!token) {
    return null;
  }

  const payload = verifyJWT(token);
  if (!payload) {
    return null;
  }

  try {
    const user = await database.user.findFirst({
      where: { id: payload.userId }
    });
    
    return user;
  }
  catch (error) {
    console.error("Failed to fetch authenticated user:", error);
    return null;
  }
}
