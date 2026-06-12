import { useState } from "react";
import { Send, Globe, EyeOff, ChevronDown, Archive } from "lucide-react";

interface UploadProgress {
  stage: string;
  progress: number;
}

interface PublishViewProps {
  onPublish: (name: string, description: string, visibility: string) => void;
  onStash: () => void;
  isPublishing: boolean;
  progress: UploadProgress | null;
  error: string | null;
}

export function PublishView({
  onPublish,
  onStash,
  isPublishing,
  progress,
  error,
}: PublishViewProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("PUBLIC");

  const fieldClass =
    "w-full px-3 py-[7px] bg-black/20 border border-white/[0.08] rounded-md text-[13px] text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 transition-colors disabled:opacity-50";

  return (
    <div className="flex flex-col h-full animate-in">
      <div className="flex-1 flex items-center justify-center pb-12">
        <div className="w-80 space-y-3">
          <div>
            <label className="block text-[13px] text-muted mb-1">Title</label>
            <input
              type="text"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Give your timelapse a name"
              disabled={isPublishing}
              className={fieldClass}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[13px] text-muted mb-1">
              Description
            </label>
            <textarea
              maxLength={280}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What were you working on?"
              rows={3}
              disabled={isPublishing}
              className={`${fieldClass} resize-none`}
            />
          </div>

          <div>
            <label className="block text-[13px] text-muted mb-1">
              Visibility
            </label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                {visibility === "PUBLIC" ? (
                  <Globe size={13} />
                ) : (
                  <EyeOff size={13} />
                )}
              </div>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
                disabled={isPublishing}
                className={`${fieldClass} pl-8 pr-8 appearance-none cursor-pointer`}
              >
                <option value="PUBLIC">Public</option>
                <option value="UNLISTED">Unlisted</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                <ChevronDown size={13} />
              </div>
            </div>
          </div>

          {progress && (
            <div className="pt-1">
              <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red rounded-full transition-all duration-300"
                  style={{ width: `${Math.round(progress.progress * 100)}%` }}
                />
              </div>
              <div className="text-[11px] text-muted mt-1 text-center">
                {progress.stage}
              </div>
            </div>
          )}

          {error && (
            <div className="text-red text-[13px] bg-red/10 border border-red/20 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={onStash}
              disabled={isPublishing}
              className="cursor-pointer flex-1 py-[7px] bg-white/[0.06] border border-white/[0.08] text-[13px] font-medium rounded-md hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <Archive size={13} />
              Stash
            </button>
            <button
              onClick={() => onPublish(name, description, visibility)}
              disabled={isPublishing || name.length < 2}
              className="cursor-pointer flex-[2] py-[7px] bg-red text-white text-[13px] font-medium rounded-md hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <Send size={13} />
              {isPublishing ? "Publishing..." : "Publish"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
