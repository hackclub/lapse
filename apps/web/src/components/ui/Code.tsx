import { PropsWithChildren } from "react";

export function Code({ children }: PropsWithChildren) {
  return (
    <code className="font-mono text-base bg-darkless text-white mx-1 px-3 py-2 rounded-xl">{children}</code>
  );
}