import NextLink from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@hackclub/icons";
import type { Comment } from "@hackclub/lapse-api";

import { markdownToJsx } from "@/markdown";
import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";

import { ProfilePicture } from "@/components/entity/ProfilePicture";
import { Bullet } from "@/components/ui/Bullet";
import { TimeAgo } from "@/components/TimeAgo";

export function CommentRenderer({ comment, onDelete }: {
  comment: Comment,
  onDelete?: (commentId: string) => void
}) {
  const auth = useAuth(false);
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
      console.warn("(CommentRenderer.tsx) attempted to call highlight() with main ref being null");
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
          <NextLink href={`/user/@${comment.author.handle}`}><h2>@{comment.author.displayName}</h2></NextLink>
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

          { auth.currentUser && auth.currentUser.id === comment.author.id && (
            <div
              className="cursor-pointer transition-all opacity-0 group-hover:opacity-100 hover:scale-120 active:scale-95 hover:text-red"
              role="button"
              title="Delete this comment"
              onClick={async () => {
                if (!confirm("Are you sure you want to delete this comment?"))
                  return;

                const res = await api.comment.delete({
                  commentId: comment.id
                });

                if (!res.ok) {
                  alert(`Couldn't delete your comment!\n\n${res.message}`);
                  return;
                }

                if (onDelete) {
                  onDelete(comment.id);
                }
              }}
            >
              <Icon glyph="delete" className="w-5 h-5" />
            </div>
          ) }
        </div>
      </div>

      <div role="main">
        {formattedContent}
      </div>
    </article>
  );
}