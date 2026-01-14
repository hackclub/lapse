import { useEffect, useState } from "react";
import Icon from "@hackclub/icons";

function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = 0;
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  } else if (minutes > 0) {
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  } else {
    return `0:${String(secs).padStart(2, '0')}`;
  }
}

export function Duration({ seconds, className }: {
  seconds: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(formatDuration(seconds));

  useEffect(() => {
    setDisplay(formatDuration(seconds));
  }, [seconds]);

  return (
    <div className={`inline-flex items-center gap-1 ${className || ""}`}>
      <Icon glyph="clock" size={16} />
      <time>{display}</time>
    </div>
  );
}
