import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import Icon from "@hackclub/icons";
import type { HackatimeProject, TimelapseVisibility } from "@hackclub/lapse-api";

import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { VisibilityPicker } from "@/components/layout/VisibilityPicker";
import { HackatimeProjectPicker } from "@/components/entity/HackatimeProjectPicker";
import { phantomSans } from "@/fonts";

/**
 * The publish flow, rendered inside the Lookout desktop app.
 *
 * Same two steps as `/timelapse/publish/[id]`, with three differences that all come from being an
 * iframe in someone else's window rather than a page of our own:
 *
 *   - **No session.** A third-party frame receives none of our cookies, so nothing here can call an
 *     authenticated procedure. The `panelToken` in the URL is the credential, and every request goes
 *     to a panel endpoint that accepts it.
 *   - **No video.** Lookout opens the panel the moment the recording is saved, minutes before the
 *     compile finishes, so there is nothing to preview and no "ready" state to wait for. Submitting
 *     stores the answers; the timelapse publishes itself once the video lands.
 *   - **No page chrome.** The sheet around us supplies the surface, the title and the close control,
 *     so this paints no background and no header of its own, and reports its height so the sheet can
 *     size to it.
 */

type PanelStep = "details" | "hackatime";

type PanelContext = {
    draftId: string;
    createdAt: string;
    handle: string;
    hackatimeLinked: boolean;
    suggestedName: string | null;
    submitted: { name: string; description: string; visibility: TimelapseVisibility; hackatimeProject: string | null } | null;
};

// Dot access, deliberately: Next substitutes `process.env.NEXT_PUBLIC_*` at build
// time by literal match, and the bracket form is not reliably replaced - which
// silently sends every request to production instead of wherever this build points.
// Same expression as `api.ts` for exactly that reason.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.lapse.hackclub.com";

