import { PropsWithChildren, ReactNode } from "react";

export function InputField({ label, description, children }: PropsWithChildren<{
  label: string,
  description: ReactNode,
}>) {
  return (
    <div className="flex flex-col w-full">
      <label className="font-bold wrap-break-word">{label}</label>
      <p className="text-muted mb-2">{description}</p>
      
      {children}
    </div>
  );
}