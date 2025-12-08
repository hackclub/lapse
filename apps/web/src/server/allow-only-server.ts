export function serverSideOnly() {
    if ("process" in globalThis)
        return;
    
    const apiErr = "Server-side code has been imported by the client! This is VERY bad - please report at https://github.com/hackclub/lapse!";

    console.trace(apiErr);
    alert(apiErr);
    throw new Error(apiErr);
}

serverSideOnly();
