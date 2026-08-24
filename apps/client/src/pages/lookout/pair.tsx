import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Icon from "@hackclub/icons";

import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";

import RootLayout from "@/components/layout/RootLayout";
import { Button } from "@/components/ui/Button";
import { CopyField } from "@/components/ui/CopyField";

/**
 * Approving a Lookout desktop install to record as you.
 *
 * The desktop app sends the user here once, in their real browser, and from then on it can start
 * recordings straight from its own menu instead of bouncing through this site every time. We are only
 * reached via the API's `/lookout/pair`, which carries the app's parameters over - see
 * `lookoutDesktop.ts` for why the entry point lives there.
 *
 * On approval we hand back a single-use code through `lookout://pair`. The code is worthless on its
 * own: redeeming it requires the PKCE verifier behind `challenge`, which never leaves the app. That
 * matters because a custom-scheme link travels through OS plumbing any program could have registered.
 */
export default function Page() {
    const router = useRouter();
    const auth = useAuth(true);

    const challenge = typeof router.query["challenge"] === "string" ? router.query["challenge"] : undefined;
    const state = typeof router.query["state"] === "string" ? router.query["state"] : undefined;
    const device = typeof router.query["device"] === "string" ? router.query["device"] : "Lookout Desktop";

    const [isApproving, setIsApproving] = useState(false);
    const [handedOff, setHandedOff] = useState(false);
    const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const approve = useCallback(async () => {
        if (!challenge || !state)
            return;

        setIsApproving(true);
        setError(null);

        const res = await api.timelapse.approveDesktopPairing({ challenge, label: device });

        if (!res.ok) {
            setError(res.message);
            setIsApproving(false);
            return;
        }

        // `state` goes back exactly as it arrived: the app drops any callback whose state it doesn't
        // recognise, which is what stops a link someone else crafted from pairing anything.
        const url = `lookout://pair?code=${encodeURIComponent(res.data.code)}&state=${encodeURIComponent(state)}`;
        setHandoffUrl(url);
        setHandedOff(true);
        window.location.href = url;
    }, [challenge, state, device]);

    useEffect(() => {
        if (!router.isReady)
            return;

        if (!challenge || !state)
            setError("This link is missing information the desktop app should have sent. Try linking again from the app.");
    }, [router.isReady, challenge, state]);

    if (!router.isReady || auth.isLoading) {
        return (
            <RootLayout title="Link a device">
                <div className="flex items-center justify-center gap-2 py-16 text-muted">
                    <Icon glyph="clock" size={20} />
                    <span>Loading…</span>
                </div>
            </RootLayout>
        );
    }

    if (handedOff) {
        return (
            <RootLayout title="Device linked">
                <div className="flex flex-col items-center gap-4 py-12 text-center max-w-md mx-auto">
                    <Icon glyph="checkmark" size={48} className="text-green" />
                    <h1 className="text-2xl font-bold">Linked!</h1>
                    <p className="text-muted">
                        {device} can now start timelapses as you. You can close this tab - and if the app didn&apos;t come
                        back to the front, switch to it yourself.
                    </p>

                    {/* Fallback for when the OS never fires the deep link (some Windows setups drop `lookout://`
                        entirely). The code is single-use and short-lived, so pasting the URL into Lookout&apos;s
                        + menu is the manual escape hatch - same shape as the fallback on the recording page. */}
{handoffUrl && (
                        <div className="w-full flex flex-col gap-2 mt-6">
                            <p className="text-muted text-sm">Still nothing? Copy this link and paste it into Lookout.</p>
                            <CopyField value={handoffUrl} label="Pairing handoff link" />
                        </div>
                    )}
                </div>
            </RootLayout>
        );
    }

    return (
        <RootLayout title="Link a device">
            <div className="flex flex-col gap-6 max-w-md mx-auto py-12">
                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-bold">Link {device}?</h1>
                    <p className="text-muted">
                        After linking, the {device} app will be able to start timelapses on your account directly.
                    </p>
                </div>

                <ul className="flex flex-col gap-2 text-muted">
                    <li className="flex items-start gap-2">
                        <Icon glyph="checkmark" size={20} className="text-green shrink-0" />
                        <span>Start a timelapse straight from the app.</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <Icon glyph="settings" size={20} className="shrink-0" />
                        <span>Unlink it any time from Settings, or from the app itself.</span>
                    </li>
                </ul>

                {error && <p className="text-red">{error}</p>}

                <div className="flex flex-col gap-2">
                    <Button
                        onClick={approve}
                        disabled={isApproving || !challenge || !state}
                        kind="primary"
                        className="w-full"
                    >
                        {isApproving ? "Linking..." : `Link ${device}`}
                    </Button>

                    <Button onClick={() => router.push("/")} disabled={isApproving} className="w-full">
                        Cancel
                    </Button>
                </div>
            </div>
        </RootLayout>
    );
}
