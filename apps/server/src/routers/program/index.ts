import { implement } from "@orpc/server";
import { programRouterContract } from "@hackclub/lapse-api";

import type { ProgramKeyContext } from "@/router.js";

import { listUsers, getUser } from "./users.js";
import { listTimelapses, getTimelapse, listComments } from "./timelapses.js";
import { stats, listClients } from "./stats.js";

export const programRouter = implement(programRouterContract)
    .$context<ProgramKeyContext>()
    .router({
        listUsers,
        getUser,
        listTimelapses,
        getTimelapse,
        listComments,
        stats,
        listClients
    });
