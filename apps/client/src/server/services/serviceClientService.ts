import "@/server/allow-only-server";

import { randomBytes } from "node:crypto";

import { database } from "@/server/db";
import { hashServiceSecret } from "@/server/auth";

export function generateServiceClientId() {
    return `svc_${randomBytes(12).toString("hex")}`;
}

export function generateServiceClientSecret() {
    return `scs_${randomBytes(24).toString("hex")}`;
}


export async function createServiceClient(params: {
    name: string
    description: string
    homepageUrl: string
    iconUrl: string
    redirectUris: string[]
    scopes: string[]
    createdByUserId: string
}) {
    const clientId = generateServiceClientId();
    const clientSecret = generateServiceClientSecret();

    const client = await database.serviceClient.create({
        include: { createdByUser: true },
        data: {
            name: params.name,
            description: params.description,
            homepageUrl: params.homepageUrl,
            iconUrl: params.iconUrl,
            redirectUris: params.redirectUris,
            scopes: params.scopes,
            clientId,
            clientSecretHash: hashServiceSecret(clientSecret),
            createdByUserId: params.createdByUserId
        }
    });

    return { client, clientSecret };
}

export async function rotateServiceClientSecret(serviceClientId: string) {
    const clientSecret = generateServiceClientSecret();

    const client = await database.serviceClient.update({
        where: { id: serviceClientId },
        data: {
            clientSecretHash: hashServiceSecret(clientSecret)
        }
    });

    return { client, clientSecret };
}

export function normalizeRedirectUris(raw: string[]) {
    return raw
        .map(uri => uri.trim())
        .filter(Boolean);
}

export function normalizeScopes(raw: string[]) {
    return raw
        .map(scope => scope.trim())
        .filter(Boolean);
}
