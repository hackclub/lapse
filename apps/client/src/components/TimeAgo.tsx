import { useEffect, useState } from "react";

function extractDateComponents(seconds: number) {
  seconds = Math.floor(seconds);

  const years = Math.floor(seconds / 31557600); // 365.25 days
  seconds %= 31557600;

  const months = Math.floor(seconds / 2629746); // ~30.44 days
  seconds %= 2629746;

  const weeks = Math.floor(seconds / 604800);
  seconds %= 604800;

  const days = Math.floor(seconds / 86400);
  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  return {
    y: years,
    mo: months,
    w: weeks,
    d: days,
    h: hours,
    m: minutes,
    s: seconds
  };
}

function formatTimeElapsed(date: Date) {
  const secondsPast = (new Date().getTime() - date.getTime()) / 1000;
  const { y, mo, d, h, m, s } = extractDateComponents(secondsPast);

  return (
    (y >= 1) ? `${y} year${y > 1 ? 's' : ''} ago` :
    (mo >= 1) ? `${mo} month${mo > 1 ? 's' : ''} ago` :
    (d >= 1) ? `${d} day${d > 1 ? 's' : ''} ago` :
    (h >= 1) ? `${h} hour${h > 1 ? 's' : ''} ago` :
    (m >= 1) ? `${m} minute${m > 1 ? 's' : ''} ago` :
    (s <= 1) ? "just now" :
    `${s} second${s > 1 ? 's' : ''} ago`
  );
}

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