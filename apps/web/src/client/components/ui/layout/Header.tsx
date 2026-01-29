import NextLink from "next/link";
import { useRouter } from "next/router";
import Icon from "@hackclub/icons";
import { useState } from "react";
import clsx from "clsx";
import * as mediabunny from "mediabunny";

import { TIMELAPSE_FRAME_LENGTH_MS, TIMELAPSE_FPS } from "@/shared/constants";
import LapseLogo from "@/client/assets/icon.svg";

import { useAuth } from "@/client/hooks/useAuth";

import { Button } from "@/client/components/ui/Button";
import { ProfilePicture } from "@/client/components/ProfilePicture";
import { SettingsView } from "@/client/components/ui/layout/SettingsView";
import { useCachedState } from "@/client/hooks/useCachedState";
import { useInterval } from "@/client/hooks/useInterval";
import { trpc } from "@/client/trpc";
import { WindowedModal } from "@/client/components/ui/WindowedModal";
import { TextInput } from "@/client/components/ui/TextInput";
import { TextareaInput } from "@/client/components/ui/TextareaInput";
import { ErrorModal } from "@/client/components/ui/ErrorModal";
import { LoadingModal } from "@/client/components/ui/LoadingModal";
import { FileUploader } from "react-drag-drop-files";

import { videoGenerateThumbnail } from "@/client/videoProcessing";
import { encryptVideo, encryptData, getCurrentDevice } from "@/client/encryption";
import { useAsyncEffect } from "@/client/hooks/useAsyncEffect";
import { apiUpload } from "@/client/upload";

