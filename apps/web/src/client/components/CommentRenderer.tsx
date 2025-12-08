import { useCallback, useEffect, useRef, useState } from "react";
import { markdownToJsx } from "../markdown";
import { ProfilePicture } from "./ProfilePicture";
import { Bullet } from "@/client/components/ui/Bullet";

import type { Comment } from "@/client/api";
import { TimeAgo } from "@/client/components/TimeAgo";
import Icon from "@hackclub/icons";

export function CommentRenderer({ comment }: {
  comment: Comment
}) {
  const [formattedContent, setFormattedContent] = useState<React.ReactNode>("");
  const [isHighlighting, setIsHighlighting] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFormattedContent(markdownToJsx(comment.content));
  }, [comment]);

  const highlight = useCallback(() => {
    if (isHighlighting)
      return;

    const element = mainRef.current;
    if (!element) {
      console.warn("(CommentRenderer) attempted to call highlight() with main ref being null");
      return;
    }

    setIsHighlighting(true);

    element.scrollIntoView({ behavior: "smooth", block: "start" });
    element.classList.add("bg-darkless");

    setTimeout(() => {
      element.classList.remove("bg-darkless");
      setIsHighlighting(false);
    }, 1000);
  }, [comment, mainRef]);

  useEffect(() => {
    setTimeout(() => {
      const element = mainRef.current;
      if (!element || !location.hash)
        return;

      const slug = location.hash.substring(1);
      if (`comment-${comment.id}` != slug)
        return;

      highlight();
    }, 1);
  }, [comment, mainRef]);

  return (
    <article ref={mainRef} id={`comment-${comment.id}`} className="group flex flex-col gap-2 rounded-xl transition-colors duration-500">
      <div className="flex gap-3">
        <ProfilePicture user={comment.author} size="xs" />

        <div className="flex gap-2 text-secondary items-center">
          <h2>@{comment.author.displayName}</h2>
          <Bullet />
          <TimeAgo date={comment.createdAt} />

          <div
            className="cursor-pointer transition-all opacity-0 group-hover:opacity-100 hover:scale-120 active:scale-95 hover:text-white"
            role="button"
            title="Copy a link to this comment"
            onClick={() => {
              const slug = `comment-${comment.id}`;

              navigator.clipboard.writeText(`${location.protocol}//${location.host}${location.pathname}#${slug}`);
              history.pushState(null, "", `#${slug}`);
              highlight();
            }}
          >
            <Icon glyph="link" className="w-5 h-5" />
          </div>
        </div>
      </div>

      <div role="main">
        {formattedContent}
      </div>
    </article>
  )
}