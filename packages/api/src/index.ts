// This file defines the public API surface of the Lapse SDK.

export * from "./common.js";
export * from "./oauth.js";
export * from "./programScopes.js";
export * from "./constants.js";

export * from "./contracts/user.js";
export * from "./contracts/timelapse.js";
export * from "./contracts/draftTimelapse.js";
export * from "./contracts/comment.js";
export * from "./contracts/developer.js";
export * from "./contracts/global.js";
export * from "./contracts/hackatime.js";
export * from "./contracts/auth.js";
export * from "./contracts/admin.js";
export * from "./contracts/programKey.js";
export * from "./contracts/program.js";

import { userRouterContract } from "./contracts/user.js";
import { timelapseRouterContract } from "./contracts/timelapse.js";
import { draftTimelapseRouterContract } from "./contracts/draftTimelapse.js";
import { commentRouterContract } from "./contracts/comment.js";
import { developerRouterContract } from "./contracts/developer.js";
import { globalRouterContract } from "./contracts/global.js";
import { hackatimeRouterContract } from "./contracts/hackatime.js";
import { authRouterContract } from "./contracts/auth.js";
import { adminRouterContract } from "./contracts/admin.js";
import { programKeyRouterContract } from "./contracts/programKey.js";

/**
 * Combines all routes the Lapse API is expected to implement into one router contract.
 */
export const compositeRouterContract = {
    user: userRouterContract,
    timelapse: timelapseRouterContract,
    draftTimelapse: draftTimelapseRouterContract,
    comment: commentRouterContract,
    developer: developerRouterContract,
    global: globalRouterContract,
    hackatime: hackatimeRouterContract,
    auth: authRouterContract,
    admin: adminRouterContract,
    programKey: programKeyRouterContract
};
