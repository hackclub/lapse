import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/router";
import Icon from "@hackclub/icons";
import { encryptData, fromHex } from "@hackclub/lapse-shared";
import type { LegacyUnpublishedTimelapse } from "@hackclub/lapse-api";

import RootLayout from "@/components/layout/RootLayout";
import { Button } from "@/components/ui/Button";
import { Modal, ModalHeader } from "@/components/layout/Modal";

import { useAuth } from "@/hooks/useAuth";

import { api, apiUpload } from "@/api";
import { deviceStorage } from "@/deviceStorage";
import { getCurrentDevice } from "@/encryption";
import { videoGenerateThumbnail } from "@/video";
import { sfetch } from "@/safety";
import { sleep } from "@/common";
import {
    hasLegacyData,
    readLegacyData,
    deleteLegacyDb,
    legacyDecryptData
} from "@/migration";

type MigrationPhase =
    | "CHECKING"
    | "MIGRATING_LOCAL"
    | "MIGRATING_SERVER"
    | "DONE"
    | "ERROR"
    | "NOT_NEEDED";

interface MigrationState {
    phase: MigrationPhase;
    message: string;
    progress: number;
    currentItem: number;
    totalItems: number;
    error: string | null;
}

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

async function migrateOneTimelapse(
    legacy: LegacyUnpublishedTimelapse,
    passkey: string,
    onProgress: (msg: string) => void
): Promise<void> {
    onProgress("Downloading encrypted session...");
    const res = await sfetch(legacy.primarySession);
    if (!res.ok)
        throw new Error(`Failed to download session for ${legacy.id}: HTTP ${res.status}`);

    const encryptedData = await res.arrayBuffer();

    onProgress("Decrypting with legacy key...");
    const decryptedData = await legacyDecryptData(encryptedData, legacy.id, passkey);
    const decryptedBlob = new Blob([decryptedData], { type: "video/webm" });

    onProgress("Generating thumbnail...");
    const thumbnail = await videoGenerateThumbnail(decryptedBlob);

    onProgress("Creating new draft...");
    const device = await getCurrentDevice();
    console.log(device);

    const createRes = await api.draftTimelapse.create({
        name: legacy.name || undefined,
        description: legacy.description || undefined,
        snapshots: [],
        deviceId: device.id,
        sessions: [{ fileSize: decryptedBlob.size + 8192 }],
        thumbnailSize: thumbnail.size
    });

    if (!createRes.ok)
        throw new Error(`Failed to create draft: ${createRes.message}`);

    const draft = createRes.data.draftTimelapse;

    onProgress("Encrypting session with new key...");
    const encrypted = await encryptData(
        fromHex(device.passkey).buffer,
        fromHex(draft.iv).buffer,
        decryptedBlob
    );

    onProgress("Uploading session...");
    await apiUpload(
        createRes.data.sessionUploadTokens[0],
        new Blob([encrypted], { type: "video/webm" })
    );

    onProgress("Encrypting and uploading thumbnail...");
    const encryptedThumb = await encryptData(
        fromHex(device.passkey).buffer,
        fromHex(draft.iv).buffer,
        thumbnail
    );

    await apiUpload(
        createRes.data.thumbnailUploadToken,
        new Blob([encryptedThumb], { type: "image/webp" })
    );
}

