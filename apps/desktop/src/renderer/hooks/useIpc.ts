import { useState, useEffect, useCallback, useRef } from "react";
import { lapse } from "../lib/desktop";
import type { IpcChannelMap, IpcEventMap, IpcChannel, IpcEvent } from "@/shared/ipc-channels";

interface IpcQueryResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useIpcQuery<K extends IpcChannel>(
  channel: K,
  ...args: IpcChannelMap[K]["args"]
): IpcQueryResult<IpcChannelMap[K]["result"]> {
  type R = IpcChannelMap[K]["result"];
  const [data, setData] = useState<R | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const argsRef = useRef(args);
  argsRef.current = args;

  const fetch = useCallback(() => {
    setIsLoading(true);
    setError(null);
    (lapse.invoke as (ch: string, ...a: unknown[]) => Promise<R>)(channel, ...argsRef.current)
      .then(result => {
        setData(result);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });
  }, [channel]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, isLoading, error, refetch: fetch };
}

export function useIpcEvent<K extends IpcEvent>(
  event: K,
  callback: (data: IpcEventMap[K]) => void
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const unsub = lapse.on(event, (data: IpcEventMap[K]) => {
      callbackRef.current(data);
    });
    return unsub;
  }, [event]);
}
