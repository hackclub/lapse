import NextLink from "next/link";
import { useRouter } from "next/router";
import Icon from "@hackclub/icons";
import { useCallback, useState } from "react";
import { useAsyncEffect } from "@/hooks/useAsyncEffect";
import clsx from "clsx";
import * as mediabunny from "mediabunny";
import { SteppedProgress } from "@/common";
import { videoGenerateThumbnail } from "@/video";
import { getCurrentDevice } from "@/encryption";
import { encryptData, fromHex } from "@hackclub/lapse-shared";
import prettyBytes from "pretty-bytes";
import { api, apiUpload } from "@/api";
import posthog from "posthog-js";

import { Button } from "@/components/ui/Button";
import { ProfilePicture } from "@/components/entity/ProfilePicture";
import { SettingsView } from "@/components/layout/SettingsView";
import { useCachedState } from "@/hooks/useCachedState";
import { useInterval } from "@/hooks/useInterval";
import { useAuth } from "@/hooks/useAuth";

import LapseLogo from "@/assets/icon.svg";

import { WindowedModal } from "@/components/layout/WindowedModal";
import { ErrorModal } from "@/components/layout/ErrorModal";
import { LoadingModal } from "@/components/layout/LoadingModal";
import { FileUploader } from "react-drag-drop-files";