/** Tell the host sheet how tall we are, so it can grow and shrink with the form. */
function useReportHeight(deps: unknown[]) {
    useEffect(() => {
        if (typeof window === "undefined" || window.parent === window)
            return;

        const report = () => {
            // `body`'s own box. `documentElement.scrollHeight` is floored at the frame's current
            // height, so the sheet could only ever grow - step two could never be shorter than step
            // one. `body.scrollHeight` drops the last child's bottom margin and leaves the frame a
            // few pixels short of its content, which shows up as a scrollbar.
            //
            // Measured in a timeout rather than requestAnimationFrame: the host reveals us only
            // once we report, so we start out not being painted, and a frame that is not painted
            // does not animate - rAF simply never fired and the sheet sat at its minimum forever.
            // A timeout runs regardless of whether anyone can see us.
            setTimeout(() => {
                const height = Math.ceil(document.body.getBoundingClientRect().height);
                window.parent.postMessage({ type: "lookout:resize", height }, "*");
            }, 0);
        };

        report();
        // The step swap changes what is in flow; re-measure after the transition
        // so a taller or shorter step lands at its real height.
        const settle = setTimeout(report, 320);

        const observer = new ResizeObserver(report);
        observer.observe(document.body);

        return () => {
            clearTimeout(settle);
            observer.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}

function tellHost(type: "lookout:done" | "lookout:cancel" | "lookout:ready") {
    if (typeof window !== "undefined" && window.parent !== window)
        window.parent.postMessage({ type }, "*");
}

function StepMarker({ index, label, state }: {
    index: number;
    label: string;
    state: "done" | "current" | "upcoming";
}) {
    return (
        <div className={clsx("flex items-center gap-2 shrink-0", state === "upcoming" && "text-muted")}>
            <span className={clsx(
                "flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0",
                state === "current" && "bg-red text-white",
                state === "done" && "bg-green text-white",
                state === "upcoming" && "bg-darkless text-muted"
            )}>
                {state === "done" ? <Icon glyph="checkmark" size={16} /> : index}
            </span>

            <span className="font-bold text-sm">{label}</span>
        </div>
    );
}

export default function Page() {
    // Read the token out of the URL rather than waiting on `router.query`.
    //
    // A dynamic pages route leaves `query` empty until the router reports ready,
    // and this page can be loaded in contexts where that never happens - it is
    // framed by another application, and it is also opened standalone by the
    // host's fallback paths. Depending on router readiness meant the fetch never
    // fired at all and the panel rendered nothing, forever. The path is right
    // there in `location` on the first render, so use that.
    const [panelToken, setPanelToken] = useState<string | undefined>(undefined);
    useEffect(() => {
        const fromPath = window.location.pathname.match(/\/lookout\/panel\/([^/?#]+)/);
        if (fromPath?.[1])
            setPanelToken(decodeURIComponent(fromPath[1]));
    }, []);

    // Lookout puts its own light/dark state in the URL rather than sending it after
    // load, so we can pick colours before the first paint instead of flashing the
    // wrong ones. Read straight off `location` because `router.query` is empty on
    // the first render.
    const [theme, setTheme] = useState<"light" | "dark">("dark");
    useEffect(() => {
        const fromUrl = new URLSearchParams(window.location.search).get("lookout_theme");
        if (fromUrl === "light" || fromUrl === "dark")
            setTheme(fromUrl);
    }, []);
    const light = theme === "light";

    const [context, setContext] = useState<PanelContext | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    // There is genuinely nothing to ask. In a sheet we have already told the host to
    // close, but the same URL can be opened in a real browser (the host's fallback
    // paths do exactly that), and there "nothing to ask" must not render as a blank page.
    const [settled, setSettled] = useState<"submitted" | "gone" | null>(null);

    const [step, setStep] = useState<PanelStep>("details");
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    // Nothing preselected, matching the website's publish flow: visibility is a
    // deliberate choice about who can see this, not something to default past.
    // `Continue` stays disabled until they pick.
    const [visibility, setVisibility] = useState<TimelapseVisibility | null>(null);
    const [hackatimeProject, setHackatimeProject] = useState<string | null>(null);
    const [isLoadingHackatime, setIsLoadingHackatime] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useReportHeight([context, step, loadError, isLoadingHackatime, submitError]);

    useEffect(() => {
        if (!panelToken)
            return;

        let isStale = false;

        (async () => {
            try {
                const res = await fetch(`${API_URL}/lookout/panel/${panelToken}`);

                if (res.status === 404) {
                    // The draft is gone: already published, or discarded. Nothing left to ask, so
                    // close rather than showing the user a dead form.
                    if (!isStale) {
                        tellHost("lookout:done");
                        setSettled("gone");
                    }

                    return;
                }

                if (!res.ok)
                    throw new Error(`HTTP ${res.status}`);

                const data = await res.json() as PanelContext;
                if (isStale)
                    return;

                // Already answered - on our website, on another device, or on a previous opening of
                // this same panel. Don't ask twice.
                if (data.submitted) {
                    tellHost("lookout:done");
                    setSettled("submitted");
                    return;
                }

                // The user already typed a title into the desktop app's stop dialog; don't make
                // them do it again. Only seeds the field - they can still change it.
                if (data.suggestedName)
                    setName(data.suggestedName);

                setContext(data);
                tellHost("lookout:ready");
            }
            catch {
                if (!isStale)
                    setLoadError("Couldn't reach Lapse. You can finish publishing on the website instead.");
            }
        })();

        return () => { isStale = true; };
    }, [panelToken]);

    const loadHackatimeProjects = useCallback(async (): Promise<HackatimeProject[]> => {
        if (!panelToken)
            return [];

        const res = await fetch(`${API_URL}/lookout/panel/${panelToken}/hackatime-projects`);
        if (!res.ok)
            return [];

        const data = await res.json() as { projects: HackatimeProject[] };
        return data.projects ?? [];
    }, [panelToken]);

    const publish = useCallback(async () => {
        if (!panelToken || !visibility)
            return;

        setIsPublishing(true);
        setSubmitError(null);

        try {
            const res = await fetch(`${API_URL}/lookout/panel/${panelToken}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim() || `Timelapse at ${new Date().toLocaleString()}`,
                    description,
                    visibility,
                    ...(hackatimeProject ? { hackatimeProject } : {}),
                }),
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { error?: string };
                throw new Error(body.error ?? `HTTP ${res.status}`);
            }

            // Whether or not the video was ready, the user is finished here.
            tellHost("lookout:done");
        }
        catch (err) {
            setSubmitError(err instanceof Error ? err.message : "Couldn't publish. Try again?");
            setIsPublishing(false);
        }
    }, [panelToken, name, description, visibility, hackatimeProject]);

    // `globals.css` gives html/body/#__next a dark background, `min-height: 100vh`
    // and `display: flex` - all three wrong inside a sheet. The background paints a
    // slab over the host's own material (and the wrong colour outright in light
    // mode), and the 100vh floor breaks height reporting: `body` could never
    // measure shorter than the frame, so the sheet could only ever grow.
    //
    // A styled-jsx global block rather than a `useEffect`: Next inlines this into
    // the head when the page is rendered, so it is in force at first paint. Clearing
    // it from an effect is always one paint too late, which is the flash.
    const reset = (
        <style jsx global>{`
            html, body, #__next {
                background: transparent !important;
                min-height: 0 !important;
                display: block !important;
                width: auto !important;
                max-width: 100% !important;
                /* The sheet scrolls, not us: its scrollbar is styleable and ours
                   is not, and having both is what produced two of them. */
                overflow: hidden !important;
                overscroll-behavior: none;
            }
        `}</style>
    );

    if (loadError) {
        tellHost("lookout:ready");
        return (
            <div className={clsx(phantomSans.className, "flex flex-col gap-4 p-5", light ? "text-black" : "text-white")}>
                {reset}
                <p className="text-muted">{loadError}</p>
                <Button onClick={() => tellHost("lookout:cancel")} className="w-full">Close</Button>
            </div>
        );
    }

    if (settled) {
        return (
            <div className={clsx(phantomSans.className, "flex flex-col items-center gap-2 px-4 py-8 text-center text-sm", light ? "text-black" : "text-white")}>
                {reset}
                <Icon glyph="checkmark" size={32} className="text-green" />
                <p className="font-bold">All done</p>
                <p className="text-muted text-xs">
                    {
                        settled === "submitted"
                            ? "You've already filled this in - nothing else is needed."
                            : "This timelapse has already been published."
                    }
                </p>
            </div>
        );
    }

    // A real element, even with nothing in it. Returning just the styled-jsx
    // <style> contributes no DOM, and with nothing to attach to the page never
    // hydrated - so the fetch below never ran and the panel stayed blank for
    // good. It still draws nothing visible: the sheet is holding its own
    // spinner, and a second one inside the frame only competes with it.
    if (!context)
        return <div className={phantomSans.className} aria-busy="true">{reset}</div>;

    return (
        <div className={clsx(phantomSans.className, "flex flex-col gap-3 px-4 pt-1 pb-4 text-sm", light ? "text-black" : "text-white")}>
            {reset}
            <div className="flex items-center gap-3">
                <StepMarker index={1} label="Details" state={step === "details" ? "current" : "done"} />
                <div className={clsx("h-px flex-1", light ? "bg-smoke" : "bg-darkless")} />
                <StepMarker index={2} label="Hackatime" state={step === "hackatime" ? "current" : "upcoming"} />
            </div>

            {/* `relative`, with the inactive step taken out of flow. Both steps used to
                share a grid cell, which makes the container as tall as the taller of the
                two - so the reported height never changed between them and the sheet sat
                at the Details height while showing Hackatime. */}
            <div className="relative">
                <div
                    inert={step !== "details"}
                    className={clsx(
                        "min-w-0 flex flex-col gap-3 transition-[translate,opacity] duration-300 ease-out",
                        step === "details"
                            ? "relative translate-x-0 opacity-100"
                            : "absolute inset-x-0 top-0 pointer-events-none -translate-x-8 opacity-0"
                    )}
                >
                    <TextInput
                        field={{ label: "Name", description: "Give your timelapse a title." }}
                        value={name}
                        onChange={setName}
                        placeholder="My awesome timelapse"
                        maxLength={60}
                    />

                    <TextInput
                        field={{ label: "Description", description: "An optional description for your timelapse." }}
                        value={description}
                        onChange={setDescription}
                        placeholder="What did you build?"
                        maxLength={280}
                    />

                    <div className="flex flex-col w-full">
                        <label className="font-bold">Visibility</label>
                        <p className="text-muted mb-1.5 text-xs">Choose who can see your timelapse.</p>
                        <VisibilityPicker value={visibility} onChange={setVisibility} compact />
                    </div>

                    {/* No "not now" of our own: the sheet's own close control already
                        does that, and closing throws nothing away - the recording keeps
                        compiling and the app offers this again from the session page. */}
                    <Button
                        onClick={() => setStep("hackatime")}
                        disabled={!visibility || isPublishing}
                        kind="primary"
                        className="w-full !h-10"
                    >
                        Continue
                    </Button>
                </div>

                <div
                    inert={step !== "hackatime"}
                    className={clsx(
                        "min-w-0 flex flex-col gap-3 transition-[translate,opacity] duration-300 ease-out",
                        step === "hackatime"
                            ? "relative translate-x-0 opacity-100"
                            : "absolute inset-x-0 top-0 pointer-events-none translate-x-8 opacity-0"
                    )}
                >
                    <div className="flex flex-col w-full">
                        <label className="font-bold">Sync with Hackatime</label>
                        <p className="text-muted text-xs">
                            Pick the project your timelapsed time should be added to, or leave it unpicked to publish
                            without syncing.
                        </p>
                    </div>

                    {
                        context.hackatimeLinked ? (
                            <HackatimeProjectPicker
                                isActive={step === "hackatime"}
                                initialProject={hackatimeProject}
                                onChange={setHackatimeProject}
                                onLoadingChange={setIsLoadingHackatime}
                                loadProjects={loadHackatimeProjects}
                                compact
                            />
                        ) : (
                            <p className="text-muted">
                                Link a Hackatime account on the Lapse website to sync your time to a project.
                            </p>
                        )
                    }

                    {submitError && <p className="text-red">{submitError}</p>}

                    <div className="flex flex-col gap-2">
                        <Button
                            onClick={publish}
                            disabled={isLoadingHackatime || isPublishing}
                            kind="primary"
                            className="w-full !h-10"
                        >
                            {
                                isPublishing ? "Publishing..." :
                                hackatimeProject ? "Publish & sync" :
                                "Publish"
                            }
                        </Button>

                        <Button
                            onClick={() => setStep("details")}
                            disabled={isPublishing}
                            icon="view-back"
                            className={clsx("w-full !h-10", light && "!bg-snow !text-black hover:!bg-smoke")}
                        >
                            Back
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
