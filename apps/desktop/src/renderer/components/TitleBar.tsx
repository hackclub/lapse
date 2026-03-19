import { useLocation, useNavigate } from "react-router";
import { useAuth } from "../context/AuthContext";

const NAV_ITEMS = [
  { path: "/", label: "Dashboard" },
  { path: "/recording", label: "Recording" },
  { path: "/upload", label: "Upload" },
  { path: "/settings", label: "Settings" }
] as const;

export function TitleBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <header
      className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-4"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <nav
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {NAV_ITEMS.map(item => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {user && (
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <span className="text-sm text-neutral-400">
            {user.displayName ?? user.handle}
          </span>
          {user.pictureUrl ? (
            <img
              src={user.pictureUrl}
              alt={user.handle}
              className="h-7 w-7 rounded-full"
            />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-700 text-xs font-medium text-white">
              {(user.displayName ?? user.handle).charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
