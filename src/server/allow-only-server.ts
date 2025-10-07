"use server";

export function serverSideOnly() {
    if ("process" in globalThis)
        return;
    
    console.trace("Server-side code has been imported by the client! This is VERY bad - please report at https://github.com/hackclub/lapse!");
    throw new Error("Server-side code has been imported by the client! Please report this at https://github.com/hackclub/lapse!");
}

serverSideOnly();
