import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import clsx from "clsx";
import Icon from "@hackclub/icons";
import type { HackatimeProject, TimelapseVisibility } from "@hackclub/lapse-api";

import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { VisibilityPicker } from "@/components/layout/VisibilityPicker";
import { HackatimeProjectPicker } from "@/components/entity/HackatimeProjectPicker";

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
    submitted: { name: string; description: string; visibility: TimelapseVisibility; hackatimeProject: string | null } | null;
};

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "https://api.lapse.hackclub.com";

/** Tell the host sheet how tall we are, so it can grow and shrink with the form. */
function useReportHeight(deps: unknown[]) {
    useEffect(() => {
        if (typeof window === "undefined" || window.parent === window)
            return;

        const report = () => {
            // `body`'s own box, measured after layout. `documentElement.scrollHeight` is floored at
            // the frame's current height, so the sheet could only ever grow - step two could never be
            // shorter than step one. `body.scrollHeight` drops the last child's bottom margin and
            // leaves the frame a few pixels short of its content, which shows up as a scrollbar.
            requestAnimationFrame(() => {
                const height = Math.ceil(document.body.getBoundingClientRect().height);
                window.parent.postMessage({ type: "lookout:resize", height }, "*");
            });
        };

        report();

        const observer = new ResizeObserver(report);
        observer.observe(document.body);

        return () => observer.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}

function tellHost(type: "lookout:done" | "lookout:cancel") {
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
    const router = useRouter();
    const rawToken = router.query["panelToken"];
    const panelToken = typeof rawToken === "string" ? rawToken : undefined;

    const [context, setContext] = useState<PanelContext | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [step, setStep] = useState<PanelStep>("details");
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [visibility, setVisibility] = useState<TimelapseVisibility | null>("PUBLIC");
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
                    if (!isStale)
                        tellHost("lookout:done");

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
                    return;
                }

                setContext(data);
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

    // Never render page chrome: the sheet is the surface. Also stops a flash of our dark background
    // over the host's own material while this mounts.
    const bodyRef = useRef(false);
    useEffect(() => {
        if (bodyRef.current)
            return;

        bodyRef.current = true;
        document.documentElement.style.background = "transparent";
        document.body.style.background = "transparent";
    }, []);

    if (loadError) {
        return (
            <div className="flex flex-col gap-4 p-5 text-white">
                <p className="text-muted">{loadError}</p>
                <Button onClick={() => tellHost("lookout:cancel")} className="w-full">Close</Button>
            </div>
        );
    }

    if (!context) {
        return (
            <div className="flex items-center justify-center gap-2 p-8 text-muted">
                <Icon glyph="clock" size={20} />
                <span>Loading…</span>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 px-5 pt-1 pb-5 text-white">
            <div className="flex items-center gap-3">
                <StepMarker index={1} label="Details" state={step === "details" ? "current" : "done"} />
                <div className="h-px flex-1 bg-darkless" />
                <StepMarker index={2} label="Hackatime" state={step === "hackatime" ? "current" : "upcoming"} />
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)]">
                <div
                    inert={step !== "details"}
                    className={clsx(
                        "col-start-1 row-start-1 min-w-0 flex flex-col gap-6 transition-[translate,opacity] duration-300 ease-out",
                        step === "details" ? "translate-x-0 opacity-100" : "-translate-x-8 opacity-0"
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
                        <p className="text-muted mb-2">Choose who can see your timelapse.</p>
                        <VisibilityPicker value={visibility} onChange={setVisibility} />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Button
                            onClick={() => setStep("hackatime")}
                            disabled={!visibility || isPublishing}
                            kind="primary"
                            className="w-full"
                        >
                            Continue
                        </Button>

                        {/* Not "Discard": closing the sheet throws nothing away. The recording keeps
                            compiling and the desktop app offers this again from the session page. */}
                        <Button
                            onClick={() => tellHost("lookout:cancel")}
                            disabled={isPublishing}
                            className="w-full"
                        >
                            Not now
                        </Button>
                    </div>
                </div>

                <div
                    inert={step !== "hackatime"}
                    className={clsx(
                        "col-start-1 row-start-1 min-w-0 flex flex-col gap-6 transition-[translate,opacity] duration-300 ease-out",
                        step === "hackatime" ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"
                    )}
                >
                    <div className="flex flex-col w-full">
                        <label className="font-bold">Sync with Hackatime</label>
                        <p className="text-muted">
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
                            className="w-full"
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
                            className="w-full"
                        >
                            Back
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
