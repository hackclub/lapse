export function serverSideOnly() {
    if ("process" in globalThis)
        return;
    
    const err = "Server-side code has been imported by the client! This is VERY bad - please report at https://github.com/hackclub/lapse!";

    console.trace(err);
    alert(err);
    throw new Error(err);
}

serverSideOnly();
