import { useState } from "react";

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
      <div className="w-full max-w-sm space-y-5">
        <h2 className="text-xl font-semibold text-center">
          Publish your timelapse
        </h2>

        <div>
          <label className="block text-sm text-muted mb-1.5">Title</label>
          <input
            type="text"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Give your timelapse a name"
            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-red/50"
          />
          <div className="text-xs text-muted mt-1 text-right">
            {name.length}/60
          </div>
        </div>

        <div>
          <label className="block text-sm text-muted mb-1.5">
            Description
          </label>
          <textarea
            maxLength={280}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What were you working on?"
            rows={3}
            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-red/50 resize-none"
          />
          <div className="text-xs text-muted mt-1 text-right">
            {description.length}/280
          </div>
        </div>

        <div>
          <label className="block text-sm text-muted mb-1.5">Visibility</label>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-red/50"
          >
            <option value="PUBLIC">Public</option>
            <option value="UNLISTED">Unlisted</option>
          </select>
        </div>

        {error && <div className="text-red text-sm">{error}</div>}

        <button
          onClick={() => onPublish(name, description, visibility)}
          disabled={isPublishing || name.length < 2}
          className="w-full py-2.5 bg-red text-white font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPublishing ? "Publishing..." : "Publish"}
        </button>
      </div>
    </div>
  );
}
