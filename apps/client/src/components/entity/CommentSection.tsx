import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { Comment } from "@hackclub/lapse-api";

import { CommentRenderer } from "@/components/entity/CommentRenderer";
import { ProfilePicture } from "@/components/entity/ProfilePicture";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/api";

export function CommentSection({ comments, setComments, timelapseId }: {
  comments: Comment[],
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>,
  timelapseId: string
}) {
  const auth = useAuth(false);

  const [commentComposerText, setCommentComposerText] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!textareaRef.current)
      return;

    const input = textareaRef.current;
    input.style.height = "1px";
    input.style.height = `${input.scrollHeight}px`;
  }, [textareaRef.current, commentComposerText]);

  return (
    <div className="flex flex-col gap-6">
      {
        auth.currentUser &&
          <div className="flex gap-2.5">
            {/* Lines up with the composer's first line of text: its top padding, plus half a line, less half the picture. */}
            <ProfilePicture user={auth.currentUser} size="xs" className="mt-2.5 shrink-0" />

            <div className="flex flex-col items-end w-full gap-2">
              <textarea
                maxLength={280}
                ref={textareaRef}
                className={clsx(
                  "overflow-y-hidden rounded-xl border border-black text-white placeholder:text-secondary px-4 py-2.5 resize-none w-full outline-none",
                  "transition-colors hover:border-slate focus:border-red"
                )}
                value={commentComposerText}
                onChange={ev => setCommentComposerText(ev.target.value)}
                placeholder="Add a nice comment..."
              />

              { (commentComposerText.trim().length != 0) &&
                <div className="flex gap-4 items-center">
                  <span className={clsx(
                    "transition-colors",
                    commentComposerText.length <= 200 && "text-secondary",
                    commentComposerText.length > 200 && "text-orange",
                    commentComposerText.length == 280 && "text-red"
                  )}>
                    {commentComposerText.length}/280
                  </span>

                  <Button
                    icon="send-fill"
                    className="h-10! w-min rounded-xl text-sm"
                    kind="primary"
                    onClick={async () => {
                      const res = await api.comment.create({
                        id: timelapseId,
                        content: commentComposerText
                      });

                      if (!res.ok) {
                        alert(`Couldn't post your comment!\n\n${res.message}`);
                        return;
                      }

                      setComments([res.data.comment, ...comments]);
                      setCommentComposerText("");
                    }}
                  >
                    Send
                  </Button>
                </div>
              }
            </div>
          </div>
      }

      { comments.length === 0 ? (
        <p className="text-secondary">
          { auth.currentUser
            ? "No comments yet - be the first one to say something."
            : "No comments yet." }
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {
            comments.map(x => (
              <CommentRenderer
                comment={x}
                key={x.id}
                onDelete={(commentId) => {
                  setComments(prev => prev.filter(c => c.id !== commentId));
                }}
              />
            ))
          }
        </div>
      ) }
    </div>
  );
}
