import { useEffect, useState, useRef } from "react";

export function TimeSince({
  active,
  startTime,
  initialElapsedSeconds = 0,
}: {
  active: boolean;
  startTime?: Date;
  initialElapsedSeconds?: number;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() => {
    if (startTime) {
      return Math.floor((Date.now() - startTime.getTime()) / 1000);
    }
    return initialElapsedSeconds;
  });

  // Recalculate elapsed seconds when startTime or initialElapsedSeconds changes
  useEffect(() => {
    if (startTime) {
      setElapsedSeconds(Math.floor((Date.now() - startTime.getTime()) / 1000));
    }
    else {
      setElapsedSeconds(initialElapsedSeconds);
    }
  }, [startTime, initialElapsedSeconds]);
  const [formattedTime, setFormattedTime] = useState("00:00");
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (active) {
      intervalRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
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
