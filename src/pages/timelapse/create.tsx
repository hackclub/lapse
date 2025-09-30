import { TimeSince } from "@/components/TimeSince";
import { Button } from "@/components/ui/Button";
import { InputField } from "@/components/ui/InputField";
import { Modal } from "@/components/ui/Modal";
import { TextareaInput } from "@/components/ui/TextareaInput";
import { TextInput } from "@/components/ui/TextInput";
import Icon from "@hackclub/icons";
import clsx from "clsx";
import { ChangeEvent, useEffect, useRef, useState } from "react";

export default function Page() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [setupModalOpen, setSetupModalOpen] = useState(true);
  const [videoSourceKind, setVideoSourceKind] = useState("NONE");
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [cameraLabel, setCameraLabel] = useState("Camera");
  const [screenLabel, setScreenLabel] = useState("Screen");
  const [changingSource, setChangingSource] = useState(false);
  const [startedAt, setStartedAt] = useState(new Date());

  const [isFrozen, setIsFrozen] = useState(false);

  const setupPreviewRef = useRef<HTMLVideoElement>(null);
  const mainPreviewRef = useRef<HTMLVideoElement>(null);

  const currentStream = cameraStream || screenStream;
  const isRecording = !isFrozen && !setupModalOpen;

  useEffect(() => {
    if (!setupPreviewRef.current)
      return;

    setupPreviewRef.current.srcObject = currentStream;
  }, [currentStream]);

  function onCreate() {
    mainPreviewRef.current!.srcObject = currentStream;
    setStartedAt(new Date());
    setSetupModalOpen(false);
  }

  async function onVideoSourceChange(ev: ChangeEvent<HTMLSelectElement>) {
    if (ev.target.value == videoSourceKind)
      return; // no change

    if (changingSource) {
      console.warn("Attempted to change the video source while we're still processing a previous change. Ignoring.");
      return;
    }

    setChangingSource(true);

    function disposeStreams() {
      setCameraLabel("Camera");
      setScreenLabel("Screen");

      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        setCameraStream(null);
      }

      if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        setScreenStream(null);
      }
    }

    console.log("Video source changed to", ev.target.value);

    if (ev.target.value == "CAMERA") {
      let stream: MediaStream;

      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      catch (err) {
        console.error("Could not request permissions for camera stream.", err);
        setChangingSource(false);
        return;
      }
      
      console.log("Stream retrieved!", stream);

      const cameraLabel = stream.getVideoTracks()[0].label
        .replace(/\([A-Fa-f0-9]+:[A-Fa-f0-9]+\)/, "")
        .trim();

      disposeStreams();
      setCameraStream(stream);
      setVideoSourceKind("CAMERA");
      setCameraLabel(`Camera (${cameraLabel})`);
    }
    else if (ev.target.value == "SCREEN") {
      let stream: MediaStream;

      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      }
      catch (err) {
        console.error("Could not request permissions for screen capture.", err);
        setChangingSource(false);
        return;
      }
      
      console.log("Screen stream retrieved!", stream);

      let screenLabel: string | null = stream.getVideoTracks()[0].label;
      if (screenLabel.includes("://") || screenLabel.includes("window:")) {
        screenLabel = null;
      }

      disposeStreams();
      setScreenStream(stream);
      setVideoSourceKind("SCREEN");
      setScreenLabel(screenLabel ? `Screen (${screenLabel})` : "Screen");
    }
    else {
      setVideoSourceKind("NONE");
    }

    setChangingSource(false);
  }

  function toggleFreeze() {
    setIsFrozen(!isFrozen);
  }

  function openSetupModal() {
    setSetupModalOpen(true);
  }

  return (
    <>
      <Modal
        icon="clock-fill"
        title="Create timelapse"
        description="After you click Create, your timelapse will start recording!"
        isOpen={setupModalOpen}
        setIsOpen={setSetupModalOpen}
      >
        <div className="flex flex-col gap-6">
          <TextInput
            label="Name" description="The title of your timelapse. You can change it later!"
            value={name} onChange={setName}
            maxLength={60}
          />

          <TextareaInput
            label="Description" description="Displayed under your timelapse. Optional."
            value={description} onChange={setDescription}
            maxLength={280}
          />

          <InputField
            label="Video source"
            description="Record your screen, camera, or any other video source."
          >
            <select
              className="border-1 border-sunken p-2 rounded-md disabled:bg-smoke transition-colors"
              value={videoSourceKind}
              onChange={onVideoSourceChange}
              disabled={changingSource}
            >
              <option disabled value="NONE">(none)</option>
              <option value="CAMERA">{cameraLabel}</option>
              <option value="SCREEN">{screenLabel}</option>
            </select>
          </InputField>

          {(cameraStream || screenStream) && (
            <div className="flex flex-col gap-2">
              <video
                ref={setupPreviewRef}
                autoPlay muted
                className="w-full h-auto border border-sunken rounded-md"
              />
            </div>
          )}

          <Button onClick={onCreate}>Create</Button>
        </div>
      </Modal>

      <div className="flex w-full h-screen bg-dark">
        <div className={"flex flex-col p-8 py-16 h-full gap-4 bg-dark text-smoke"}>
          <div className="flex gap-2 font-bold font-mono">
            <div>
              <div className={`rounded-full inline-block w-4 h-4 ${isRecording ? "bg-red" : "bg-muted"}`}></div> 
            </div>

            <div className="translate-y-[-2px]">
              {isRecording ? "REC" : "PAUSE"} <br></br>
              <TimeSince active={isRecording} />
            </div>
          </div>

          <Button kind={isFrozen ? "primary" : "secondary"} isSquare onClick={toggleFreeze}>
            <Icon glyph="freeze" size={56} />
          </Button>

          <Button kind="secondary" isSquare onClick={() => openSetupModal()}>
            <Icon glyph="settings" size={56} />
          </Button>
        </div>

        <div className="w-full h-full py-12 pr-8">
          <video
            ref={mainPreviewRef}
            autoPlay muted
            className="w-full h-full object-cover rounded-[48px]"
          />
        </div>
      </div>
    </>
  );
}