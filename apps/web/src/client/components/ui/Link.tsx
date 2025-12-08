import { PropsWithChildren } from "react";

export function Link({ content, newTab, href }: {
  content?: string,
  href: string,
  newTab: boolean
}) {
  return (
    <a
      className="underline"
      href={href}
      target={newTab ? "_blank" : undefined}
    >
      {content ?? href}
    </a>
  );
}