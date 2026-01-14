import { useState } from "react";
import Icon from "@hackclub/icons";
import NextLink from "next/link";

import type { User, BanRecord } from "@/server/routers/api/user";
import { TimeAgo } from "@/client/components/TimeAgo";

import { trpc } from "@/client/trpc";
import { useAuth } from "@/client/hooks/useAuth";
import { useAsyncEffect } from "@/client/hooks/useAsyncEffect";

import RootLayout from "@/client/components/RootLayout";
import { ProfilePicture } from "@/client/components/ProfilePicture";

import { Button } from "@/client/components/ui/Button";
import { Skeleton } from "@/client/components/ui/Skeleton";
import { TextInput } from "@/client/components/ui/TextInput";
import { ErrorModal } from "@/client/components/ui/ErrorModal";
import { WindowedModal } from "@/client/components/ui/WindowedModal";
import { TextareaInput } from "@/client/components/ui/TextareaInput";

export default function AdminPage() {
  const { currentUser, isLoading: authLoading } = useAuth(true);

  const [users, setUsers] = useState<User[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [showBannedOnly, setShowBannedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<User | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const [banModalOpen, setBanModalOpen] = useState(false);
  const [banTargetUser, setBanTargetUser] = useState<User | null>(null);
  const [banReason, setBanReason] = useState("");
  const [banReasonInternal, setBanReasonInternal] = useState("");
  const [isBanning, setIsBanning] = useState(false);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTargetUser, setDeleteTargetUser] = useState<User | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyTargetUser, setHistoryTargetUser] = useState<User | null>(null);
  const [banHistory, setBanHistory] = useState<BanRecord[] | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const isAdmin = currentUser && (currentUser.private.permissionLevel === "ADMIN" || currentUser.private.permissionLevel === "ROOT");

  async function loadUsers(cursor?: string, onlyBanned?: boolean) {
    try {
      const res = await trpc.user.list.query({
        limit: 20,
        cursor,
        onlyBanned
      });

      if (!res.ok) {
        setError(res.error);
        return;
      }

      if (cursor) {
        setUsers(prev => [...(prev ?? []), ...res.data.users]);
      }
      else {
        setUsers(res.data.users);
      }

      setNextCursor(res.data.nextCursor);
    }
    catch (err) {
      console.error("(admin/index.tsx) Error loading users:", err);
      setError("Failed to load users");
    }
  }

  useAsyncEffect(async () => {
    if (!currentUser || !isAdmin)
      return;

    await loadUsers(undefined, showBannedOnly);
  }, [currentUser, showBannedOnly]);

  async function handleSearch() {
    if (!searchQuery.trim())
      return;

    setIsSearching(true);
    setSearchResult(null);

    try {
      const res = await trpc.user.query.query(
        searchQuery.startsWith("@")
          ? { handle: searchQuery.substring(1).trim() }
          : { id: searchQuery.trim() }
      );

      if (!res.ok) {
        setError(res.error);
        return;
      }

      if (res.data.user && "private" in res.data.user) {
        setSearchResult(res.data.user as User);
      }
      else {
        setError("User not found or you don't have permission to view them.");
      }
    }
    catch (err) {
      console.error("(admin/index.tsx) Error searching user:", err);
      setError("Failed to search for user");
    }
    finally {
      setIsSearching(false);
    }
  }

  async function handleLoadMore() {
    if (!nextCursor || isLoadingMore)
      return;

    setIsLoadingMore(true);
    await loadUsers(nextCursor, showBannedOnly);
    setIsLoadingMore(false);
  }

  function openBanModal(user: User) {
    setBanTargetUser(user);
    setBanReason("");
    setBanReasonInternal("");
    setBanModalOpen(true);
  }

  async function handleBanUser(ban: boolean) {
    if (!banTargetUser)
      return;

    setIsBanning(true);

    try {
      const res = await trpc.user.setBanStatus.mutate({
        id: banTargetUser.id,
        isBanned: ban,
        reason: ban ? banReason : undefined,
        reasonInternal: ban ? banReasonInternal : undefined
      });

      if (!res.ok) {
        setError(res.error);
        return;
      }

      setUsers(prev => prev?.map(u =>
        u.id === banTargetUser.id ? res.data.user : u
      ) ?? null);

      if (searchResult?.id === banTargetUser.id) {
        setSearchResult(res.data.user);
      }

      setBanModalOpen(false);
    }
    catch (err) {
      console.error("(admin/index.tsx) Error banning user:", err);
      setError("Failed to update ban status");
    }
    finally {
      setIsBanning(false);
    }
  }

  function openDeleteModal(user: User) {
    setDeleteTargetUser(user);
    setDeleteModalOpen(true);
  }

  async function openHistoryModal(user: User) {
    setHistoryTargetUser(user);
    setBanHistory(null);
    setHistoryModalOpen(true);
    setIsLoadingHistory(true);

    try {
      const res = await trpc.user.getBanHistory.query({ id: user.id });

      if (!res.ok) {
        setError(res.error);
        setHistoryModalOpen(false);
        return;
      }

      setBanHistory(res.data.records);
    }
    catch (err) {
      console.error("(admin/index.tsx) Error loading ban history:", err);
      setError("Failed to load ban history");
      setHistoryModalOpen(false);
    }
    finally {
      setIsLoadingHistory(false);
    }
  }

  async function handleDeleteUser() {
    if (!deleteTargetUser)
      return;

    setIsDeleting(true);

    try {
      const res = await trpc.user.deleteUser.mutate({
        id: deleteTargetUser.id
      });

      if (!res.ok) {
        setError(res.error);
        return;
      }

      setUsers(prev => prev?.filter(u => u.id !== deleteTargetUser.id) ?? null);

      if (searchResult?.id === deleteTargetUser.id) {
        setSearchResult(null);
      }

      setDeleteModalOpen(false);
    }
    catch (err) {
      console.error("(admin/index.tsx) Error deleting user:", err);
      setError("Failed to delete user");
    }
    finally {
      setIsDeleting(false);
    }
  }

  if (authLoading) {
    return (
      <RootLayout title="Admin Dashboard - Lapse" showHeader>
        <div className="container mx-auto px-4 py-8">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-64 w-full" />
        </div>
      </RootLayout>
    );
  }

  if (!isAdmin) {
    return (
      <RootLayout title="Access Denied - Lapse" showHeader>
        <div className="container mx-auto px-4 py-8 text-center">
          <Icon glyph="private" width={64} height={64} className="mx-auto mb-4 text-muted" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-muted">You don&apos;t have permission to access the admin dashboard.</p>
        </div>
      </RootLayout>
    );
  }

  function UserRow({ user }: { user: User }) {
    const isBanned = user.private.isBanned;
    const isRoot = user.private.permissionLevel === "ROOT";
    const canModerate = currentUser?.private.permissionLevel === "ROOT" || user.private.permissionLevel === "USER";

    return (
      <div className="flex items-center gap-4 p-4 bg-dark rounded-xl border border-slate">
        <ProfilePicture user={user} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <NextLink
              href={`/user/${user.id}`}
              className="font-bold text-white hover:text-red transition-colors truncate"
            >
              {user.displayName}
            </NextLink>
            <span className="text-muted text-sm">@{user.handle}</span>
            {user.private.permissionLevel !== "USER" && (
              <span className="px-2 py-0.5 text-xs font-bold rounded bg-red text-white">
                {user.private.permissionLevel}
              </span>
            )}
            {isBanned && (
              <span className="px-2 py-0.5 text-xs font-bold rounded bg-orange text-white">
                BANNED
              </span>
            )}
          </div>
          <div className="text-muted text-sm truncate">
            {user.id}
          </div>
          {isBanned && (user.private.bannedReason || user.private.bannedReasonInternal) && (
            <div className="text-orange text-sm mt-1">
              {user.private.bannedReason && (
                <div>Public: {user.private.bannedReason}</div>
              )}
              {user.private.bannedReasonInternal && (
                <div>Internal: {user.private.bannedReasonInternal}</div>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <NextLink href={`/user/${user.id}`}>
            <Button kind="regular" onClick={() => {}}>
              <Icon glyph="view" width={16} height={16} />
            </Button>
          </NextLink>
          <Button kind="regular" onClick={() => openHistoryModal(user)}>
            <Icon glyph="history" width={16} height={16} />
          </Button>
          {canModerate && !isRoot && (
            <>
              <Button
                kind={isBanned ? "primary" : "destructive"}
                onClick={() => openBanModal(user)}
              >
                {isBanned ? "Unban" : "Ban"}
              </Button>
              {currentUser?.private.permissionLevel === "ROOT" && (
                <Button kind="destructive" onClick={() => openDeleteModal(user)}>
                  <Icon glyph="delete" width={16} height={16} />
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <RootLayout title="Admin Dashboard - Lapse" showHeader>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">Admin Dashboard</h1>

        <div className="mb-6 p-4 bg-darker rounded-xl border border-slate">
          <h2 className="text-xl font-bold mb-4">Search User</h2>
          <div className="flex gap-2">
            <TextInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="User ID or @handle"
            />
            <Button kind="primary" onClick={handleSearch} disabled={isSearching}>
              {isSearching ? "Searching..." : "Search"}
            </Button>
          </div>

          {searchResult && (
            <div className="mt-4">
              <UserRow user={searchResult} />
            </div>
          )}
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">All Users</h2>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showBannedOnly}
                onChange={e => setShowBannedOnly(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">Show banned only</span>
            </label>
          </div>

          {!users ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted">
              {showBannedOnly ? "No banned users found." : "No users found."}
            </div>
          ) : (
            <div className="space-y-2">
              {users.map(user => (
                <UserRow key={user.id} user={user} />
              ))}
            </div>
          )}

          {nextCursor && (
            <div className="mt-4 text-center">
              <Button kind="regular" onClick={handleLoadMore} disabled={isLoadingMore}>
                {isLoadingMore ? "Loading..." : "Load More"}
              </Button>
            </div>
          )}
        </div>
      </div>

      <WindowedModal
        title={banTargetUser?.private.isBanned ? "Unban User" : "Ban User"}
        description={
          banTargetUser?.private.isBanned
            ? `Unban ${banTargetUser?.displayName}`
            : `Ban ${banTargetUser?.displayName}`
        }
        icon="important"
        isOpen={banModalOpen}
        setIsOpen={setBanModalOpen}
      >
        <div className="space-y-4">
          <p>
            {banTargetUser?.private.isBanned
              ? `Are you sure you want to unban ${banTargetUser?.displayName}?`
              : `Are you sure you want to ban ${banTargetUser?.displayName}?`}
          </p>
          {!banTargetUser?.private.isBanned && (
            <>
              <TextareaInput
                label="Public ban reason"
                description="This reason will be shown to the banned user."
                value={banReason}
                onChange={setBanReason}
              />
              <TextareaInput
                label="Internal ban reason"
                description="This reason is only visible to administrators."
                value={banReasonInternal}
                onChange={setBanReasonInternal}
              />
            </>
          )}
          <div className="flex gap-2 justify-end">
            <Button kind="regular" onClick={() => setBanModalOpen(false)}>
              Cancel
            </Button>
            <Button
              kind={banTargetUser?.private.isBanned ? "primary" : "destructive"}
              onClick={() => handleBanUser(!banTargetUser?.private.isBanned)}
              disabled={isBanning}
            >
              {isBanning
                ? "Processing..."
                : (banTargetUser?.private.isBanned ? "Unban" : "Ban")}
            </Button>
          </div>
        </div>
      </WindowedModal>

      <WindowedModal
        title="Delete User"
        description={`Permanently delete ${deleteTargetUser?.displayName}`}
        icon="delete"
        isOpen={deleteModalOpen}
        setIsOpen={setDeleteModalOpen}
      >
        <div className="space-y-4">
          <p className="text-red">
            Are you sure you want to permanently delete {deleteTargetUser?.displayName}?
            This will remove all their timelapses, comments, and data. This action cannot be undone.
          </p>
          <div className="flex gap-2 justify-end">
            <Button kind="regular" onClick={() => setDeleteModalOpen(false)}>
              Cancel
            </Button>
            <Button kind="destructive" onClick={handleDeleteUser} disabled={isDeleting}>
              {isDeleting ? "Deleting..." : "Delete User"}
            </Button>
          </div>
        </div>
      </WindowedModal>

      <WindowedModal
        title="Ban History"
        description={`Moderation history for ${historyTargetUser?.displayName}`}
        icon="history"
        isOpen={historyModalOpen}
        setIsOpen={setHistoryModalOpen}
      >
        <div className="space-y-4 max-h-96 overflow-y-auto">
          {isLoadingHistory ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : banHistory && banHistory.length === 0 ? (
            <p className="text-muted text-center py-4">No ban history for this user.</p>
          ) : (
            banHistory?.map(record => (
              <div
                key={record.id}
                className={`p-3 rounded-lg border ${
                  record.action === "BAN"
                    ? "bg-red/10 border-red/30"
                    : "bg-green/10 border-green/30"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`font-bold ${record.action === "BAN" ? "text-red" : "text-green"}`}>
                    {record.action === "BAN" ? "Banned" : "Unbanned"}
                  </span>
                  <span className="text-muted text-sm">
                    <TimeAgo date={record.createdAt} />
                  </span>
                </div>
                <div className="text-sm text-muted mb-1">
                  By: {record.performedBy.displayName} (@{record.performedBy.handle})
                </div>
                {record.reason && (
                  <div className="text-sm mt-2">
                    <span className="text-muted">Public reason:</span> {record.reason}
                  </div>
                )}
                {record.reasonInternal && (
                  <div className="text-sm">
                    <span className="text-muted">Internal reason:</span> {record.reasonInternal}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        <div className="flex justify-end mt-4">
          <Button kind="regular" onClick={() => setHistoryModalOpen(false)}>
            Close
          </Button>
        </div>
      </WindowedModal>

      {error && (
        <ErrorModal
          isOpen={!!error}
          setIsOpen={(isOpen) => !isOpen && setError(null)}
          message={error}
        />
      )}
    </RootLayout>
  );
}