export default function MigratePage() {
    const router = useRouter();
    const { currentUser, isLoading: authLoading } = useAuth(true);

    const [state, setState] = useState<MigrationState>({
        phase: "CHECKING",
        message: "Checking for data to migrate...",
        progress: 0,
        currentItem: 0,
        totalItems: 0,
        error: null
    });

    const migrationStarted = useRef(false);

    const runMigration = useCallback(async () => {
        if (migrationStarted.current)
            return;

        migrationStarted.current = true;

        try {
            // Phase 1: Check for legacy IDB data
            setState(s => ({ ...s, phase: "CHECKING", message: "Checking for local data..." }));

            const hasIdb = await hasLegacyData();
            const legacyLocal = hasIdb ? await readLegacyData() : null;

            // Phase 2: Migrate local IDB → OPFS
            if (legacyLocal) {
                setState(s => ({ ...s, phase: "MIGRATING_LOCAL", message: "Migrating local data to new storage..." }));

                await deviceStorage.importLegacyData(legacyLocal);

                setState(s => ({ ...s, progress: 10, message: "Local data migrated." }));
            }

            // Phase 3: Migrate server-side legacy timelapses
            setState(s => ({ ...s, phase: "MIGRATING_SERVER", message: "Checking for legacy timelapses on server...", progress: 15 }));

            const legacyRes = await api.draftTimelapse.legacy({});
            if (!legacyRes.ok)
                throw new Error(`Failed to fetch legacy timelapses: ${legacyRes.message}`);

            const legacyTimelapses = legacyRes.data.timelapses;

            if (legacyTimelapses.length === 0 && !legacyLocal) {
                setState(s => ({ ...s, phase: "NOT_NEEDED", message: "No migration needed." }));
                await sleep(500);
                router.replace("/");
                return;
            }

            if (legacyTimelapses.length > 0) {
                const allDevices = await deviceStorage.getAllDevices();

                setState(s => ({
                    ...s,
                    totalItems: legacyTimelapses.length,
                    message: `Found ${legacyTimelapses.length} legacy timelapse(s) to migrate.`
                }));

                for (const [i, legacy] of legacyTimelapses.entries()) {
                    const device = allDevices.find(d => d.id === legacy.deviceId);
                    if (!device?.legacyPasskey) {
                        console.warn(`(migrate.tsx) Skipping legacy timelapse ${legacy.id}: no local device matches ${legacy.deviceId} or missing legacy passkey`);
                        setState(s => ({
                            ...s,
                            currentItem: i + 1,
                            message: `Skipped "${legacy.name}" — legacy encryption key not available on this device.`
                        }));
                        continue;
                    }

                    let succeeded = false;

                    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                        try {
                            await migrateOneTimelapse(legacy, device.legacyPasskey, (msg) => {
                                setState(s => ({
                                    ...s,
                                    currentItem: i + 1,
                                    progress: 20 + Math.floor(((i + 0.5) / legacyTimelapses.length) * 75),
                                    message: `[${i + 1}/${legacyTimelapses.length}] "${legacy.name}": ${msg}`
                                }));
                            });
                            succeeded = true;
                            break;
                        }
                        catch (err) {
                            console.error(`(migrate.tsx) Attempt ${attempt + 1} failed for ${legacy.id}:`, err);
                            if (attempt < MAX_RETRIES - 1) {
                                const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
                                setState(s => ({
                                    ...s,
                                    message: `[${i + 1}/${legacyTimelapses.length}] "${legacy.name}": Retrying in ${delay / 1000}s...`
                                }));
                                await sleep(delay);
                            }
                        }
                    }

                    if (!succeeded)
                        throw new Error(`Failed to migrate "${legacy.name}" after ${MAX_RETRIES} attempts.`);

                    setState(s => ({
                        ...s,
                        currentItem: i + 1,
                        progress: 20 + Math.floor(((i + 1) / legacyTimelapses.length) * 75),
                        message: `[${i + 1}/${legacyTimelapses.length}] "${legacy.name}" migrated successfully.`
                    }));
                }
            }

            // Phase 4: Clean up legacy IDB if it still exists
            if (hasIdb) {
                await deleteLegacyDb();
            }

            setState(s => ({ ...s, phase: "DONE", progress: 100, message: "Migration complete!" }));
            await sleep(1500);
            router.replace("/");
        }
        catch (err) {
            console.error("(migrate.tsx) Migration failed:", err);
            migrationStarted.current = false;
            setState(s => ({
                ...s,
                phase: "ERROR",
                error: err instanceof Error ? err.message : "An unknown error occurred during migration."
            }));
        }
    }, [router]);

    useEffect(() => {
        if (authLoading || !currentUser)
            return;

        runMigration();
    }, [authLoading, currentUser, runMigration]);

    const isWorking = state.phase === "CHECKING" || state.phase === "MIGRATING_LOCAL" || state.phase === "MIGRATING_SERVER";

    return (
        <RootLayout title="Lapse — Migrating" showHeader={false}>
            <div className="flex items-center justify-center w-full h-full">
                <Modal isOpen={true}>
                    <ModalHeader
                        icon={state.phase === "ERROR" ? "important" : state.phase === "DONE" ? "checkmark" : "clock-fill"}
                        title={
                            state.phase === "ERROR" ? "Migration failed"
                                : state.phase === "DONE" ? "Migration complete"
                                    : "Migrating your data"
                        }
                        description={
                            state.phase === "ERROR" ? undefined
                                : "Please don't close this page."
                        }
                    >
                        <div className="flex flex-col gap-4 w-full mt-2">
                            { state.phase === "ERROR" ? (
                                <>
                                    <p className="text-sm text-muted">{state.error}</p>
                                    <div className="flex flex-row gap-3">
                                        <Button kind="primary" onClick={() => runMigration()} className="flex-1">
                                            Retry
                                        </Button>
                                        <Button kind="regular" onClick={() => router.replace("/")} className="flex-1">
                                            Skip
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p className="text-sm text-muted">{state.message}</p>

                                    { state.totalItems > 0 && (
                                        <p className="text-xs text-muted">
                                            Timelapse {state.currentItem} of {state.totalItems}
                                        </p>
                                    ) }

                                    <div className="flex items-center gap-2 w-full">
                                        { isWorking && (
                                            <div className="animate-spin">
                                                <Icon glyph="clock" size={20} />
                                            </div>
                                        ) }

                                        { state.progress > 0 && (
                                            <span className="text-xs text-muted">{Math.round(state.progress)}%</span>
                                        ) }

                                        <div className="w-full bg-darkless rounded-full h-2 overflow-hidden">
                                            { state.progress > 0 ? (
                                                <div
                                                    className="bg-red h-2 rounded-full transition-all duration-300"
                                                    style={{ width: `${Math.max(0, Math.min(100, state.progress))}%` }}
                                                />
                                            ) : (
                                                <div
                                                    className="bg-red h-2 rounded-full"
                                                    style={{
                                                        width: "30%",
                                                        animation: "indeterminate 2s ease-in-out infinite"
                                                    }}
                                                />
                                            ) }
                                        </div>
                                    </div>

                                    <style jsx>{`
                                        @keyframes indeterminate {
                                            0% { transform: translateX(-100%); }
                                            50% { transform: translateX(300%); }
                                            100% { transform: translateX(-100%); }
                                        }
                                    `}</style>
                                </>
                            ) }
                        </div>
                    </ModalHeader>
                </Modal>
            </div>
        </RootLayout>
    );
}
