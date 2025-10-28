import { ApiResult, Empty } from "../shared/common";
import { createFormData } from "./clientCommon";

export async function apiUpload(token: string, data: Blob): Promise<ApiResult<Empty>> {
    const rawRes = await fetch("/api/upload", {
        method: "POST",
        body: createFormData({
            "token": token,
            "file": data
        })
    });

    console.log("(upload) /api/upload finished", rawRes);
    
    try {
        return await rawRes.json() as ApiResult<Empty>;
    }
    catch (err) {
        console.error("(upload) couldn't parse /api/upload response!", err);
        return { ok: false, error: "ERROR", message: await rawRes.text() };
    }
}