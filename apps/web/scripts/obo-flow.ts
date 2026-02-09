import "@/server/allow-only-server";

import { createServiceClient } from "@/server/services/serviceClientService";
import { database } from "@/server/db";
import { generateJWT } from "@/server/auth";

async function main() {
    const user = await database.user.findFirst();
    if (!user)
        throw new Error("No user found. Create a user first.");

    const { client, clientSecret } = await createServiceClient({
        name: "Test OBO App",
        description: "",
        homepageUrl: "https://example.com",
        iconUrl: "",
        redirectUris: ["https://example.com/callback"],
        scopes: ["timelapse:read"],
        createdByUserId: user.id
    });

    const jwt = generateJWT(user.id, user.email);

    console.log("Client ID:", client.clientId);
    console.log("Client Secret:", clientSecret);
    console.log("User JWT:", jwt);
    console.log("Authorize URL:");
    console.log(`http://localhost:3000/oauth/authorize?client_id=${client.clientId}&scope=timelapse:read&redirect_uri=https://example.com/callback&state=test`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
