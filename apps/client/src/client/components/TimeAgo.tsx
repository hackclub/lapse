import { useEffect, useState } from "react";

import { formatTimeElapsed } from "@/shared/common";

export function TimeAgo({ date, className }: {
  date: Date | number;
  className?: string;
}) {
  if (typeof date === "number") {
    date = new Date(date);
  }

  const [display, setDisplay] = useState(formatTimeElapsed(date));

  useEffect(() => {
    const delta = (new Date().getTime() - date.getTime()) / 1000;
    const delay =
      (delta < 60) ? 1000 : // if this happened less than a minute ago, update every second
      (delta < 60 * 60) ? 60 * 1000 : // if this happened less than an hour ago, update every minute
      (delta < 24 * 60 * 60) ? 60 * 60 * 1000 : // if this happened less than a day ago, update every hour
      0; // don't update at all if this happened more than a day ago

    if (delay == 0)
      return;

    const timer = setInterval(() => {
      setDisplay(formatTimeElapsed(date));
    }, delay);

    return () => clearInterval(timer);
  }, [date]);

  return <time dateTime={date.toISOString()} className={className}>{display}</time>
}