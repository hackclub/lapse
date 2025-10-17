import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Icon from "@hackclub/icons";

import type { Timelapse } from "@/server/routers/api/timelapse";
import type { User, PublicUser } from "@/server/routers/api/user";

import { trpc } from "@/client/trpc";
import { useAuth } from "@/client/hooks/useAuth";
import { ErrorModal } from "@/client/components/ui/ErrorModal";
import { ProfilePicture } from "@/client/components/ui/ProfilePicture";
import RootLayout from "@/client/components/RootLayout";
import { Button } from "@/client/components/ui/Button";
import { WindowedModal } from "@/client/components/ui/WindowedModal";
import { TextInput } from "@/client/components/ui/TextInput";
import { TextareaInput } from "@/client/components/ui/TextareaInput";
import { Skeleton } from "@/client/components/ui/Skeleton";
import { Badge } from "@/client/components/ui/Badge";
import { ThumbnailImage } from "@/client/components/ThumbnailImage";
import { matchOrDefault } from "@/shared/common";

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

  const isOwnProfile = currentUser && user && currentUser.id === user.id;

  useEffect(() => {
    async function fetchUserData() {
      if (!router.isReady)
        return;

      const { id } = router.query;
      if (typeof id !== "string") {
        setError("Invalid user ID");
        return;
      }

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
      catch (err) {
        console.error("Error fetching user data:", err);
        setError("Failed to load user profile");
      }
    }

    fetchUserData();
  }, [router.isReady, router.query]);

  const handleEditProfile = () => {
    if (!user || !isOwnProfile) return;

    setEditDisplayName(user.displayName);
    setEditBio(user.bio);
    setEditUrls([...user.urls]);
    setEditModalOpen(true);
  };

  const validateUrl = (url: string): boolean => {
    try {
      if (!url.trim())
        return true;
      
      new URL(url.trim());
      return true;
    }
    catch {
      return false;
    }
  };

  const handleUpdateProfile = async () => {
    if (!user || !isOwnProfile)
      return;

    // Validate URLs before submitting
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
      console.error("Error updating profile:", error);
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

  function getPublishedTimelapses() {
    return timelapses ? timelapses.filter(t => t.isPublished) : [];
  };

  function getUnpublishedTimelapses() {
    if (!timelapses || !isOwnProfile)
      return [];

    return timelapses.filter(t => !t.isPublished);
  };

  function renderTimelapseGrid(timelapseList: Timelapse[], title: string) {
    if (timelapseList.length === 0)
      return null;

    return (
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-smoke mb-4">{title}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {timelapseList.map((timelapse) => (
            <div
              key={timelapse.id}
              className="bg-darkless rounded-lg overflow-hidden hover:bg-dark transition-colors cursor-pointer"
              onClick={() => router.push(`/timelapse/${timelapse.id}`)}
            >
              <div className="w-full aspect-video relative overflow-hidden">
                <ThumbnailImage
                  timelapseId={timelapse.id}
                  thumbnailUrl={timelapse.thumbnailUrl}
                  isPublished={timelapse.isPublished}
                  deviceId={timelapse.private?.device?.id}
                  alt={`${timelapse.name} thumbnail`}
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-smoke text-lg leading-tight line-clamp-2">
                    {timelapse.name}
                  </h3>
                  {!timelapse.isPublished && (
                    <Badge variant="warning" className="ml-2 flex-shrink-0">DRAFT</Badge>
                  )}
                  {timelapse.isPublished && timelapse.visibility === "UNLISTED" && (
                    <Badge variant="default" className="ml-2 flex-shrink-0">UNLISTED</Badge>
                  )}
                </div>

                {timelapse.description && (
                  <p className="text-muted text-sm leading-relaxed line-clamp-3">
                    {timelapse.description}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
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
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="flex items-start gap-8 mb-8">
          <ProfilePicture
            isSkeleton={user == null}
            profilePictureUrl={user?.profilePictureUrl}
            displayName={user?.displayName ?? "?"}
            size="lg"
            className="w-24 h-24 text-2xl"
            handle={user?.handle}
          />

          <div className="flex-1">
            <div className="flex items-center justify-between gap-4 -mb-1">
              <h1 className="text-4xl font-bold m-0 text-smoke">{user ? user.displayName : <Skeleton />}</h1>

              {isOwnProfile && (
                <Button onClick={handleEditProfile} kind="primary" className="gap-2">
                  <Icon glyph="edit" size={16} />
                  Edit Profile
                </Button>
              )}
            </div>

            <p className="text-muted text-lg m-0">{user ? `@${user.handle}` : <Skeleton />}</p>

            {user?.bio && user.bio.trim().length > 0 && (
              <p className="text-smoke text-lg leading-relaxed mb-4 max-w-2xl">
                {user.bio}
              </p>
            )}

            <div className="flex flex-col text-muted">
              <div className="flex items-center gap-2">
                <Icon glyph="clock" size={16} />
                <span>{ user ? `Joined ${formatJoinDate(user.createdAt)}` : <Skeleton /> }</span>
              </div>

              { (user?.urls ?? []).length > 0 && (
                user!.urls.map(url => (
                  <div key={url} className="flex items-center gap-2">
                    <Icon glyph={
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
                    } size={16} />

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

        {/* Timelapses Section */}
        <div>
          <>
            {isOwnProfile && renderTimelapseGrid(getUnpublishedTimelapses(), "Draft Timelapses")}
            {renderTimelapseGrid(getPublishedTimelapses(), isOwnProfile ? "Published Timelapses" : "Timelapses")}

            {getPublishedTimelapses().length === 0 && (!isOwnProfile || getUnpublishedTimelapses().length === 0) && (
              <div className="text-center py-12">
                <Icon glyph="history" size={64} className="text-muted mx-auto mb-4" />
                <p className="text-muted text-lg">
                  {isOwnProfile ? "You haven't created any timelapses yet." : "This user hasn't published any timelapses yet."}
                </p>
              </div>
            )}
          </>
        </div>
      </div>

      {/* Edit Profile Modal */}
      <WindowedModal
        icon="edit"
        title="Edit Profile"
        description="Update your profile information."
        isOpen={editModalOpen}
        setIsOpen={setEditModalOpen}
      >
        <div className="flex flex-col gap-6">
          <TextInput
            label="Display Name"
            description="Your public display name."
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
                  <input
                    className="bg-darkless outline-red focus:outline-2 transition-all rounded-md p-2 px-4 w-full"
                    type="text"
                    value={url}
                    onChange={(e) => {
                      const newUrls = [...editUrls];
                      newUrls[index] = e.target.value;
                      setEditUrls(newUrls);
                    }}
                    placeholder="https://example.com"
                    maxLength={64}
                  />
                  
                  <Button
                    kind="primary"
                    onClick={() => {
                      const newUrls = editUrls.filter((_, i) => i !== index);
                      setEditUrls(newUrls);
                    }}
                    className="px-3"
                  >
                    <Icon glyph="delete" size={16} />
                  </Button>
                </div>
              ))}

              {editUrls.length < 4 && (
                <Button
                  kind="secondary"
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
