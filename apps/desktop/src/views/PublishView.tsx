import { useState } from "react";
import { Send, Globe, EyeOff, ChevronDown } from "lucide-react";

interface PublishViewProps {
  onPublish: (name: string, description: string, visibility: string) => void;
  isPublishing: boolean;
  error: string | null;
}

export function PublishView({
  onPublish,
  isPublishing,
  error,
}: PublishViewProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("PUBLIC");

  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <div className="w-full max-w-md space-y-5 animate-in">
        <div className="text-center mb-2">
          <h2 className="text-xl font-semibold">Publish your timelapse</h2>
          <p className="text-sm text-muted mt-1">Add details before sharing</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted uppercase tracking-wide mb-1.5">
            Title
          </label>
          <input
            type="text"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Give your timelapse a name"
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-red/50 focus:ring-1 focus:ring-red/25 transition-colors"
          />
          <div className="text-[11px] text-white/30 mt-1 text-right">
            {name.length}/60
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted uppercase tracking-wide mb-1.5">
            Description
          </label>
          <textarea
            maxLength={280}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What were you working on?"
            rows={3}
            className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-red/50 focus:ring-1 focus:ring-red/25 transition-colors resize-none"
          />
          <div className="text-[11px] text-white/30 mt-1 text-right">
            {description.length}/280
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted uppercase tracking-wide mb-1.5">
            Visibility
          </label>
          <div className="relative">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
              {visibility === "PUBLIC" ? (
                <Globe size={14} />
              ) : (
                <EyeOff size={14} />
              )}
            </div>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="w-full pl-9 pr-9 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-red/50 focus:ring-1 focus:ring-red/25 transition-colors appearance-none cursor-pointer"
            >
              <option value="PUBLIC">Public</option>
              <option value="UNLISTED">Unlisted</option>
            </select>
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
              <ChevronDown size={14} />
            </div>
          </div>
        </div>

        {error && (
          <div className="text-red text-sm bg-red/10 border border-red/20 rounded-lg px-3.5 py-2.5">
            {error}
          </div>
        )}

        <button
          onClick={() => onPublish(name, description, visibility)}
          disabled={isPublishing || name.length < 2}
          className="cursor-pointer w-full py-2.5 bg-red text-white font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <Send size={14} />
          {isPublishing ? "Publishing..." : "Publish"}
        </button>
      </div>
    </div>
  );
}
