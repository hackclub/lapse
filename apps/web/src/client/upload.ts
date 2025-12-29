import { apiErr, ApiResult, Empty, sleep } from "@/shared/common";
import { createFormData } from "@/client/common";

export async function apiUpload(token: string, data: Blob): Promise<ApiResult<Empty>> {
    let res: ApiResult<Empty> = apiErr("ERROR", "Upload hasn't been attempted even once...?");

    console.log(`(upload.ts) apiUpload("${token}", <${data.type} of ${data.size} bytes>)`);

    for (let i = 0; i < 3; i++) {
        const rawRes = await fetch("/api/upload", {
            method: "POST",
            body: createFormData({
                "token": token,
                "file": data
            })
        });

        console.log("(upload.ts) /api/upload finished", rawRes);

        try {
            res = await rawRes.json() as ApiResult<Empty>;
            if (res.ok) {
                return res;
            }
        }
        catch (apiErr) {
            console.error("(upload.ts) couldn't parse /api/upload response!", apiErr);
            res = { ok: false, error: "ERROR", message: await rawRes.text() };
        }

        console.warn(`(upload.ts) upload attempt #${i} failed. trying again in 2000ms.`, res);
        await sleep(2000);
    }

    console.error("(upload.ts) all upload attempts failed!", res);
    return res;
}