import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

import type { Comment } from "@/client/api";
import { CommentRenderer } from "@/client/components/CommentRenderer";
import { ProfilePicture } from "@/client/components/ProfilePicture";
import { Button } from "@/client/components/ui/Button";
import { useAuth } from "@/client/hooks/useAuth";
import { trpc } from "@/client/trpc";

export function CommentSection({ comments, setComments, timelapseId }: {
  comments: Comment[],
  setComments: (x: Comment[]) => void,
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
    <div className="flex flex-col gap-6 border border-black rounded-2xl p-6 max-h-full flex-1 overflow-y-auto">
      {
        auth.currentUser &&
          <div className="flex gap-2.5">
            <ProfilePicture user={auth.currentUser} size="xs" className="translate-y-1" />

            <div className="flex flex-col items-end w-full gap-2">
              <textarea
                maxLength={280}
                ref={textareaRef}
                className={clsx(
                  "overflow-y-hidden rounded-lg border border-black text-white placeholder:text-secondary px-2 py-1 resize-none w-full outline-none",
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
                    className="!h-10 w-min rounded-xl text-sm"
                    kind="primary"
                    onClick={async () => {
                      const res = await trpc.comment.create.mutate({
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

      <div className="flex flex-col gap-4">
        { comments.map(x => <CommentRenderer comment={x} key={x.id} />) }
      </div>
    </div>
  )
}