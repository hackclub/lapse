import { useEffect, useState, useRef } from "react";

export function TimeSince({ active }: {
  active: boolean;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [formattedTime, setFormattedTime] = useState("00:00");
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (active) {
      intervalRef.current = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
    }
    else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [active]);

  useEffect(() => {
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;

    const mm = minutes.toString().padStart(2, "0");
    const ss = seconds.toString().padStart(2, "0");

    if (hours > 0) {
      const hh = hours.toString().padStart(2, "0");
      setFormattedTime(`${hh}:${mm}:${ss}`);
    }
    else {
      setFormattedTime(`${mm}:${ss}`);
    }
  }, [elapsedSeconds]);

  return <span>{formattedTime}</span>;
}