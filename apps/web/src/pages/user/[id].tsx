import { useRouter } from "next/router";
import { useState } from "react";
import Icon from "@hackclub/icons";

import type { Timelapse } from "@/server/routers/api/timelapse";
import type { User, PublicUser } from "@/server/routers/api/user";

import { trpc } from "@/client/trpc";
import { markdownToJsx } from "@/client/markdown";
import { assert, matchOrDefault, validateUrl } from "@/shared/common";

import { useAuth } from "@/client/hooks/useAuth";
import { useAsyncEffect } from "@/client/hooks/useAsyncEffect";

import RootLayout from "@/client/components/RootLayout";
import { ProfilePicture } from "@/client/components/ProfilePicture";

import { Button } from "@/client/components/ui/Button";
import { Skeleton } from "@/client/components/ui/Skeleton";
import { TextInput } from "@/client/components/ui/TextInput";
import { ErrorModal } from "@/client/components/ui/ErrorModal";
import { TimelapseCard } from "@/client/components/TimelapseCard";
import { WindowedModal } from "@/client/components/ui/WindowedModal";
import { TextareaInput } from "@/client/components/ui/TextareaInput";

export default function Page() {
  const router = useRouter();
  const { currentUser } = useAuth(false);

  const [user, setUser] = useState<User | PublicUser | null>(null);
  const [timelapses, setTimelapses] = useState<Timelapse[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editUrls, setEditUrls] = useState<string[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);

  const isMyself = currentUser && user && currentUser.id === user.id;

  useAsyncEffect(async () => {
    if (!router.isReady)
      return;

    const { id } = router.query;
    assert(typeof id === "string", `router.query.id was a ${typeof id} (expected a string)`);

    try {
      const userRes = await trpc.user.query.query(
        id.startsWith("@") ? { handle: id.substring(1).trim() } : { id } 
      );

      if (!userRes.ok) {
        setError(userRes.error);
        return;
      }

      if (!userRes.data.user) {
        setError("User not found");
        return;
      }

      setUser(userRes.data.user);

      const timelapsesRes = await trpc.timelapse.findByUser.query({
        user: userRes.data.user.id
      });

      if (!timelapsesRes.ok) {
        setError(timelapsesRes.error);
        return;
      }

      setTimelapses(timelapsesRes.data.timelapses);
    }
    catch (apiErr) {
      console.error("([id].tsx) Error fetching user data:", apiErr);
      setError("Failed to load user profile");
    }
  }, [router.isReady, router.query]);

  const handleEditProfile = () => {
    if (!user || !isMyself)
      return;

    setEditDisplayName(user.displayName);
    setEditBio(user.bio);
    setEditUrls([...user.urls]);
    setEditModalOpen(true);
  };

  const handleUpdateProfile = async () => {
    if (!user || !isMyself)
      return;

    const validUrls = editUrls.filter(url => url.trim() !== "");
    const invalidUrls = validUrls.filter(url => !validateUrl(url));

    if (invalidUrls.length > 0) {
      setError(`Invalid URL${invalidUrls.length > 1 ? 's' : ''}: ${invalidUrls.join(', ')}`);
      return;
    }

    try {
      setIsUpdating(true);

      const result = await trpc.user.update.mutate({
        id: user.id,
        changes: {
          displayName: editDisplayName.trim(),
          bio: editBio.trim(),
          urls: validUrls
        }
      });

      if (result.ok) {
        setUser(result.data.user);
        setEditModalOpen(false);
      }
      else {
        setError(`Failed to update profile: ${result.error}`);
      }
    }
    catch (error) {
      console.error("([id].tsx) Error updating profile:", error);
      setError("Failed to update profile");
    }
    finally {
      setIsUpdating(false);
    }
  };

  function formatJoinDate(timestamp: number) {
    return new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long"
    });
  };

  if (error) {
    return (
      <RootLayout showHeader={true} title="Error - Lapse">
        <ErrorModal
          isOpen={true}
          setIsOpen={(open) => !open && setError(null)}
          message={error || "User not found"}
        />
      </RootLayout>
    );
  }

  return (
    <RootLayout showHeader={true} title={user ? `${user.displayName} (@${user.handle}) - Lapse` : "Lapse"}>
      <div className="px-16">
        <div className="flex justify-between items-center px-16">
          <div className="flex gap-8">
            <ProfilePicture
              user={user}
              size="lg"
              className="w-24 h-24 text-2xl"
            />

            <div className="flex flex-col">
              <h1 className="text-4xl font-bold">{ user ? user.displayName : <Skeleton className="w-48" /> }</h1>
              <p className="text-secondary text-lg m-0">{ user ? `@${user.handle}` : <Skeleton className="w-32 !h-3" /> }</p>

              { user?.bio && user.bio.trim().length > 0 && (
                <p className="text-smoke text-lg leading-relaxed mb-4 max-w-2xl mt-2">
                  { markdownToJsx(user.bio) }
                </p>
              ) }

              <div className="flex flex-col text-muted">
                <div className="flex items-center gap-2">
                  <Icon glyph="clock" size={16} />
                  <span>{ user ? `Joined ${formatJoinDate(user.createdAt)}` : <Skeleton className="w-64 !h-3" /> }</span>
                </div>

                { (user?.urls ?? []).length > 0 && (
                  user!.urls.map(url => (
                    <div key={url} className="flex items-center gap-2">
                      <Icon
                        size={16}
                        glyph={
                          matchOrDefault(new URL(url).hostname, {
                            "x.com": "twitter", // seriously?
                            "twitter.com": "twitter",
                            "twitch.tv": "twitch",
                            "github.com": "github",
                            "messenger.com": "messenger-fill",
                            "instagram.com": "instagram",
                            "hackclub.slack.com": "slack-fill",
                            "medium.com": "medium-fill",
                            "facebook.com": "facebook",
                            "youtube.com": "youtube",
                            "youtu.be": "youtube"
                          }) ?? "link"
                        }
                      />

                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan hover:underline"
                      >
                        {new URL(url).hostname}{new URL(url).pathname}
                      </a>
                  </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            { user && user.slackId && (
              <Button icon="slack-fill" onClick={() => window.open(`https://hackclub.slack.com/team/${user.slackId}`, "_blank")}>
                Open in Slack
              </Button>
            ) }

            { isMyself && (
              <Button icon="edit" onClick={handleEditProfile}>
                Edit Profile
              </Button>
            ) }
          </div>
        </div>

        <div className="flex flex-wrap gap-16 w-full p-16">
          { timelapses?.map(t => <TimelapseCard timelapse={t} key={t.id} /> ) }
        </div>
      </div>

      <WindowedModal
        icon="edit"
        title="Edit Profile"
        description="Update your profile information."
        isOpen={editModalOpen}
        setIsOpen={setEditModalOpen}
      >
        <div className="flex flex-col gap-6">
          <TextInput
            field={{
              label: "Display Name",
              description: "Your public display name."
            }}
            value={editDisplayName}
            onChange={setEditDisplayName}
            maxLength={24}
          />

          <TextareaInput
            label="Bio"
            description="Tell others about yourself. Optional."
            value={editBio}
            onChange={setEditBio}
            maxLength={160}
          />

          <div className="flex flex-col gap-4">
            <div>
              <label className="text-smoke font-semibold">Featured URLs</label>
              <p className="text-muted">
                Add links to your website, social media, or other profiles. Maximum of 4 URLs.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {editUrls.map((url, index) => (
                <div key={index} className="flex gap-2">
                  <TextInput
                    value={url}
                    placeholder="https://example.com"
                    maxLength={64}
                    onChange={(x) => {
                      const newUrls = [...editUrls];
                      newUrls[index] = x;
                      setEditUrls(newUrls);
                    }}
                  />
                  
                  <Button
                    kind="regular"
                    onClick={() => {
                      const newUrls = editUrls.filter((_, i) => i !== index);
                      setEditUrls(newUrls);
                    }}
                    className="px-3"
                  >
                    <Icon glyph="delete" size={24} />
                  </Button>
                </div>
              ))}

              {editUrls.length < 4 && (
                <Button
                  kind="regular"
                  onClick={() => setEditUrls([...editUrls, ""])}
                  className="gap-2 w-full"
                >
                  <Icon glyph="plus" size={16} />
                  Add URL
                </Button>
              )}
            </div>
          </div>

          <Button
            onClick={handleUpdateProfile}
            disabled={isUpdating || !editDisplayName.trim()}
            kind="primary"
          >
            {isUpdating ? "Updating..." : "Update Profile"}
          </Button>
        </div>
      </WindowedModal>

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error || ""}
      />
    </RootLayout>
  );
}
