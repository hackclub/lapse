import z from "zod";

import { apiResult, LapseId } from "@/common";
import { UserDisplayName, UserHandle } from "@/contracts/user";
import { contract, NO_INPUT } from "@/internal";
import { TimelapseSchema } from "@/contracts/timelapse";

export const authRouterContract = {
    authorize: contract("GET", "/auth/authorize")
        
};
