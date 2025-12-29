import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

import { getLogs, subscribeToLogs, LogEntry } from "@/client/logBucket";

function LogEntryRow({ entry }: { entry: LogEntry }) {
  return (
    <div className={clsx(
      "py-0.5 break-all",
      entry.level === "warn" && "text-yellow",
      entry.level === "error" && "text-red",
      entry.level === "log" && "text-muted"
    )}>
      {entry.message}
    </div>
  );
}

export function LogViewer({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [logs, setLogs] = useState<LogEntry[]>(getLogs);

  useEffect(() => {
    return subscribeToLogs(() => {
      setLogs(getLogs());
    });
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    });
  }, [logs]);

  if (logs.length === 0)
    return null;

  return (
    <div
      ref={containerRef}
      className={clsx(
        "flex flex-col bg-darker rounded-xl border border-slate p-3 overflow-y-auto font-mono text-xs max-h-48 text-left",
        className
      )}
    >
      {logs.map((entry, index) => (
        <LogEntryRow key={index} entry={entry} />
      ))}
    </div>
  );
}