export function Header() {
  const auth = useAuth(false);
  const router = useRouter();

  const [areSettingsOpen, setAreSettingsOpen] = useState(false);
  const [usersActive, setUsersActive] = useCachedState("usersActive", 0);

  const [showCreateDropdown, setCreateDropdown] = useState(false)
  const [showUploadModal, setUploadModal] = useState(false)

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadFileName, setUploadFileName] = useState("")
  const [thumbnail, setThumbnail] = useState("")

  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [convertProgress, setConvertProgress] = useState(0);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = (f: File | File[]) => {
    // This should never happen, but the signature of `f` should still container `File[]` to calm down TypeScript
    if (Array.isArray(f)) {
      return
    }

    setFile(f);
    setUploadFileName(f.name)
  };

  useInterval(async () => {
    const res = await trpc.global.activeUsers.query({});
    if (!res.ok) {
      console.error("(Header.tsx) could not query active users!", res);
      return;
    }

    setUsersActive(res.data.count);
  }, 30 * 1000);

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

  async function handleCustomVideoUpload() {
    try {
      if (!file) {
        return;
      }

      setIsUploading(true);
      setUploadStage("Converting to WebM...");
      setUploadProgress(5);

      const input = new mediabunny.Input({
        formats: [mediabunny.MATROSKA, mediabunny.MP4],
        source: new mediabunny.BlobSource(file),
      });
      const output = new mediabunny.Output({
        format: new mediabunny.WebMOutputFormat(),
        target: new mediabunny.BufferTarget(),
      });

      const conversion = await mediabunny.Conversion.init({
        input, output,
        video: {
          frameRate: TIMELAPSE_FPS
        }
      })
      if (!conversion.isValid) {
        throw new Error(JSON.stringify(conversion.discardedTracks))
      }

      conversion.onProgress = (progress: number) => {
        setConvertProgress(progress * 100)
      };

      setIsConverting(true)
      await conversion.execute()
      setIsConverting(false)

      setUploadStage("Generating thumbnail...");
      setUploadProgress(25);

      const unencryptedThumbnail = await videoGenerateThumbnail(file)

      setUploadStage("Requesting upload URL...");
      setUploadProgress(30);
      const uploadRes = await trpc.timelapse.createDraft.query({ containerType: "WEBM" });
      console.log("(Header.tsx) timelapse.createDraft response:", uploadRes);

      if (!uploadRes.ok)
        throw new Error(uploadRes.message);

      setUploadStage("Encrypting video...");
      setUploadProgress(35);

      const encrypted = await encryptVideo(new Blob([output.target.buffer!]), uploadRes.data.id, (stage, progress) => {
        setUploadStage(stage);
        setUploadProgress(35 + Math.floor(progress * 0.25)); // 35-60%
      });

      console.log("(Header.tsx) - encrypted data:", encrypted);

      setUploadStage("Uploading video to server...");
      setUploadProgress(60);
      console.log("(Header.tsx) uploading video via proxy endpoint");

      const vidStatus = await apiUpload(
        uploadRes.data.videoToken,
        new Blob([encrypted.data], { type: "video/webm" })
      );

      if (!vidStatus.ok)
        throw new Error(vidStatus.message);

      setUploadProgress(70);

      console.log("(Header.tsx) video uploaded successfully", vidStatus);

      setUploadStage("Encrypting thumbnail...");
      setUploadProgress(75);

      const encryptedThumbnail = await encryptData(unencryptedThumbnail, uploadRes.data.id, (stage, progress) => {
        setUploadStage(stage);
        setUploadProgress(75 + Math.floor(progress * 0.05)); // 75-80%
      });

      console.log("(Header.tsx) - encrypted thumbnail:", encryptedThumbnail);

      setUploadStage("Uploading thumbnail...");
      setUploadProgress(80);

      const thumbnailStatus = await apiUpload(
        uploadRes.data.thumbnailToken,
        new Blob([encryptedThumbnail.data], { type: "image/jpeg" })
      );
      if (!thumbnailStatus.ok)
        throw new Error(thumbnailStatus.message);

      console.log("(Header.tsx) thumbnail uploaded successfully", thumbnailStatus);

      setUploadStage("Finalizing timelapse...");
      setUploadProgress(85);

      const videoDurationSeconds = await input.computeDuration()
      const snapshotTimestamps: number[] = []
      const now = Date.now()
      for (let i = 0; i < (videoDurationSeconds / (TIMELAPSE_FRAME_LENGTH_MS / 1000)); i++) {
        snapshotTimestamps.push(now + parseInt((i * TIMELAPSE_FRAME_LENGTH_MS).toString()))
      }

      const device = await getCurrentDevice();

      console.log("(Header.tsx) finalizing upload now!");
      console.log("(Header.tsx) - name:", name);
      console.log("(Header.tsx) - description:", description);
      console.log("(Header.tsx) - snapshots:", snapshotTimestamps);

      const createRes = await trpc.timelapse.commit.mutate({
        id: uploadRes.data.id,
        name,
        description,
        visibility: "UNLISTED",
        deviceId: device.id,
        snapshots: snapshotTimestamps,
      });

      console.log("(Header.tsx) timelapse.create response:", createRes);

      if (!createRes.ok)
        throw new Error(createRes.error);

      setUploadStage("Upload complete!");
      setUploadProgress(100);

      router.push(`/timelapse/${createRes.data.timelapse.id}`);
    } catch (apiErr) {
      console.error("(Header.tsx) upload failed:", apiErr);
      setIsUploading(false);
      setIsConverting(false);
      setError(apiErr instanceof Error ? apiErr.message : "An unknown error occurred during upload");
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
              <div>{usersActive} people recording right now</div>
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
            aria-label="open 'create new timelapse' or 'upload custom video' dropdown"
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
          <TextInput
            field={{
              label: "Name",
              description: "The title of your timelapse. You can change it later!"
            }}
            value={name}
            onChange={setName}
            maxLength={60}
          />

          <TextareaInput
            label="Description"
            description="Displayed under your timelapse. Optional."
            value={description}
            onChange={setDescription}
            maxLength={280}
          />

          <div className="flex gap-4 w-full">
            <Button onClick={handleCustomVideoUpload} disabled={!name || name.trim().length == 0} kind="primary">Submit</Button>
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

      <LoadingModal
        isOpen={isConverting}
        title="Converting Video"
        message={`Converting to WebM at ${TIMELAPSE_FPS}fps`}
        progress={convertProgress}
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