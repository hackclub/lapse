import "@/server/allow-only-server";

import { createServiceClient } from "@/server/services/serviceClientService";
import { database } from "@/server/db";

function getArg(flag: string) {
    const index = process.argv.indexOf(flag);
    if (index === -1)
        return null;

    return process.argv[index + 1] ?? null;
}

function requiredArg(flag: string) {
    const value = getArg(flag);
    if (!value)
        throw new Error(`Missing ${flag}`);

    return value;
}

async function main() {
    const userId = requiredArg("--user");
    const name = requiredArg("--name");
    const homepageUrl = requiredArg("--homepage");
    const redirectUrisRaw = requiredArg("--redirect");
    const scopesRaw = requiredArg("--scopes");

    const description = getArg("--description") ?? "";
    const iconUrl = getArg("--icon") ?? "";

    const redirectUris = redirectUrisRaw.split(",").map(uri => uri.trim()).filter(Boolean);
    const scopes = scopesRaw.split(",").map(scope => scope.trim()).filter(Boolean);

    const user = await database.user.findFirst({ where: { id: userId } });
    if (!user)
        throw new Error("User not found.");

    const { client, clientSecret } = await createServiceClient({
        name,
        description,
        homepageUrl,
        iconUrl,
        redirectUris,
        scopes,
        createdByUserId: userId
    });

    console.log("Service client created:");
    console.log(`Client ID: ${client.clientId}`);
    console.log(`Client Secret: ${clientSecret}`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