export function Header() {
  const auth = useAuth(false);
  const router = useRouter();

  const [areSettingsOpen, setAreSettingsOpen] = useState(false);
  const [usersActive, setUsersActive] = useCachedState("usersActive", 0);

  const fetchActiveUsers = useCallback(async () => {
    const res = await api.global.activeUsers({});
    if (!res.ok) {
      console.error("(Header.tsx) could not query active users!", res);
      return;
    }

    setUsersActive(res.data.count);
  }, []);

  useInterval(fetchActiveUsers, 30 * 1000);

  const [showCreateDropdown, setCreateDropdown] = useState(false)
  const [showUploadModal, setUploadModal] = useState(false)

  const [file, setFile] = useState<File | null>(null);
  const [uploadFileName, setUploadFileName] = useState("")
  const [thumbnail, setThumbnail] = useState("")

  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = (f: File | File[]) => {
    // This should never happen, but the signature of `f` should still container `File[]` to calm down TypeScript
    if (Array.isArray(f)) {
      return
    }

    setFile(f);
    setUploadFileName(f.name)
  };

  useAsyncEffect(async () => {
    if (file == null) {
      return
    }

    const reader = new FileReader();
    reader.onload = async () => {
      console.log(await videoGenerateThumbnail(file))

      const r = new FileReader();
      r.readAsDataURL(await videoGenerateThumbnail(file));
      r.onloadend = function () {
        setThumbnail(r.result as string);
      }
    };
    reader.onerror = () => {
      setError(`Error reading file ${file.name}`)
    };

    reader.readAsArrayBuffer(file)
  }, [file])

  function bytesProgressCallback(uploaded: number, total: number) {
    setUploadProgress((uploaded / total) * 100);
    setUploadStage(`Uploading video session... (${prettyBytes(uploaded)}/${prettyBytes(total)})`);
  }

  async function uploadCustomFile() {
    try {
      if (file == null) {
        console.log("(Header.tsx) File is null? Whaaa-")
        setError("(Header.tsx) File is null? Whaaa-")
        return // This shouldn't ever run but I put this here to placate TypeScript
      }

      const progress = new SteppedProgress(3, setUploadStage, setUploadProgress);
      setIsUploading(true)
      progress.advance(0, "Generating thumbnail...");
      const videoThumbnail = await videoGenerateThumbnail(file);
      console.log("(Header.tsx) thumbnail generated:", videoThumbnail);

      progress.advance(1, "Talking with the server...");
      const device = await getCurrentDevice();

      const input = new mediabunny.Input({
        formats: [mediabunny.MATROSKA, mediabunny.MP4, mediabunny.WEBM],
        source: new mediabunny.BlobSource(file),
      });

      const videoDurationSeconds = await input.computeDuration()
      const snapshotTimestamps: number[] = []
      const now = Date.now()
      for (let i = 0; i < (videoDurationSeconds / 2.5); i++) {
        snapshotTimestamps.push(now + parseInt((i * 2.5).toString()))
      }

      const res = await api.draftTimelapse.create({
        snapshots: snapshotTimestamps,
        thumbnailSize: videoThumbnail.size,
        deviceId: device.id,
        sessions: [{ fileSize: file.size + 8192 }] // we add an 8KiB margin, because encryption adds some marginal overhead, and we don't want to force the user to store every session in memory
      });

      console.log("(Header.tsx) draftTimelapse.create response:", res);

      if (!res.ok)
        throw new Error(res.message);

      setUploadProgress(0);
      setUploadStage(`Encrypting literally the only session...`);
      const encrypted = await encryptData(
        fromHex(device.passkey).buffer,
        fromHex(res.data.draftTimelapse.iv).buffer,
        file
      );

      console.log(`(Header.tsx) encrypted literally the only session:`, encrypted);

      setUploadStage("Uploading video session...");
      await apiUpload(res.data.sessionUploadTokens[0], new Blob([encrypted], { type: (await input.getFormat()).mimeType }), bytesProgressCallback);

      console.log("(Header.tsx) all sessions uploaded successfully! (the was literally only 1 session)");
      // ------------------------------------------------------- //

      progress.advance(2, "Encrypting thumbnail...");
      const encryptedThumb = await encryptData(
        fromHex(device.passkey).buffer,
        fromHex(res.data.draftTimelapse.iv).buffer,
        videoThumbnail
      );

      console.log("(Header.tsx) - encrypted thumbnail:", encryptedThumb);

      await apiUpload(
        res.data.thumbnailUploadToken,
        new Blob([encryptedThumb], { type: "image/webp" }),
        bytesProgressCallback
      );

      console.log("(Header.tsx) thumbnail uploaded successfully! we're done, yay!");

      posthog.capture("prerecorded_timelapse_upload_completed", {
        draft_id: res.data.draftTimelapse.id,
        session_count: 1,
        snapshot_count: snapshotTimestamps.length,
      });

      router.push(`/draft/${res.data.draftTimelapse.id}`);
    } catch (error) {
      posthog.capture("prerecorded_timelapse_upload_completed", { error, uploadProgress, uploadStage });
      console.error("(Header.tsx) upload failed:", error);
      setIsUploading(false);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred during upload";
      posthog.capture("prerecorded_timelapse_upload_completed", { error: errorMessage });
      posthog.captureException(error);
      setError(errorMessage);
    }
  }

  return (
    <>
      <header className={clsx(
        "fixed bottom-0 z-10 bg-dark border-t border-black shadow", // mobile
        "sm:static sm:bg-transparent sm:border-none sm:shadow-none", // desktop
        "w-full"
      )}>
        {/* desktop */}
        <div className="hidden sm:flex px-16 py-8 pt-12 w-full justify-between">
          <div className="flex gap-6 items-center">
            <NextLink href="/">
              <LapseLogo className="w-12 h-12 transition-transform hover:scale-105 active:scale-95" />
            </NextLink>

            <div className="flex gap-1.5 px-6 py-2 h-min justify-center items-center rounded-2xl bg-dark border border-black shadow text-nowrap">
              <div aria-hidden className="w-2 h-2 rounded-full bg-green" />
              <div>
                {usersActive === 1 ? "1 person" : `${usersActive} people`} recording right now
              </div>
            </div>
          </div>

          <div className="flex gap-6 items-center">
            {
              (auth.isLoading || auth.currentUser) ? (
                <>
                  <div className="relative flex flex-row ">
                    {/* The reason I'm not using the <Button /> component is beause I need to control the left and right border radius so the 2 buttons look like they're the same button */}
                    <div className="relative flex flex-row hover:scale-[102%] active:scale-[98%] transition-all">
                      <button onClick={() => router.push("/timelapse/create")} className="flex items-center gap-2 justify-center rounded-tl-2xl rounded-bl-2xl h-12 px-8 font-bold text-nowrap flex-nowrap cursor-pointer bg-red text-white">
                        <Icon glyph="plus-fill" width={20} height={20} />
                        Create
                      </button>
                      <button onClick={() => setCreateDropdown(!showCreateDropdown)} className="relative right-0.5 rounded-tr-2xl rounded-br-2xl bg-red border-l-3 border-red-accent">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 512 512">{ /* Icon from IonIcons by Ben Sperry - https://github.com/ionic-team/ionicons/blob/main/LICENSE */}<path d="M128 192l128 128 128-128z" fill="currentColor" /></svg>
                      </button>
                    </div>
                    {(showCreateDropdown) ? (
                      <div className="absolute flex flex-col top-16 shadow text-white">
                        <Button
                          kind="regular"
                          onClick={() => setUploadModal(true)}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">{/* Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE */}<path fill="currentColor" d="M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h12q.825 0 1.413.588T18 6v4.5l3.15-3.15q.25-.25.55-.125t.3.475v8.6q0 .35-.3.475t-.55-.125L18 13.5V18q0 .825-.587 1.413T16 20z" /></svg>
                          <span>Upload recording</span>
                        </Button>
                      </div>
                    ) : (<></>)}
                  </div>

                  <Icon
                    width={32} height={32}
                    className="cursor-pointer transition-transform hover:scale-110 active:scale-90"
                    glyph="settings"
                    onClick={() => setAreSettingsOpen(true)}
                  />

                  <ProfilePicture user={auth.currentUser} size="md" />
                </>
              ) : (
                <>
                  <Button href="/auth" kind="primary" icon="welcome">Sign in</Button>
                </>
              )
            }
          </div>
        </div>

        {/* mobile */}
        <div className="sm:hidden flex px-12 py-6 justify-between items-center w-full">
          <button
            className="flex flex-col items-center gap-2 cursor-pointer transition-transform active:scale-90"
            onClick={() => router.push("/")}
          >
            <Icon glyph="home" width={32} height={32} />
            <span className="text-lg">Home</span>
          </button>

          <button
            className={clsx(
              "p-4 rounded-full transition-transform",
              auth.currentUser ? "bg-red active:scale-90" : "bg-muted cursor-not-allowed"
            )}
            onClick={() => setCreateDropdown(!showCreateDropdown)}
            disabled={!auth.currentUser}
            aria-label="Open 'create new timelapse' or 'upload custom video' dropdown"
          >
            <Icon glyph="plus-fill" width={36} height={36} />
          </button>

          {(showCreateDropdown) ? (
            <div className="absolute flex flex-col gap-2 left-40 bottom-32 shadow text-white">
              <Button
                kind="regular"
                onClick={() => setUploadModal(true)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">{/* Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE */}<path fill="currentColor" d="M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h12q.825 0 1.413.588T18 6v4.5l3.15-3.15q.25-.25.55-.125t.3.475v8.6q0 .35-.3.475t-.55-.125L18 13.5V18q0 .825-.587 1.413T16 20z" /></svg>
                <span>Upload recording</span>
              </Button>

              <Button
                kind="regular"
                onClick={() => auth.currentUser && router.push("/timelapse/create")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">{/* Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE */}<path fill="currentColor" d="M4 20q-.825 0-1.412-.587T2 18V6q0-.825.588-1.412T4 4h12q.825 0 1.413.588T18 6v4.5l3.15-3.15q.25-.25.55-.125t.3.475v8.6q0 .35-.3.475t-.55-.125L18 13.5V18q0 .825-.587 1.413T16 20z" /></svg>
                <span>Create new timelapse</span>
              </Button>
            </div>
          ) : (<></>)}

          {
            auth.currentUser ? (
              <button
                className="flex flex-col items-center gap-2 transition-transform active:scale-90"
              >
                <ProfilePicture user={auth.currentUser} size="lg" />
                <span className="text-lg">You</span>
              </button>
            ) : (
              <button
                className="flex flex-col items-center gap-2 cursor-pointer transition-transform active:scale-90"
                onClick={() => router.push("/auth")}
              >
                <Icon glyph="welcome" width={32} height={32} />
                <span className="text-lg">Sign up</span>
              </button>
            )
          }
        </div>
      </header>

      <SettingsView
        isOpen={areSettingsOpen}
        setIsOpen={setAreSettingsOpen}
      />

      {(showUploadModal) ? (<WindowedModal
        icon="send-fill"
        title="Submit your timelapse"
        description="Submitting will end your timelapse and save all of your progress!"
        isOpen={showUploadModal}
        setIsOpen={x => setUploadModal(x)}
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-6">
            <FileUploader handleChange={handleFileUpload} name="file" types={["MP4", "WEBM"]} />
            {(uploadFileName && thumbnail) ? (<div className="flex flex-col gap-2">
              <img src={thumbnail} width={360} height={360} />
              <p>{uploadFileName}</p>
            </div>) : <></>}
          </div>

          <div className="flex gap-4 w-full">
            <Button onClick={uploadCustomFile} kind="primary">Submit</Button>
            <Button onClick={() => setUploadModal(false)} kind="regular">Cancel</Button>
          </div>
        </div>
      </WindowedModal>) : (<></>)}

      <LoadingModal
        isOpen={isUploading}
        title="Uploading Timelapse"
        message={uploadStage}
        progress={uploadProgress}
      />

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error || ""}
        onClose={() => router.back()}
        onRetry={() => {
          setError(null);
        }}
      />
    </>
  );
}